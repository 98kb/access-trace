import type {
  CoverageReasonV1,
  CoverageRegionV1,
  FindingV1,
  ScanReportV1,
} from "./contracts";
import { SCHEMA_VERSION, TOP_FRAME_ID } from "./contracts";
import {
  buildCoverage,
  coverageWarnings,
  legacySkippedRegions,
} from "./coverage";

/** A child frame element observed in a scanned document. */
export type ChildFrameDescriptorV1 = {
  selector: string;
  url: string;
  sameOrigin: boolean;
};

/** What one injected frame reports about itself. */
export type FrameScanV1 = {
  scanId: string;
  scannerVersion: string;
  frameId: number;
  parentFrameId: number;
  depth: number;
  url: string;
  childFrames: ChildFrameDescriptorV1[];
  openShadowRoots: number;
  closedShadowRoots: number;
  /** True when the open-shadow-root walk hit its node budget. */
  shadowWalkTruncated?: boolean;
  ruleCounts: { passes: number; inapplicable: number };
  findings: FindingV1[];
};

export type FrameScanFailureV1 = {
  frameId?: number;
  url: string;
  reason: CoverageReasonV1;
  detail?: string;
};

/**
 * Browsers expose no API for enumerating closed shadow roots, so the scan can
 * never prove their absence. The limitation is stated on every report instead
 * of being counted as a discovered region.
 */
export const CLOSED_SHADOW_ROOT_NOTE =
  "Closed shadow roots cannot be detected by page scripts, so any content inside one was not scanned.";

/**
 * The open-shadow-root walk is bounded so a very large page cannot stall the
 * scan. When the bound is reached the count is a floor, and it says so.
 */
export const SHADOW_WALK_TRUNCATED_NOTE =
  "This page is large enough that the open shadow root count stopped early, so it is a minimum rather than a total.";

const uninspectableSchemes = ["about:", "data:", "javascript:", "blob:"];

function descriptorReason(
  descriptor: ChildFrameDescriptorV1,
): CoverageReasonV1 {
  if (uninspectableSchemes.some((scheme) => descriptor.url.startsWith(scheme)))
    return "unsupported-url";
  return descriptor.sameOrigin ? "missing-permission" : "cross-origin-frame";
}

function take(pool: string[], url: string): boolean {
  const index = pool.indexOf(url);
  if (index === -1) return false;
  pool.splice(index, 1);
  return true;
}

/**
 * Folds per-frame results into one report whose coverage counts every frame the
 * scan discovered, not just the ones it managed to reach.
 */
export function aggregateFrameScans(input: {
  scanId: string;
  page: { url: string; title: string };
  startedAt: string;
  durationMs: number;
  scannerVersion: string;
  frames: FrameScanV1[];
  failures: FrameScanFailureV1[];
  cancelled?: boolean;
}): ScanReportV1 {
  const top = input.frames.find((frame) => frame.frameId === TOP_FRAME_ID);
  const children = input.frames.filter(
    (frame) => frame.frameId !== TOP_FRAME_ID,
  );
  const topFailure = input.failures.find(
    (failure) => failure.frameId === TOP_FRAME_ID,
  );
  const childFailures = input.failures.filter(
    (failure) => failure.frameId !== TOP_FRAME_ID,
  );

  const regions: CoverageRegionV1[] = [
    {
      kind: "document",
      state: top ? "scanned" : "failed",
      detail: top ? "Top document" : (topFailure?.detail ?? "Top document"),
      frameId: TOP_FRAME_ID,
      url: input.page.url,
      ...(top ? {} : { reason: topFailure?.reason ?? "execution-failure" }),
    },
  ];

  for (const child of children)
    regions.push({
      kind: "frame",
      state: "scanned",
      detail: child.url,
      frameId: child.frameId,
      url: child.url,
    });

  for (const failure of childFailures)
    regions.push({
      kind: "frame",
      state: "failed",
      reason: failure.reason,
      detail: failure.detail ?? failure.url,
      url: failure.url,
      ...(failure.frameId === undefined ? {} : { frameId: failure.frameId }),
    });

  // Descriptors are matched to reached frames by URL first, but a frame that
  // navigated after load will not match its parent's view of its `src`. Rather
  // than invent a skip, only the descriptors left over once every reached frame
  // is accounted for are reported as skipped.
  const reachedUrls = [
    ...children.map((child) => child.url),
    ...childFailures.map((failure) => failure.url),
  ];
  const unmatched: ChildFrameDescriptorV1[] = [];
  for (const frame of input.frames)
    for (const descriptor of frame.childFrames)
      if (!take(reachedUrls, descriptor.url)) unmatched.push(descriptor);

  const unaccountedReached = reachedUrls.length;
  const skippedCount = Math.max(0, unmatched.length - unaccountedReached);
  // A cross-origin descriptor cannot be a same-origin frame that merely moved,
  // so those are the ones attributed to a skip first.
  const ranked = [...unmatched].sort(
    (left, right) => Number(left.sameOrigin) - Number(right.sameOrigin),
  );
  for (const descriptor of ranked.slice(0, skippedCount))
    regions.push({
      kind: "frame",
      state: "skipped",
      reason: descriptorReason(descriptor),
      detail: descriptor.url,
      url: descriptor.url,
    });

  const coverage = buildCoverage({
    regions,
    cancelled: input.cancelled,
    openShadowRoots: input.frames.reduce(
      (total, frame) => total + frame.openShadowRoots,
      0,
    ),
    closedShadowRoots: input.frames.reduce(
      (total, frame) => total + frame.closedShadowRoots,
      0,
    ),
    ruleCounts: input.frames.reduce(
      (total, frame) => ({
        passes: total.passes + frame.ruleCounts.passes,
        inapplicable: total.inapplicable + frame.ruleCounts.inapplicable,
      }),
      { passes: 0, inapplicable: 0 },
    ),
  });

  const seen = new Set<string>();
  const findings = input.frames.flatMap((frame) =>
    frame.findings.filter((item) => {
      const key = `${frame.frameId}|${item.status}|${item.ruleId}|${JSON.stringify(
        item.locator.segments,
      )}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    scanId: input.scanId,
    scanner: { name: "axe-core", version: input.scannerVersion },
    page: input.page,
    startedAt: input.startedAt,
    durationMs: input.durationMs,
    coverage,
    findings,
    warnings: [
      ...coverageWarnings(coverage),
      ...(input.frames.some((frame) => frame.shadowWalkTruncated)
        ? [SHADOW_WALK_TRUNCATED_NOTE]
        : []),
      CLOSED_SHADOW_ROOT_NOTE,
    ],
    skippedRegions: legacySkippedRegions(coverage),
  };
}

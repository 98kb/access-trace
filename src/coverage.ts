import type {
  CoverageReasonV1,
  CoverageRegionV1,
  ScanCoverageV1,
} from "./contracts";

/** Clause completing "<region> was skipped/failed because …". */
const reasonClauses: Record<CoverageReasonV1, string> = {
  "unsupported-url": "its URL scheme cannot be inspected by extensions",
  "missing-permission": "Chrome did not grant access to it",
  "cross-origin-frame": "it is cross-origin and inaccessible to this extension",
  "detached-frame": "it was removed from the page during the scan",
  "execution-failure": "the scan script could not run inside it",
  timeout: "the scan timed out",
  "closed-shadow-root": "closed shadow roots are not exposed to page scripts",
};

const regionNouns: Record<CoverageRegionV1["kind"], [string, string]> = {
  document: ["document", "documents"],
  frame: ["frame", "frames"],
  "shadow-root": ["shadow root", "shadow roots"],
};

function plural(kind: CoverageRegionV1["kind"], count: number): string {
  return regionNouns[kind][count === 1 ? 0 : 1]!;
}

export function buildCoverage(input: {
  regions: CoverageRegionV1[];
  ruleCounts: { passes: number; inapplicable: number };
  openShadowRoots: number;
  closedShadowRoots: number;
  cancelled?: boolean;
}): ScanCoverageV1 {
  const regions = [...input.regions];
  if (input.closedShadowRoots > 0)
    regions.push({
      kind: "shadow-root",
      state: "skipped",
      reason: "closed-shadow-root",
      detail: `${input.closedShadowRoots} closed shadow ${
        input.closedShadowRoots === 1 ? "root was" : "roots were"
      } detected and cannot be inspected.`,
    });

  const frames = regions.filter((region) => region.kind === "frame");
  const cancelled = input.cancelled === true;
  const complete =
    !cancelled && regions.every((region) => region.state === "scanned");

  return {
    complete,
    ruleCounts: input.ruleCounts,
    topDocument:
      regions.find((region) => region.kind === "document")?.state ?? "failed",
    frames: {
      discovered: frames.length,
      scanned: frames.filter((region) => region.state === "scanned").length,
      skipped: frames.filter((region) => region.state === "skipped").length,
      failed: frames.filter((region) => region.state === "failed").length,
    },
    shadowRoots: {
      openScanned: input.openShadowRoots,
      closedEncountered: input.closedShadowRoots,
    },
    regions,
    cancelled,
    partial: !complete,
  };
}

function unscanned(coverage: ScanCoverageV1): CoverageRegionV1[] {
  return (coverage.regions ?? []).filter(
    (region) => region.state !== "scanned",
  );
}

export function scannedScopeSentence(coverage: ScanCoverageV1): string {
  const top =
    coverage.topDocument === "scanned"
      ? "Scanned the top document"
      : "The top document could not be scanned";
  const frames = coverage.frames;
  if (!frames || frames.discovered === 0)
    return `${top}. No child frames were found.`;
  return `${top} and ${frames.scanned} of ${frames.discovered} child ${plural(
    "frame",
    frames.discovered,
  )}.`;
}

/** "…was skipped because it is cross-origin…" — one wording, two readers. */
function unscannedClause(region: CoverageRegionV1): string {
  return `${region.state === "failed" ? "failed" : "was skipped"} because ${
    region.reason
      ? reasonClauses[region.reason]
      : "the extension could not establish why"
  }`;
}

export function coverageWarnings(coverage: ScanCoverageV1): string[] {
  const grouped = new Map<string, { count: number; text: string }>();
  for (const region of unscanned(coverage)) {
    if (region.kind === "shadow-root") {
      grouped.set(region.detail, { count: 1, text: region.detail });
      continue;
    }
    const clause = unscannedClause(region);
    const key = `${region.kind}|${clause}`;
    const existing = grouped.get(key);
    const count = (existing?.count ?? 0) + 1;
    grouped.set(key, {
      count,
      text: `${count} ${plural(region.kind, count)} ${clause}.`,
    });
  }
  return [...grouped.values()].map((entry) =>
    entry.count === 1
      ? entry.text
      : entry.text.replace(" was skipped ", " were skipped "),
  );
}

export function legacySkippedRegions(
  coverage: ScanCoverageV1,
): Array<{ kind: "frame" | "shadow-root"; reason: string }> {
  return unscanned(coverage)
    .filter(
      (
        region,
      ): region is CoverageRegionV1 & { kind: "frame" | "shadow-root" } =>
        region.kind !== "document",
    )
    .map((region) => ({
      kind: region.kind,
      reason:
        region.kind === "shadow-root" && region.reason === "closed-shadow-root"
          ? region.detail
          : `${region.detail} ${unscannedClause(region)}.`,
    }));
}

export type CoverageSummary = {
  headline: string;
  detail: string;
  incomplete: boolean;
};

/**
 * The clean state may only claim that nothing was detected in what was
 * actually scanned. It must never imply the page has no accessibility defects.
 */
export function coverageSummary(
  coverage: ScanCoverageV1,
  findingCount: number,
): CoverageSummary {
  const missing = unscanned(coverage).length;
  const incomplete = missing > 0 || coverage.cancelled === true;
  const scope = scannedScopeSentence(coverage);
  const gap = coverage.cancelled
    ? " The scan was cancelled before it finished."
    : missing > 0
      ? ` ${missing} ${missing === 1 ? "region was" : "regions were"} not scanned, so findings may exist there.`
      : "";
  if (findingCount > 0)
    return {
      headline: `${findingCount} ${findingCount === 1 ? "finding" : "findings"} detected in scanned content`,
      detail: `${scope}${gap}`,
      incomplete,
    };
  return {
    headline: "No findings detected in scanned content",
    detail: `${scope}${gap} Automated rules cover only part of accessibility, so this is not proof that the page is accessible.`,
    incomplete,
  };
}

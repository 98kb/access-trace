import { describe, expect, it } from "vitest";

import {
  aggregateFrameScans,
  CLOSED_SHADOW_ROOT_NOTE,
  SHADOW_WALK_TRUNCATED_NOTE,
  type FrameScanV1,
} from "../src/aggregate";
import type { FindingV1, ScanReportV1 } from "../src/contracts";

function finding(frameId: number, ruleId: string, selector: string): FindingV1 {
  return {
    findingId: `scan-1:${frameId}:${ruleId}:${selector}`,
    ruleId,
    status: "violation",
    impact: "critical",
    tags: ["wcag2a"],
    help: "help",
    helpUrl: "https://example.test/rule",
    failureSummary: "summary",
    locator: { segments: [{ type: "css", selector }] },
    evidence: `<img id="${selector}">`,
    nodeRef: `scan-1:${frameId}:${selector}`,
    frame: {
      frameId,
      parentFrameId: frameId === 0 ? -1 : 0,
      url: "https://example.test/",
      depth: frameId === 0 ? 0 : 1,
    },
  };
}

function frameScan(overrides: Partial<FrameScanV1> = {}): FrameScanV1 {
  return {
    scanId: "scan-1",
    scannerVersion: "4.13.0",
    frameId: 0,
    parentFrameId: -1,
    depth: 0,
    url: "https://example.test/",
    childFrames: [],
    openShadowRoots: 0,
    closedShadowRoots: 0,
    ruleCounts: { passes: 5, inapplicable: 7 },
    findings: [],
    ...overrides,
  };
}

const base = {
  scanId: "scan-1",
  page: { url: "https://example.test/", title: "Example" },
  startedAt: "2026-09-05T10:00:00.000Z",
  durationMs: 42,
  scannerVersion: "4.13.0",
  failures: [],
};

describe("aggregateFrameScans", () => {
  it("merges findings from accessible child frames and preserves frame identity", () => {
    const report = aggregateFrameScans({
      ...base,
      frames: [
        frameScan({
          findings: [finding(0, "image-alt", "hero")],
          childFrames: [
            {
              selector: "#same",
              url: "https://example.test/widget",
              sameOrigin: true,
            },
          ],
        }),
        frameScan({
          frameId: 5,
          parentFrameId: 0,
          depth: 1,
          url: "https://example.test/widget",
          findings: [finding(5, "label", "field")],
          ruleCounts: { passes: 2, inapplicable: 1 },
        }),
      ],
    });

    expect(report.findings.map((item) => item.ruleId)).toEqual([
      "image-alt",
      "label",
    ]);
    expect(report.findings[1]?.frame?.frameId).toBe(5);
    expect(report.coverage.frames).toEqual({
      discovered: 1,
      scanned: 1,
      skipped: 0,
      failed: 0,
    });
    expect(report.coverage.complete).toBe(true);
    expect(report.coverage.ruleCounts).toEqual({ passes: 7, inapplicable: 8 });
    expect(report.scanner).toEqual({ name: "axe-core", version: "4.13.0" });
  });

  it("never duplicates a rule occurrence reported twice for the same frame", () => {
    const duplicate = finding(0, "image-alt", "hero");
    const report = aggregateFrameScans({
      ...base,
      frames: [frameScan({ findings: [duplicate, { ...duplicate }] })],
    });

    expect(report.findings).toHaveLength(1);
  });

  it("reports an unreachable cross-origin frame as skipped rather than scanned", () => {
    const report = aggregateFrameScans({
      ...base,
      frames: [
        frameScan({
          childFrames: [
            {
              selector: "#ad",
              url: "https://other.test/ad",
              sameOrigin: false,
            },
          ],
        }),
      ],
    });

    expect(report.coverage.frames).toEqual({
      discovered: 1,
      scanned: 0,
      skipped: 1,
      failed: 0,
    });
    expect(report.coverage.regions).toContainEqual({
      kind: "frame",
      state: "skipped",
      reason: "cross-origin-frame",
      detail: "https://other.test/ad",
      url: "https://other.test/ad",
    });
    expect(report.warnings).toEqual([
      "1 frame was skipped because it is cross-origin and inaccessible to this extension.",
      CLOSED_SHADOW_ROOT_NOTE,
    ]);
    expect(report.coverage.complete).toBe(false);
  });

  it("keeps an execution failure distinct from a skip", () => {
    const report = aggregateFrameScans({
      ...base,
      frames: [
        frameScan({
          childFrames: [
            {
              selector: "#broken",
              url: "https://example.test/broken",
              sameOrigin: true,
            },
          ],
        }),
      ],
      failures: [
        {
          url: "https://example.test/broken",
          reason: "execution-failure",
          detail: "https://example.test/broken",
        },
      ],
    });

    expect(report.coverage.frames).toEqual({
      discovered: 1,
      scanned: 0,
      skipped: 0,
      failed: 1,
    });
  });

  it("does not invent a skipped frame when a scanned frame navigated after load", () => {
    const report = aggregateFrameScans({
      ...base,
      frames: [
        frameScan({
          childFrames: [
            {
              selector: "#route",
              url: "https://example.test/widget",
              sameOrigin: true,
            },
          ],
        }),
        frameScan({
          frameId: 6,
          parentFrameId: 0,
          depth: 1,
          // The frame moved on after the parent read its src.
          url: "https://example.test/widget/step-2",
        }),
      ],
    });

    expect(report.coverage.frames).toEqual({
      discovered: 1,
      scanned: 1,
      skipped: 0,
      failed: 0,
    });
    expect(report.coverage.complete).toBe(true);
  });

  it("attributes a skip to the cross-origin frame when origins are mixed", () => {
    const report = aggregateFrameScans({
      ...base,
      frames: [
        frameScan({
          childFrames: [
            {
              selector: "#moved",
              url: "https://example.test/widget",
              sameOrigin: true,
            },
            {
              selector: "#ad",
              url: "https://other.test/ad",
              sameOrigin: false,
            },
          ],
        }),
        frameScan({
          frameId: 6,
          parentFrameId: 0,
          depth: 1,
          url: "https://example.test/widget/step-2",
        }),
      ],
    });

    expect(report.coverage.frames).toEqual({
      discovered: 2,
      scanned: 1,
      skipped: 1,
      failed: 0,
    });
    expect(report.coverage.regions).toContainEqual({
      kind: "frame",
      state: "skipped",
      reason: "cross-origin-frame",
      detail: "https://other.test/ad",
      url: "https://other.test/ad",
    });
  });

  it("marks a cancelled aggregate as partial without inventing regions", () => {
    const report: ScanReportV1 = aggregateFrameScans({
      ...base,
      cancelled: true,
      frames: [frameScan({})],
    });

    expect(report.coverage.cancelled).toBe(true);
    expect(report.coverage.complete).toBe(false);
  });

  it("reports a missing top document as a failed document region", () => {
    const report = aggregateFrameScans({
      ...base,
      frames: [],
      failures: [
        {
          frameId: 0,
          url: "https://example.test/",
          reason: "timeout",
          detail: "Top document",
        },
      ],
    });

    expect(report.coverage.topDocument).toBe("failed");
    expect(report.findings).toEqual([]);
  });

  it("says the open shadow root count is a floor when the walk was truncated", () => {
    const report = aggregateFrameScans({
      ...base,
      frames: [frameScan({ openShadowRoots: 9, shadowWalkTruncated: true })],
    });

    expect(report.warnings).toContain(SHADOW_WALK_TRUNCATED_NOTE);
    expect(
      aggregateFrameScans({ ...base, frames: [frameScan({})] }).warnings,
    ).not.toContain(SHADOW_WALK_TRUNCATED_NOTE);
  });

  it("counts open and closed shadow roots across every scanned frame", () => {
    const report = aggregateFrameScans({
      ...base,
      frames: [
        frameScan({ openShadowRoots: 2, closedShadowRoots: 1 }),
        frameScan({
          frameId: 3,
          parentFrameId: 0,
          depth: 1,
          url: "https://example.test/widget",
          openShadowRoots: 1,
          closedShadowRoots: 2,
        }),
      ],
    });

    expect(report.coverage.shadowRoots).toEqual({
      openScanned: 3,
      closedEncountered: 3,
    });
    expect(report.skippedRegions).toContainEqual({
      kind: "shadow-root",
      reason: "3 closed shadow roots were detected and cannot be inspected.",
    });
  });
});

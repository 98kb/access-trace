import { describe, expect, it } from "vitest";

import type { CoverageRegionV1 } from "../src/contracts";
import {
  buildCoverage,
  coverageSummary,
  coverageWarnings,
  legacySkippedRegions,
  scannedScopeSentence,
} from "../src/coverage";

const scannedTop: CoverageRegionV1 = {
  kind: "document",
  state: "scanned",
  detail: "Top document",
  frameId: 0,
  url: "https://example.test/",
};

const ruleCounts = { passes: 12, inapplicable: 30 };

describe("buildCoverage", () => {
  it("counts documents, frames, and shadow roots by exact state", () => {
    const coverage = buildCoverage({
      ruleCounts,
      openShadowRoots: 3,
      closedShadowRoots: 1,
      regions: [
        scannedTop,
        {
          kind: "frame",
          state: "scanned",
          detail: "Same-origin frame",
          frameId: 4,
        },
        {
          kind: "frame",
          state: "skipped",
          reason: "cross-origin-frame",
          detail: "https://other.test/widget",
        },
        {
          kind: "frame",
          state: "failed",
          reason: "execution-failure",
          detail: "https://example.test/broken",
        },
      ],
    });

    expect(coverage.topDocument).toBe("scanned");
    expect(coverage.frames).toEqual({
      discovered: 3,
      scanned: 1,
      skipped: 1,
      failed: 1,
    });
    expect(coverage.shadowRoots).toEqual({
      openScanned: 3,
      closedEncountered: 1,
    });
    expect(coverage.complete).toBe(false);
    expect(coverage.partial).toBe(true);
    expect(coverage.cancelled).toBe(false);
    expect(coverage.ruleCounts).toEqual(ruleCounts);
  });

  it("is complete only when every region was scanned and nothing was cancelled", () => {
    expect(
      buildCoverage({
        ruleCounts,
        openShadowRoots: 0,
        closedShadowRoots: 0,
        regions: [scannedTop],
      }),
    ).toMatchObject({ complete: true, partial: false, cancelled: false });

    expect(
      buildCoverage({
        ruleCounts,
        openShadowRoots: 0,
        closedShadowRoots: 0,
        cancelled: true,
        regions: [scannedTop],
      }),
    ).toMatchObject({ complete: false, partial: true, cancelled: true });
  });

  it("marks a closed shadow root as an uninspectable skipped region", () => {
    const coverage = buildCoverage({
      ruleCounts,
      openShadowRoots: 0,
      closedShadowRoots: 2,
      regions: [scannedTop],
    });

    expect(coverage.regions).toContainEqual({
      kind: "shadow-root",
      state: "skipped",
      reason: "closed-shadow-root",
      detail: "2 closed shadow roots were detected and cannot be inspected.",
    });
    expect(coverage.complete).toBe(false);
  });
});

describe("coverage reporting", () => {
  const partial = buildCoverage({
    ruleCounts,
    openShadowRoots: 1,
    closedShadowRoots: 0,
    regions: [
      scannedTop,
      { kind: "frame", state: "scanned", detail: "child", frameId: 2 },
      {
        kind: "frame",
        state: "skipped",
        reason: "cross-origin-frame",
        detail: "https://other.test/widget",
      },
      {
        kind: "frame",
        state: "failed",
        reason: "timeout",
        detail: "https://example.test/slow",
      },
    ],
  });

  it("describes the scanned scope in countable terms", () => {
    expect(scannedScopeSentence(partial)).toBe(
      "Scanned the top document and 1 of 3 child frames.",
    );
    expect(
      scannedScopeSentence(
        buildCoverage({
          ruleCounts,
          openShadowRoots: 0,
          closedShadowRoots: 0,
          regions: [scannedTop],
        }),
      ),
    ).toBe("Scanned the top document. No child frames were found.");
  });

  it("turns reason codes into display warnings without hiding failures", () => {
    const warnings = coverageWarnings(partial);
    expect(warnings).toEqual([
      "1 frame was skipped because it is cross-origin and inaccessible to this extension.",
      "1 frame failed because the scan timed out.",
    ]);
  });

  it("never claims the page is free of accessibility defects", () => {
    const clean = coverageSummary(
      buildCoverage({
        ruleCounts,
        openShadowRoots: 0,
        closedShadowRoots: 0,
        regions: [scannedTop],
      }),
      0,
    );

    expect(clean.headline).toBe("No findings detected in scanned content");
    expect(clean.detail).toContain("Scanned the top document");
    expect(clean.detail).toContain("not proof");
    expect(`${clean.headline} ${clean.detail}`).not.toMatch(
      /no accessibility defects/i,
    );
    expect(clean.incomplete).toBe(false);
  });

  it("flags partial coverage in the clean state so silence is not read as success", () => {
    const clean = coverageSummary(partial, 0);
    expect(clean.headline).toBe("No findings detected in scanned content");
    expect(clean.incomplete).toBe(true);
    expect(clean.detail).toContain("2 regions were not scanned");
  });

  it("keeps the V1 skippedRegions projection for older readers", () => {
    expect(legacySkippedRegions(partial)).toEqual([
      {
        kind: "frame",
        reason:
          "https://other.test/widget was skipped because it is cross-origin and inaccessible to this extension.",
      },
      {
        kind: "frame",
        reason: "https://example.test/slow failed because the scan timed out.",
      },
    ]);
  });
});

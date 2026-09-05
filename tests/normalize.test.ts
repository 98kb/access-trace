import { describe, expect, it } from "vitest";

import { buildCoverage } from "../src/coverage";
import { frameIdFromNodeRef, normalizeAxeResults } from "../src/normalize";

describe("normalizeAxeResults", () => {
  it("creates one versioned finding per affected node without promoting incomplete checks", () => {
    const report = normalizeAxeResults(
      {
        testEngine: { name: "axe-core", version: "4.13.0" },
        testEnvironment: {
          orientationAngle: 0,
          orientationType: "landscape-primary",
          userAgent: "",
          windowHeight: 800,
          windowWidth: 1200,
        },
        testRunner: { name: "axe" },
        timestamp: "2026-09-05T10:00:00.000Z",
        url: "https://example.test/form",
        toolOptions: {},
        passes: [
          {
            id: "html-has-lang",
            impact: null,
            tags: [],
            description: "",
            help: "",
            helpUrl: "",
            nodes: [],
          },
        ],
        inapplicable: [
          {
            id: "audio-caption",
            impact: null,
            tags: [],
            description: "",
            help: "",
            helpUrl: "",
            nodes: [],
          },
        ],
        violations: [
          {
            id: "image-alt",
            impact: "critical",
            tags: ["cat.text-alternatives", "wcag2a", "wcag111"],
            description: "Ensure images have alternative text",
            help: "Images must have alternative text",
            helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
            nodes: [
              {
                impact: "critical",
                html: '<img src="cat.jpg">',
                target: ["#hero"],
                failureSummary: "Fix any of the following: add alt text",
                any: [],
                all: [],
                none: [],
              },
              {
                impact: null,
                html: '<input aria-label="Dog" value="private answer">',
                target: ["#fixture-frame", ["#host", "#dog"]],
                failureSummary: undefined,
                any: [],
                all: [],
                none: [],
              },
            ],
          },
        ],
        incomplete: [
          {
            id: "color-contrast",
            impact: null,
            tags: ["wcag2aa", "wcag143"],
            description: "Ensure text contrast can be determined",
            help: "Elements must meet minimum color contrast ratio thresholds",
            helpUrl:
              "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
            nodes: [
              {
                impact: null,
                html: '<p class="hero">Text</p>',
                target: [".hero"],
                failureSummary: "Contrast could not be determined",
                any: [],
                all: [],
                none: [],
              },
            ],
          },
        ],
      },
      {
        scanId: "scan-123",
        title: "Example form",
        durationMs: 18,
        frame: {
          frameId: 0,
          parentFrameId: -1,
          url: "https://example.test/form",
          depth: 0,
        },
        coverage: buildCoverage({
          ruleCounts: { passes: 1, inapplicable: 1 },
          openShadowRoots: 1,
          closedShadowRoots: 0,
          regions: [
            {
              kind: "document",
              state: "scanned",
              detail: "Top document",
              frameId: 0,
            },
            {
              kind: "frame",
              state: "skipped",
              reason: "cross-origin-frame",
              detail: "https://other.test/widget",
            },
          ],
        }),
      },
    );

    expect(report).toMatchObject({
      schemaVersion: "1.0",
      scanId: "scan-123",
      scanner: { name: "axe-core", version: "4.13.0" },
      page: { url: "https://example.test/form", title: "Example form" },
      durationMs: 18,
      coverage: { complete: false, ruleCounts: { passes: 1, inapplicable: 1 } },
      warnings: [
        "1 frame was skipped because it is cross-origin and inaccessible to this extension.",
      ],
    });
    expect(report.findings).toHaveLength(3);
    expect(
      report.findings.map(({ ruleId, status, impact }) => ({
        ruleId,
        status,
        impact,
      })),
    ).toEqual([
      { ruleId: "image-alt", status: "violation", impact: "critical" },
      { ruleId: "image-alt", status: "violation", impact: "unknown" },
      { ruleId: "color-contrast", status: "needs-review", impact: "unknown" },
    ]);
    expect(report.findings[0]).toMatchObject({
      tags: ["wcag2a", "wcag111"],
      evidence: '<img src="cat.jpg">',
      locator: { segments: [{ type: "css", selector: "#hero" }] },
    });
    expect(report.findings[1]?.locator.segments).toEqual([
      { type: "frame", selector: "#fixture-frame" },
      { type: "shadow", selector: "#host" },
      { type: "css", selector: "#dog" },
    ]);
    expect(report.findings[1]?.evidence).toBe(
      '<input aria-label="Dog" value="[redacted]">',
    );
    expect(report.findings[0]?.findingId).toContain("scan-123:0:image-alt:");
    expect(report.findings[0]?.frame).toEqual({
      frameId: 0,
      parentFrameId: -1,
      url: "https://example.test/form",
      depth: 0,
    });
    expect(frameIdFromNodeRef(report.findings[0]!.nodeRef)).toBe(0);
  });
});

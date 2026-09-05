import type { AxeResults, NodeResult, Result } from "axe-core";

import type {
  FindingImpact,
  FindingStatus,
  FindingV1,
  FrameRefV1,
  ScanCoverageV1,
  ScanReportV1,
} from "./contracts";
import { SCHEMA_VERSION } from "./contracts";
import { coverageWarnings, legacySkippedRegions } from "./coverage";
import { locatorSegmentsFromAxeTarget, redactSnippet } from "./locator";

type NormalizationContext = {
  scanId: string;
  title: string;
  durationMs: number;
  frame: FrameRefV1;
  coverage: ScanCoverageV1;
};

const impacts = new Set<FindingImpact>([
  "critical",
  "serious",
  "moderate",
  "minor",
]);

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function findings(
  results: Result[],
  status: FindingStatus,
  context: NormalizationContext,
): FindingV1[] {
  const { scanId, frame } = context;
  return results.flatMap((result) =>
    result.nodes.map((node: NodeResult) => {
      const snippet = redactSnippet(node.html);
      const occurrence = hash(
        JSON.stringify([
          frame.frameId,
          status,
          result.id,
          node.target,
          snippet,
        ]),
      );
      return {
        findingId: `${scanId}:${frame.frameId}:${result.id}:${occurrence}`,
        ruleId: result.id,
        status,
        impact: impacts.has(node.impact as FindingImpact)
          ? (node.impact as FindingImpact)
          : "unknown",
        tags: result.tags.filter(
          (tag) => tag.startsWith("wcag") || tag === "best-practice",
        ),
        help: result.help,
        helpUrl: result.helpUrl,
        failureSummary: node.failureSummary ?? "Manual review is required.",
        locator: {
          segments: locatorSegmentsFromAxeTarget(
            node.target as Array<string | string[]>,
          ),
        },
        evidence: snippet,
        nodeRef: `${scanId}:${frame.frameId}:${occurrence}`,
        frame,
      };
    }),
  );
}

export function normalizeAxeResults(
  results: AxeResults,
  context: NormalizationContext,
): ScanReportV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    scanId: context.scanId,
    scanner: { name: "axe-core", version: results.testEngine.version },
    page: { url: results.url, title: context.title },
    startedAt: results.timestamp,
    durationMs: context.durationMs,
    coverage: context.coverage,
    findings: [
      ...findings(results.violations, "violation", context),
      ...findings(results.incomplete, "needs-review", context),
    ],
    warnings: coverageWarnings(context.coverage),
    skippedRegions: legacySkippedRegions(context.coverage),
  };
}

/** Frame that owns a nodeRef, encoded as `<scanId>:<frameId>:<occurrence>`. */
export function frameIdFromNodeRef(nodeRef: string): number | undefined {
  const parts = nodeRef.split(":");
  if (parts.length < 3) return undefined;
  const frameId = Number(parts[parts.length - 2]);
  return Number.isInteger(frameId) && frameId >= 0 ? frameId : undefined;
}

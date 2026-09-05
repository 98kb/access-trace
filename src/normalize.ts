import type { AxeResults, NodeResult, Result } from "axe-core";

import type {
  FindingImpact,
  FindingStatus,
  FindingV1,
  LocatorSegmentV1,
  ScanReportV1,
} from "./contracts";
import { SCHEMA_VERSION } from "./contracts";

type NormalizationContext = Pick<
  ScanReportV1,
  "scanId" | "durationMs" | "warnings" | "skippedRegions"
> & {
  title: string;
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

function evidence(html: string): string {
  return html
    .replace(
      /\svalue\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
      ' value="[redacted]"',
    )
    .replace(/(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi, "$1[redacted]$2")
    .slice(0, 500);
}

function locator(target: NodeResult["target"]): LocatorSegmentV1[] {
  const segments: LocatorSegmentV1[] = [];
  target.forEach((part, partIndex) => {
    const finalPart = partIndex === target.length - 1;
    if (typeof part === "string") {
      segments.push({ type: finalPart ? "css" : "frame", selector: part });
      return;
    }
    part.forEach((selector, selectorIndex) => {
      const finalSelector = selectorIndex === part.length - 1;
      segments.push({
        type: finalSelector ? (finalPart ? "css" : "frame") : "shadow",
        selector,
      });
    });
  });
  return segments;
}

function findings(
  results: Result[],
  status: FindingStatus,
  scanId: string,
): FindingV1[] {
  return results.flatMap((result) =>
    result.nodes.map((node) => {
      const snippet = evidence(node.html);
      const occurrence = hash(
        JSON.stringify([status, result.id, node.target, snippet]),
      );
      return {
        findingId: `${scanId}:${result.id}:${occurrence}`,
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
        locator: { segments: locator(node.target) },
        evidence: snippet,
        nodeRef: `${scanId}:${occurrence}`,
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
    coverage: {
      complete: context.skippedRegions.length === 0,
      ruleCounts: {
        passes: results.passes.length,
        inapplicable: results.inapplicable.length,
      },
    },
    findings: [
      ...findings(results.violations, "violation", context.scanId),
      ...findings(results.incomplete, "needs-review", context.scanId),
    ],
    warnings: context.warnings,
    skippedRegions: context.skippedRegions,
  };
}

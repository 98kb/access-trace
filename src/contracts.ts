export const SCHEMA_VERSION = "1.0" as const;

export type FindingStatus = "violation" | "needs-review";
export type FindingImpact =
  | "critical"
  | "serious"
  | "moderate"
  | "minor"
  | "unknown";

export type LocatorSegmentV1 = {
  type: "css" | "frame" | "shadow";
  selector: string;
};

export type FindingV1 = {
  findingId: string;
  ruleId: string;
  status: FindingStatus;
  impact: FindingImpact;
  tags: string[];
  help: string;
  helpUrl: string;
  failureSummary: string;
  locator: { segments: LocatorSegmentV1[] };
  evidence: string;
  nodeRef: string;
};

export type ScanReportV1 = {
  schemaVersion: typeof SCHEMA_VERSION;
  scanId: string;
  scanner: { name: "axe-core"; version: string };
  page: { url: string; title: string };
  startedAt: string;
  durationMs: number;
  coverage: {
    complete: boolean;
    ruleCounts: { passes: number; inapplicable: number };
  };
  findings: FindingV1[];
  warnings: string[];
  skippedRegions: Array<{ kind: "frame" | "shadow-root"; reason: string }>;
};

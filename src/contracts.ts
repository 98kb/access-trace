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

/**
 * Serializable identity of the document a finding belongs to. `parentFrameId`
 * is `-1` for the top document and for any frame whose parent the extension
 * cannot establish without broader permissions.
 */
export type FrameRefV1 = {
  frameId: number;
  parentFrameId: number;
  url: string;
  depth: number;
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
  /** Added after V1; absent reports are treated as top-document findings. */
  frame?: FrameRefV1;
};

export type CoverageReasonV1 =
  | "unsupported-url"
  | "missing-permission"
  | "cross-origin-frame"
  | "detached-frame"
  | "execution-failure"
  | "timeout"
  | "closed-shadow-root";

export type CoverageRegionStateV1 = "scanned" | "skipped" | "failed";

export type CoverageRegionV1 = {
  kind: "document" | "frame" | "shadow-root";
  state: CoverageRegionStateV1;
  detail: string;
  reason?: CoverageReasonV1;
  frameId?: number;
  url?: string;
};

/**
 * `complete` and `ruleCounts` are the original V1 fields. Everything else is
 * optional so pre-existing V1 payloads still validate.
 */
export type ScanCoverageV1 = {
  complete: boolean;
  ruleCounts: { passes: number; inapplicable: number };
  topDocument?: CoverageRegionStateV1;
  frames?: {
    discovered: number;
    scanned: number;
    skipped: number;
    failed: number;
  };
  shadowRoots?: { openScanned: number; closedEncountered: number };
  regions?: CoverageRegionV1[];
  cancelled?: boolean;
  partial?: boolean;
};

export type ScanReportV1 = {
  schemaVersion: typeof SCHEMA_VERSION;
  scanId: string;
  scanner: { name: "axe-core"; version: string };
  page: { url: string; title: string };
  startedAt: string;
  durationMs: number;
  coverage: ScanCoverageV1;
  findings: FindingV1[];
  warnings: string[];
  skippedRegions: Array<{ kind: "frame" | "shadow-root"; reason: string }>;
};

export const TOP_FRAME_ID = 0;

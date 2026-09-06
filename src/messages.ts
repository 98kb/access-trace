import {
  parseAssistantRequest,
  parseAssistantResponse,
  type AssistantRequestV1,
  type AssistantResponseV1,
} from "./assistant-contracts";
import type { ChildFrameDescriptorV1, FrameScanV1 } from "./aggregate";
import type {
  FindingV1,
  FrameRefV1,
  ScanCoverageV1,
  ScanReportV1,
} from "./contracts";
import { SCHEMA_VERSION } from "./contracts";
import {
  parseAssistantSettings,
  type AssistantFailureCode,
  type AssistantProviderIdentity,
  type AssistantSettingsV1,
} from "./ollama";
import type {
  DeviceFlowCodeResponse,
  DomainRepositoryMappingV1,
  GitHubConnectionViewV1,
  GitHubLabelV1,
  GitHubRepositoryV1,
} from "./github/contracts";
import {
  parseDomainRepositoryMapping,
  parseGitHubConnectionView,
} from "./github/contracts";
import type { DevicePollResult } from "./github/auth";

export type ScanErrorCode =
  | "invalid-message"
  | "unsupported-page"
  | "permission-denied"
  | "scan-failed"
  | "stale-finding"
  | "timeout"
  | "cancelled"
  | "frame-unreachable";

const scanErrorCodes: readonly ScanErrorCode[] = [
  "invalid-message",
  "unsupported-page",
  "permission-denied",
  "scan-failed",
  "stale-finding",
  "timeout",
  "cancelled",
  "frame-unreachable",
];

export type ScanFailure = { code: ScanErrorCode; message: string };
export type AssistantMessageErrorCode =
  | AssistantFailureCode
  | "disabled"
  | "stale-finding";
export type AssistantFailure = {
  code: AssistantMessageErrorCode;
  message: string;
};

export type GitHubFailure = {
  code: string;
  message: string;
  ambiguous?: boolean;
};

export type ExtensionRequest =
  | { schemaVersion: typeof SCHEMA_VERSION; type: "get-state" }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "scan-request";
      /** Present only on the background-to-frame leg of a scan. */
      scan?: { scanId: string; frameId: number };
    }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "scan-cancel" }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "scan-stale";
      reason: string;
    }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "assistant-settings-get" }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "assistant-settings-set";
      settings: AssistantSettingsV1;
    }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "assistant-test" }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "assistant-preview" | "assistant-generate" | "assistant-evidence";
      findingId: string;
    }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "assistant-cancel" }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "overlay-command";
      command: "show-all" | "hide" | "select" | "deselect" | "clear";
      findingId?: string;
    }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "github-get-state" }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "github-start-device-flow" }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "github-poll-device-flow" }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "github-cancel-device-flow" }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "github-disconnect" }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "github-list-repositories" }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-list-labels";
      owner: string;
      repo: string;
    }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "github-get-mappings" }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-save-mapping";
      mapping: DomainRepositoryMappingV1;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-delete-mapping";
      domainKey: string;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-create-issue";
      findingId: string;
      operationId: string;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-check-issue";
      findingId: string;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "open-integrations-page";
      domainKey?: string;
    };

export type ExtensionResponse =
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "state-result";
      ok: true;
      report: ScanReportV1 | null;
      /** Added after V1; absent means "not known to be stale". */
      stale?: boolean;
      staleReason?: string;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "scan-result";
      ok: true;
      report: ScanReportV1;
    }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "command-result"; ok: true }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "frame-scan-result";
      ok: true;
      frameScan: FrameScanV1;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "assistant-settings-result";
      ok: true;
      settings: AssistantSettingsV1;
      permissionGranted: boolean;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "assistant-test-result";
      ok: true;
      available: true;
      provider: AssistantProviderIdentity;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "assistant-preview-result";
      ok: true;
      request: AssistantRequestV1;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "assistant-result";
      ok: true;
      response: AssistantResponseV1;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "assistant-command-result";
      ok: true;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-state-result";
      ok: true;
      connection: GitHubConnectionViewV1;
      permissionGranted: boolean;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-device-flow-start-result";
      ok: true;
      flow: DeviceFlowCodeResponse;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-device-flow-poll-result";
      ok: true;
      result: DevicePollResult;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-repositories-result";
      ok: true;
      repositories: GitHubRepositoryV1[];
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-labels-result";
      ok: true;
      labels: GitHubLabelV1[];
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-mappings-result";
      ok: true;
      mappings: DomainRepositoryMappingV1[];
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-create-issue-result";
      ok: true;
      issueNumber: number;
      htmlUrl: string;
      labelMissing: boolean;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-check-issue-result";
      ok: true;
      existing: { issueNumber: number; htmlUrl: string } | null;
      mapped: boolean;
      domainKey: string | null;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "github-command-result";
      ok: true;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type:
        | "scan-result"
        | "command-result"
        | "state-result"
        | "frame-scan-result";
      ok: false;
      error: ScanFailure;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type:
        | "assistant-settings-result"
        | "assistant-test-result"
        | "assistant-preview-result"
        | "assistant-result"
        | "assistant-command-result";
      ok: false;
      error: AssistantFailure;
    }
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type:
        | "github-state-result"
        | "github-device-flow-start-result"
        | "github-device-flow-poll-result"
        | "github-repositories-result"
        | "github-labels-result"
        | "github-mappings-result"
        | "github-create-issue-result"
        | "github-check-issue-result"
        | "github-command-result";
      ok: false;
      error: GitHubFailure;
    };

export class MessageValidationError extends Error {}

function record(value: unknown, label = "message"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MessageValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new MessageValidationError(`${label} must be a non-empty string`);
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new MessageValidationError(`${label} must be a non-negative number`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new MessageValidationError(`${label} must be a string array`);
  return value;
}

function versioned(value: unknown): Record<string, unknown> {
  const message = record(value);
  if (message.schemaVersion !== SCHEMA_VERSION)
    throw new MessageValidationError(
      `Unsupported schema version: ${String(message.schemaVersion)}`,
    );
  return message;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected)
    throw new MessageValidationError(
      `${label} has unexpected field: ${unexpected}`,
    );
}

function integer(value: unknown, label: string, minimum: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum)
    throw new MessageValidationError(
      `${label} must be an integer of at least ${minimum}`,
    );
  return value;
}

const coverageReasons = [
  "unsupported-url",
  "missing-permission",
  "cross-origin-frame",
  "detached-frame",
  "execution-failure",
  "timeout",
  "closed-shadow-root",
];
const coverageStates = ["scanned", "skipped", "failed"];
const coverageKinds = ["document", "frame", "shadow-root"];

function parseFrameRef(value: unknown, label: string): FrameRefV1 {
  const frame = record(value, label);
  return {
    frameId: integer(frame.frameId, `${label}.frameId`, 0),
    parentFrameId: integer(frame.parentFrameId, `${label}.parentFrameId`, -1),
    url: string(frame.url, `${label}.url`),
    depth: integer(frame.depth, `${label}.depth`, 0),
  };
}

function parseCoverage(value: unknown): ScanCoverageV1 {
  const coverage = record(value, "coverage");
  if (typeof coverage.complete !== "boolean")
    throw new MessageValidationError("coverage.complete must be a boolean");
  const counts = record(coverage.ruleCounts, "coverage.ruleCounts");
  number(counts.passes, "coverage.ruleCounts.passes");
  number(counts.inapplicable, "coverage.ruleCounts.inapplicable");
  if (
    coverage.topDocument !== undefined &&
    !coverageStates.includes(String(coverage.topDocument))
  )
    throw new MessageValidationError("coverage.topDocument is invalid");
  if (coverage.frames !== undefined) {
    const frames = record(coverage.frames, "coverage.frames");
    (["discovered", "scanned", "skipped", "failed"] as const).forEach((key) =>
      integer(frames[key], `coverage.frames.${key}`, 0),
    );
  }
  if (coverage.shadowRoots !== undefined) {
    const shadowRoots = record(coverage.shadowRoots, "coverage.shadowRoots");
    (["openScanned", "closedEncountered"] as const).forEach((key) =>
      integer(shadowRoots[key], `coverage.shadowRoots.${key}`, 0),
    );
  }
  if (coverage.regions !== undefined) {
    if (!Array.isArray(coverage.regions))
      throw new MessageValidationError("coverage.regions must be an array");
    coverage.regions.forEach((item, index) => {
      const region = record(item, `coverage.regions[${index}]`);
      if (!coverageKinds.includes(String(region.kind)))
        throw new MessageValidationError(
          `coverage.regions[${index}].kind is invalid`,
        );
      if (!coverageStates.includes(String(region.state)))
        throw new MessageValidationError(
          `coverage.regions[${index}].state is invalid`,
        );
      if (typeof region.detail !== "string")
        throw new MessageValidationError(
          `coverage.regions[${index}].detail must be a string`,
        );
      if (
        region.reason !== undefined &&
        !coverageReasons.includes(String(region.reason))
      )
        throw new MessageValidationError(
          `coverage.regions[${index}].reason is invalid`,
        );
    });
  }
  ([["cancelled"], ["partial"]] as const).forEach(([key]) => {
    if (coverage[key] !== undefined && typeof coverage[key] !== "boolean")
      throw new MessageValidationError(`coverage.${key} must be a boolean`);
  });
  return coverage as unknown as ScanCoverageV1;
}

function parseFinding(value: unknown, label: string): FindingV1 {
  const finding = record(value, label);
  [
    "findingId",
    "ruleId",
    "help",
    "helpUrl",
    "failureSummary",
    "evidence",
    "nodeRef",
  ].forEach((key) => string(finding[key], `${label}.${key}`));
  if (finding.status !== "violation" && finding.status !== "needs-review")
    throw new MessageValidationError(`${label}.status is invalid`);
  if (
    !["critical", "serious", "moderate", "minor", "unknown"].includes(
      String(finding.impact),
    )
  )
    throw new MessageValidationError(`${label}.impact is invalid`);
  strings(finding.tags, `${label}.tags`);
  const locator = record(finding.locator, `${label}.locator`);
  if (!Array.isArray(locator.segments) || locator.segments.length === 0)
    throw new MessageValidationError(
      `${label}.locator.segments must not be empty`,
    );
  locator.segments.forEach((item, segmentIndex) => {
    const segment = record(item, `${label}.locator.segments[${segmentIndex}]`);
    if (!["css", "frame", "shadow"].includes(String(segment.type)))
      throw new MessageValidationError(
        `${label}.locator segment type is invalid`,
      );
    string(segment.selector, `${label}.locator segment selector`);
  });
  if (finding.frame !== undefined)
    parseFrameRef(finding.frame, `${label}.frame`);
  return finding as unknown as FindingV1;
}

export function parseScanReport(value: unknown): ScanReportV1 {
  const report = versioned(value);
  string(report.scanId, "scanId");
  const scanner = record(report.scanner, "scanner");
  if (scanner.name !== "axe-core")
    throw new MessageValidationError("scanner.name must be axe-core");
  string(scanner.version, "scanner.version");
  const page = record(report.page, "page");
  string(page.url, "page.url");
  if (typeof page.title !== "string")
    throw new MessageValidationError("page.title must be a string");
  string(report.startedAt, "startedAt");
  number(report.durationMs, "durationMs");
  parseCoverage(report.coverage);
  strings(report.warnings, "warnings");
  if (!Array.isArray(report.skippedRegions))
    throw new MessageValidationError("skippedRegions must be an array");
  report.skippedRegions.forEach((item, index) => {
    const region = record(item, `skippedRegions[${index}]`);
    if (region.kind !== "frame" && region.kind !== "shadow-root")
      throw new MessageValidationError(
        `skippedRegions[${index}].kind is invalid`,
      );
    string(region.reason, `skippedRegions[${index}].reason`);
  });
  if (!Array.isArray(report.findings))
    throw new MessageValidationError("findings must be an array");
  report.findings.forEach((item, index) =>
    parseFinding(item, `findings[${index}]`),
  );
  return report as unknown as ScanReportV1;
}

export function parseFrameScan(value: unknown): FrameScanV1 {
  const frameScan = record(value, "frameScan");
  string(frameScan.scanId, "frameScan.scanId");
  string(frameScan.scannerVersion, "frameScan.scannerVersion");
  integer(frameScan.frameId, "frameScan.frameId", 0);
  integer(frameScan.parentFrameId, "frameScan.parentFrameId", -1);
  integer(frameScan.depth, "frameScan.depth", 0);
  string(frameScan.url, "frameScan.url");
  integer(frameScan.openShadowRoots, "frameScan.openShadowRoots", 0);
  integer(frameScan.closedShadowRoots, "frameScan.closedShadowRoots", 0);
  if (
    frameScan.shadowWalkTruncated !== undefined &&
    typeof frameScan.shadowWalkTruncated !== "boolean"
  )
    throw new MessageValidationError(
      "frameScan.shadowWalkTruncated must be a boolean",
    );
  const counts = record(frameScan.ruleCounts, "frameScan.ruleCounts");
  number(counts.passes, "frameScan.ruleCounts.passes");
  number(counts.inapplicable, "frameScan.ruleCounts.inapplicable");
  if (!Array.isArray(frameScan.childFrames))
    throw new MessageValidationError("frameScan.childFrames must be an array");
  frameScan.childFrames.forEach((item, index) => {
    const descriptor = record(item, `frameScan.childFrames[${index}]`);
    string(descriptor.selector, `frameScan.childFrames[${index}].selector`);
    string(descriptor.url, `frameScan.childFrames[${index}].url`);
    if (typeof descriptor.sameOrigin !== "boolean")
      throw new MessageValidationError(
        `frameScan.childFrames[${index}].sameOrigin must be a boolean`,
      );
    return descriptor as unknown as ChildFrameDescriptorV1;
  });
  if (!Array.isArray(frameScan.findings))
    throw new MessageValidationError("frameScan.findings must be an array");
  frameScan.findings.forEach((item, index) =>
    parseFinding(item, `frameScan.findings[${index}]`),
  );
  return frameScan as unknown as FrameScanV1;
}

export function parseExtensionRequest(value: unknown): ExtensionRequest {
  const message = versioned(value);
  if (message.type === "get-state")
    return { schemaVersion: SCHEMA_VERSION, type: "get-state" };
  if (message.type === "scan-request") {
    exactKeys(message, ["schemaVersion", "type", "scan"], "message");
    if (message.scan === undefined)
      return { schemaVersion: SCHEMA_VERSION, type: "scan-request" };
    const scan = record(message.scan, "scan");
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "scan-request",
      scan: {
        scanId: string(scan.scanId, "scan.scanId"),
        frameId: integer(scan.frameId, "scan.frameId", 0),
      },
    };
  }
  if (message.type === "scan-cancel") {
    exactKeys(message, ["schemaVersion", "type"], "message");
    return { schemaVersion: SCHEMA_VERSION, type: "scan-cancel" };
  }
  if (message.type === "scan-stale") {
    exactKeys(message, ["schemaVersion", "type", "reason"], "message");
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "scan-stale",
      reason: string(message.reason, "reason"),
    };
  }
  if (message.type === "assistant-settings-get") {
    exactKeys(message, ["schemaVersion", "type"], "message");
    return { schemaVersion: SCHEMA_VERSION, type: "assistant-settings-get" };
  }
  if (message.type === "assistant-settings-set") {
    exactKeys(message, ["schemaVersion", "type", "settings"], "message");
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "assistant-settings-set",
      settings: parseAssistantSettings(message.settings),
    };
  }
  if (
    message.type === "assistant-test" ||
    message.type === "assistant-cancel"
  ) {
    exactKeys(message, ["schemaVersion", "type"], "message");
    return {
      schemaVersion: SCHEMA_VERSION,
      type: message.type,
    };
  }
  if (
    message.type === "assistant-preview" ||
    message.type === "assistant-generate" ||
    message.type === "assistant-evidence"
  ) {
    exactKeys(message, ["schemaVersion", "type", "findingId"], "message");
    return {
      schemaVersion: SCHEMA_VERSION,
      type: message.type,
      findingId: string(message.findingId, "findingId"),
    };
  }
  if (
    message.type === "github-get-state" ||
    message.type === "github-start-device-flow" ||
    message.type === "github-poll-device-flow" ||
    message.type === "github-cancel-device-flow" ||
    message.type === "github-disconnect" ||
    message.type === "github-list-repositories" ||
    message.type === "github-get-mappings"
  ) {
    return { schemaVersion: SCHEMA_VERSION, type: message.type };
  }
  if (message.type === "github-list-labels") {
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "github-list-labels",
      owner: string(message.owner, "owner"),
      repo: string(message.repo, "repo"),
    };
  }
  if (message.type === "github-save-mapping") {
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "github-save-mapping",
      mapping: parseDomainRepositoryMapping(message.mapping),
    };
  }
  if (message.type === "github-delete-mapping") {
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "github-delete-mapping",
      domainKey: string(message.domainKey, "domainKey"),
    };
  }
  if (message.type === "github-create-issue") {
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "github-create-issue",
      findingId: string(message.findingId, "findingId"),
      operationId: string(message.operationId, "operationId"),
    };
  }
  if (message.type === "github-check-issue") {
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "github-check-issue",
      findingId: string(message.findingId, "findingId"),
    };
  }
  if (message.type === "open-integrations-page") {
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "open-integrations-page",
      ...(typeof message.domainKey === "string"
        ? { domainKey: message.domainKey }
        : {}),
    };
  }

  if (message.type !== "overlay-command")
    throw new MessageValidationError(
      `Unknown message type: ${String(message.type)}`,
    );
  if (
    !["show-all", "hide", "select", "deselect", "clear"].includes(
      String(message.command),
    )
  )
    throw new MessageValidationError(
      `Unknown overlay command: ${String(message.command)}`,
    );
  if (message.command === "select") string(message.findingId, "findingId");
  return {
    schemaVersion: SCHEMA_VERSION,
    type: "overlay-command",
    command: message.command as
      | "show-all"
      | "hide"
      | "select"
      | "deselect"
      | "clear",
    ...(typeof message.findingId === "string"
      ? { findingId: message.findingId }
      : {}),
  };
}

export function parseExtensionResponse(value: unknown): ExtensionResponse {
  const message = versioned(value);
  const githubTypes = [
    "github-state-result",
    "github-device-flow-start-result",
    "github-device-flow-poll-result",
    "github-repositories-result",
    "github-labels-result",
    "github-mappings-result",
    "github-create-issue-result",
    "github-check-issue-result",
    "github-command-result",
  ];
  if (githubTypes.includes(String(message.type))) {
    if (message.ok === false) {
      const error = record(message.error, "error");
      const errorType = message.type as Extract<
        ExtensionResponse,
        { ok: false; error: GitHubFailure }
      >["type"];
      return {
        schemaVersion: SCHEMA_VERSION,
        type: errorType,
        ok: false,
        error: {
          code: string(error.code, "error.code"),
          message: string(error.message, "error.message"),
          ...(typeof error.ambiguous === "boolean"
            ? { ambiguous: error.ambiguous }
            : {}),
        },
      } as ExtensionResponse;
    }
    if (message.ok !== true)
      throw new MessageValidationError("ok must be a boolean");
    if (message.type === "github-state-result") {
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "github-state-result",
        ok: true,
        connection: parseGitHubConnectionView(message.connection),
        permissionGranted: Boolean(message.permissionGranted),
      };
    }
    if (message.type === "github-device-flow-start-result") {
      const flow = record(message.flow, "flow");
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "github-device-flow-start-result",
        ok: true,
        flow: {
          userCode: string(flow.userCode, "userCode"),
          verificationUri: string(flow.verificationUri, "verificationUri"),
          expiresIn: number(flow.expiresIn, "expiresIn"),
          interval: number(flow.interval, "interval"),
        } as DeviceFlowCodeResponse,
      };
    }
    if (message.type === "github-device-flow-poll-result") {
      const result = record(message.result, "result");
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "github-device-flow-poll-result",
        ok: true,
        result: result as unknown as DevicePollResult,
      };
    }
    if (message.type === "github-repositories-result") {
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "github-repositories-result",
        ok: true,
        repositories: (message.repositories as GitHubRepositoryV1[]) ?? [],
      };
    }
    if (message.type === "github-labels-result") {
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "github-labels-result",
        ok: true,
        labels: (message.labels as GitHubLabelV1[]) ?? [],
      };
    }
    if (message.type === "github-mappings-result") {
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "github-mappings-result",
        ok: true,
        mappings: (Array.isArray(message.mappings) ? message.mappings : []).map(
          parseDomainRepositoryMapping,
        ),
      };
    }
    if (message.type === "github-create-issue-result") {
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "github-create-issue-result",
        ok: true,
        issueNumber: number(message.issueNumber, "issueNumber"),
        htmlUrl: string(message.htmlUrl, "htmlUrl"),
        labelMissing: Boolean(message.labelMissing),
      };
    }
    if (message.type === "github-check-issue-result") {
      const existingObj = message.existing
        ? record(message.existing, "existing")
        : null;
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "github-check-issue-result",
        ok: true,
        existing: existingObj
          ? {
              issueNumber: number(existingObj.issueNumber, "issueNumber"),
              htmlUrl: string(existingObj.htmlUrl, "htmlUrl"),
            }
          : null,
        mapped: Boolean(message.mapped),
        domainKey:
          typeof message.domainKey === "string" ? message.domainKey : null,
      };
    }
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "github-command-result",
      ok: true,
    };
  }

  const assistantTypes = [
    "assistant-settings-result",
    "assistant-test-result",
    "assistant-preview-result",
    "assistant-result",
    "assistant-command-result",
  ];
  if (assistantTypes.includes(String(message.type))) {
    if (message.ok === false) {
      const error = record(message.error, "error");
      const codes: AssistantMessageErrorCode[] = [
        "invalid-configuration",
        "permission-denied",
        "unavailable-server",
        "missing-model",
        "timeout",
        "cancelled",
        "redirect-rejected",
        "http-failure",
        "invalid-json",
        "invalid-schema",
        "disabled",
        "stale-finding",
      ];
      if (!codes.includes(error.code as AssistantMessageErrorCode))
        throw new MessageValidationError("assistant error code is invalid");
      return {
        schemaVersion: SCHEMA_VERSION,
        type: message.type as Extract<
          ExtensionResponse,
          { ok: false; error: AssistantFailure }
        >["type"],
        ok: false,
        error: {
          code: error.code as AssistantMessageErrorCode,
          message: string(error.message, "error.message"),
        },
      };
    }
    if (message.ok !== true)
      throw new MessageValidationError("ok must be a boolean");
    if (message.type === "assistant-settings-result") {
      if (typeof message.permissionGranted !== "boolean")
        throw new MessageValidationError("permissionGranted must be a boolean");
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-settings-result",
        ok: true,
        settings: parseAssistantSettings(message.settings),
        permissionGranted: message.permissionGranted,
      };
    }
    if (message.type === "assistant-test-result") {
      if (message.available !== true)
        throw new MessageValidationError("available must be true");
      const provider = record(message.provider, "provider");
      if (
        provider.id !== "ollama-local" ||
        provider.label !== "Ollama-compatible local provider" ||
        !Array.isArray(provider.capabilities)
      )
        throw new MessageValidationError("provider identity is invalid");
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-test-result",
        ok: true,
        available: true,
        provider: provider as AssistantProviderIdentity,
      };
    }
    if (message.type === "assistant-preview-result")
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-preview-result",
        ok: true,
        request: parseAssistantRequest(message.request),
      };
    if (message.type === "assistant-result")
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-result",
        ok: true,
        response: parseAssistantResponse(message.response),
      };
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "assistant-command-result",
      ok: true,
    };
  }
  if (
    message.type !== "scan-result" &&
    message.type !== "command-result" &&
    message.type !== "state-result" &&
    message.type !== "frame-scan-result"
  )
    throw new MessageValidationError(
      `Unknown response type: ${String(message.type)}`,
    );
  if (message.ok === true) {
    if (message.type === "scan-result")
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "scan-result",
        ok: true,
        report: parseScanReport(message.report),
      };
    if (message.type === "state-result") {
      if (message.stale !== undefined && typeof message.stale !== "boolean")
        throw new MessageValidationError("stale must be a boolean");
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "state-result",
        ok: true,
        report:
          message.report === null ? null : parseScanReport(message.report),
        ...(message.stale === undefined ? {} : { stale: message.stale }),
        ...(message.staleReason === undefined
          ? {}
          : { staleReason: string(message.staleReason, "staleReason") }),
      };
    }
    if (message.type === "frame-scan-result")
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "frame-scan-result",
        ok: true,
        frameScan: parseFrameScan(message.frameScan),
      };
    return { schemaVersion: SCHEMA_VERSION, type: "command-result", ok: true };
  }
  if (message.ok !== false)
    throw new MessageValidationError("ok must be a boolean");
  const error = record(message.error, "error");
  if (!scanErrorCodes.includes(error.code as ScanErrorCode))
    throw new MessageValidationError("error.code is invalid");
  return {
    schemaVersion: SCHEMA_VERSION,
    type: message.type,
    ok: false,
    error: {
      code: error.code as ScanErrorCode,
      message: string(error.message, "error.message"),
    },
  };
}

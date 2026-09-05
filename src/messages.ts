import {
  parseAssistantRequest,
  parseAssistantResponse,
  type AssistantRequestV1,
  type AssistantResponseV1,
} from "./assistant-contracts";
import type { ScanReportV1 } from "./contracts";
import { SCHEMA_VERSION } from "./contracts";
import {
  parseAssistantSettings,
  type AssistantFailureCode,
  type AssistantProviderIdentity,
  type AssistantSettingsV1,
} from "./ollama";

export type ScanErrorCode =
  | "invalid-message"
  | "unsupported-page"
  | "permission-denied"
  | "scan-failed"
  | "stale-finding";

export type ScanFailure = { code: ScanErrorCode; message: string };
export type AssistantMessageErrorCode =
  | AssistantFailureCode
  | "disabled"
  | "stale-finding";
export type AssistantFailure = {
  code: AssistantMessageErrorCode;
  message: string;
};

export type ExtensionRequest =
  | { schemaVersion: typeof SCHEMA_VERSION; type: "get-state" }
  | { schemaVersion: typeof SCHEMA_VERSION; type: "scan-request" }
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
      command: "show-all" | "hide" | "select" | "clear";
      findingId?: string;
    };

export type ExtensionResponse =
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "state-result";
      ok: true;
      report: ScanReportV1 | null;
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
      type: "scan-result" | "command-result" | "state-result";
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
  const coverage = record(report.coverage, "coverage");
  if (typeof coverage.complete !== "boolean")
    throw new MessageValidationError("coverage.complete must be a boolean");
  const counts = record(coverage.ruleCounts, "coverage.ruleCounts");
  number(counts.passes, "coverage.ruleCounts.passes");
  number(counts.inapplicable, "coverage.ruleCounts.inapplicable");
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
  report.findings.forEach((item, index) => {
    const finding = record(item, `findings[${index}]`);
    [
      "findingId",
      "ruleId",
      "help",
      "helpUrl",
      "failureSummary",
      "evidence",
      "nodeRef",
    ].forEach((key) => string(finding[key], `findings[${index}].${key}`));
    if (finding.status !== "violation" && finding.status !== "needs-review")
      throw new MessageValidationError(`findings[${index}].status is invalid`);
    if (
      !["critical", "serious", "moderate", "minor", "unknown"].includes(
        String(finding.impact),
      )
    )
      throw new MessageValidationError(`findings[${index}].impact is invalid`);
    strings(finding.tags, `findings[${index}].tags`);
    const locator = record(finding.locator, `findings[${index}].locator`);
    if (!Array.isArray(locator.segments) || locator.segments.length === 0)
      throw new MessageValidationError(
        `findings[${index}].locator.segments must not be empty`,
      );
    locator.segments.forEach((item, segmentIndex) => {
      const segment = record(
        item,
        `findings[${index}].locator.segments[${segmentIndex}]`,
      );
      if (!["css", "frame", "shadow"].includes(String(segment.type)))
        throw new MessageValidationError(
          `findings[${index}].locator segment type is invalid`,
        );
      string(segment.selector, `findings[${index}].locator segment selector`);
    });
  });
  return report as ScanReportV1;
}

export function parseExtensionRequest(value: unknown): ExtensionRequest {
  const message = versioned(value);
  if (message.type === "get-state")
    return { schemaVersion: SCHEMA_VERSION, type: "get-state" };
  if (message.type === "scan-request")
    return { schemaVersion: SCHEMA_VERSION, type: "scan-request" };
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
  if (message.type !== "overlay-command")
    throw new MessageValidationError(
      `Unknown message type: ${String(message.type)}`,
    );
  if (
    !["show-all", "hide", "select", "clear"].includes(String(message.command))
  )
    throw new MessageValidationError(
      `Unknown overlay command: ${String(message.command)}`,
    );
  if (message.command === "select") string(message.findingId, "findingId");
  return {
    schemaVersion: SCHEMA_VERSION,
    type: "overlay-command",
    command: message.command as "show-all" | "hide" | "select" | "clear",
    ...(typeof message.findingId === "string"
      ? { findingId: message.findingId }
      : {}),
  };
}

export function parseExtensionResponse(value: unknown): ExtensionResponse {
  const message = versioned(value);
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
    message.type !== "state-result"
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
    if (message.type === "state-result")
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "state-result",
        ok: true,
        report:
          message.report === null ? null : parseScanReport(message.report),
      };
    return { schemaVersion: SCHEMA_VERSION, type: "command-result", ok: true };
  }
  if (message.ok !== false)
    throw new MessageValidationError("ok must be a boolean");
  const error = record(message.error, "error");
  if (
    ![
      "invalid-message",
      "unsupported-page",
      "permission-denied",
      "scan-failed",
      "stale-finding",
    ].includes(String(error.code))
  )
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

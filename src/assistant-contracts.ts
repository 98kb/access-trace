import type { FindingImpact, FindingStatus } from "./contracts";
import { SCHEMA_VERSION } from "./contracts";

export const ASSISTANT_REQUEST_MAX_BYTES = 8_192;
export const ASSISTANT_RESPONSE_MAX_BYTES = 8_192;

export type ElementEvidenceV1 = {
  tagName: string;
  role: string;
  accessibleName: string;
  attributes: Record<string, string>;
  visibleText: string;
  nearbyText?: string;
  computedStyles: Record<string, string>;
};

export type AssistantRequestV1 = {
  schemaVersion: typeof SCHEMA_VERSION;
  operation: "explain-finding";
  finding: {
    ruleId: string;
    source: "axe-core";
    status: FindingStatus;
    impact: FindingImpact;
    tags: string[];
    help: string;
    failureSummary: string;
  };
  evidence: ElementEvidenceV1;
  disclosure: {
    execution: "local";
    screenshotIncluded: false;
    evidenceCategories: string[];
  };
};

export type AssistantResponseV1 = {
  schemaVersion: typeof SCHEMA_VERSION;
  summary: string;
  rationale: string;
  remediationOptions: string[];
  manualChecks: string[];
  confidence: number;
  advisoryStatus: "advisory";
};

export class AssistantValidationError extends Error {}

export const EVIDENCE_ATTRIBUTE_NAMES = [
  "alt",
  "aria-describedby",
  "aria-label",
  "aria-labelledby",
  "lang",
  "role",
  "title",
  "type",
] as const;
const evidenceAttributes = new Set<string>(EVIDENCE_ATTRIBUTE_NAMES);
const evidenceStyles = new Set([
  "background-color",
  "color",
  "font-size",
  "font-weight",
]);
const sensitiveEvidence =
  /(?:authorization|bearer\s|cookie|password|passwd|secret|session|token|api[-_ ]?key|private[-_ ]?key|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+?\d[\d ().-]{7,}\d)/i;
const authoritativeReference = /(?:\bwcag\b|https?:\/\/|www\.)/i;

export function isSensitiveEvidenceText(value: string): boolean {
  return sensitiveEvidence.test(value);
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AssistantValidationError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected)
    throw new AssistantValidationError(
      `${label} has unexpected field: ${unexpected}`,
    );
}

function boundedString(
  value: unknown,
  label: string,
  max: number,
  allowEmpty = true,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > max
  )
    throw new AssistantValidationError(
      `${label} must be ${allowEmpty ? "at most" : "1 to"} ${max} characters`,
    );
  return value;
}

function boundedEvidenceString(
  value: unknown,
  label: string,
  max: number,
): string {
  const result = boundedString(value, label, max);
  if (isSensitiveEvidenceText(result))
    throw new AssistantValidationError(`${label} contains sensitive data`);
  return result;
}

function boundedAdvisoryString(
  value: unknown,
  label: string,
  max: number,
): string {
  const result = boundedString(value, label, max, false);
  if (authoritativeReference.test(result))
    throw new AssistantValidationError(
      `${label} must not contain standard references or URLs`,
    );
  return result;
}

function advisoryStringArray(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new AssistantValidationError(
      `${label} must contain ${min} to ${max} items`,
    );
  return value.map((item, index) =>
    boundedAdvisoryString(item, `${label}[${index}]`, 500),
  );
}

function stringArray(
  value: unknown,
  label: string,
  min: number,
  max: number,
  itemMax: number,
): string[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new AssistantValidationError(
      `${label} must contain ${min} to ${max} items`,
    );
  return value.map((item, index) =>
    boundedString(item, `${label}[${index}]`, itemMax, false),
  );
}

function serializedLimit(value: unknown, label: string, max: number): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new AssistantValidationError(`${label} must be serializable`);
  }
  if (new TextEncoder().encode(serialized).length > max)
    throw new AssistantValidationError(
      `${label} serialized size exceeds ${max} bytes`,
    );
}

function stringMap(
  value: unknown,
  label: string,
  allowed: Set<string>,
  maxEntries: number,
): Record<string, string> {
  const map = object(value, label);
  if (Object.keys(map).length > maxEntries)
    throw new AssistantValidationError(`${label} has too many fields`);
  return Object.fromEntries(
    Object.entries(map).map(([key, item]) => {
      if (!allowed.has(key))
        throw new AssistantValidationError(
          `${label} has unexpected field: ${key}`,
        );
      return [key, boundedEvidenceString(item, `${label}.${key}`, 200)];
    }),
  );
}

export function parseAssistantRequest(value: unknown): AssistantRequestV1 {
  serializedLimit(value, "request", ASSISTANT_REQUEST_MAX_BYTES);
  const request = object(value, "request");
  exactKeys(
    request,
    ["schemaVersion", "operation", "finding", "evidence", "disclosure"],
    "request",
  );
  if (request.schemaVersion !== SCHEMA_VERSION)
    throw new AssistantValidationError("schemaVersion must be 1.0");
  if (request.operation !== "explain-finding")
    throw new AssistantValidationError("operation is unsupported");

  const finding = object(request.finding, "finding");
  exactKeys(
    finding,
    ["ruleId", "source", "status", "impact", "tags", "help", "failureSummary"],
    "finding",
  );
  boundedString(finding.ruleId, "finding.ruleId", 100, false);
  if (finding.source !== "axe-core")
    throw new AssistantValidationError("finding.source must be axe-core");
  if (finding.status !== "violation" && finding.status !== "needs-review")
    throw new AssistantValidationError("finding.status is invalid");
  if (
    !["critical", "serious", "moderate", "minor", "unknown"].includes(
      String(finding.impact),
    )
  )
    throw new AssistantValidationError("finding.impact is invalid");
  stringArray(finding.tags, "finding.tags", 0, 16, 64);
  boundedString(finding.help, "finding.help", 500);
  boundedString(finding.failureSummary, "finding.failureSummary", 1_000);

  const evidence = object(request.evidence, "evidence");
  exactKeys(
    evidence,
    [
      "tagName",
      "role",
      "accessibleName",
      "attributes",
      "visibleText",
      "nearbyText",
      "computedStyles",
    ],
    "evidence",
  );
  boundedString(evidence.tagName, "evidence.tagName", 32, false);
  boundedString(evidence.role, "evidence.role", 100);
  boundedEvidenceString(
    evidence.accessibleName,
    "evidence.accessibleName",
    300,
  );
  stringMap(evidence.attributes, "evidence.attributes", evidenceAttributes, 8);
  boundedEvidenceString(evidence.visibleText, "evidence.visibleText", 500);
  if (evidence.nearbyText !== undefined)
    boundedEvidenceString(evidence.nearbyText, "evidence.nearbyText", 300);
  stringMap(
    evidence.computedStyles,
    "evidence.computedStyles",
    evidenceStyles,
    4,
  );

  const disclosure = object(request.disclosure, "disclosure");
  exactKeys(
    disclosure,
    ["execution", "screenshotIncluded", "evidenceCategories"],
    "disclosure",
  );
  if (disclosure.execution !== "local")
    throw new AssistantValidationError("disclosure.execution must be local");
  if (disclosure.screenshotIncluded !== false)
    throw new AssistantValidationError(
      "disclosure.screenshotIncluded must be false",
    );
  stringArray(
    disclosure.evidenceCategories,
    "disclosure.evidenceCategories",
    1,
    10,
    40,
  );
  return request as AssistantRequestV1;
}

export function parseAssistantResponse(value: unknown): AssistantResponseV1 {
  serializedLimit(value, "response", ASSISTANT_RESPONSE_MAX_BYTES);
  const response = object(value, "response");
  exactKeys(
    response,
    [
      "schemaVersion",
      "summary",
      "rationale",
      "remediationOptions",
      "manualChecks",
      "confidence",
      "advisoryStatus",
    ],
    "response",
  );
  if (response.schemaVersion !== SCHEMA_VERSION)
    throw new AssistantValidationError("schemaVersion must be 1.0");
  boundedAdvisoryString(response.summary, "summary", 500);
  boundedAdvisoryString(response.rationale, "rationale", 1_500);
  advisoryStringArray(response.remediationOptions, "remediationOptions", 1, 5);
  advisoryStringArray(response.manualChecks, "manualChecks", 0, 5);
  if (
    typeof response.confidence !== "number" ||
    !Number.isFinite(response.confidence) ||
    response.confidence < 0 ||
    response.confidence > 1
  )
    throw new AssistantValidationError("confidence must be between 0 and 1");
  if (response.advisoryStatus !== "advisory")
    throw new AssistantValidationError("advisoryStatus must be advisory");
  return response as AssistantResponseV1;
}

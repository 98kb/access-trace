import { describe, expect, it } from "vitest";

import {
  ASSISTANT_REQUEST_MAX_BYTES,
  parseAssistantRequest,
  parseAssistantResponse,
} from "../src/assistant-contracts";

export const safeRequest = {
  schemaVersion: "1.0",
  operation: "explain-finding",
  finding: {
    ruleId: "image-alt",
    source: "axe-core",
    status: "violation",
    impact: "critical",
    tags: ["wcag2a", "wcag111"],
    help: "Images must have alternative text",
    failureSummary: "Add alternative text.",
  },
  evidence: {
    tagName: "img",
    role: "img",
    accessibleName: "",
    attributes: { alt: "", type: "image" },
    visibleText: "",
    computedStyles: {},
  },
  disclosure: {
    execution: "local",
    screenshotIncluded: false,
    evidenceCategories: ["tag name", "attributes"],
  },
} as const;

export const safeResponse = {
  schemaVersion: "1.0",
  summary: "The image has no text alternative.",
  rationale: "The scanner found an image without an accessible name.",
  remediationOptions: ["Add an alt attribute describing the image."],
  manualChecks: ["Confirm whether the image is informative or decorative."],
  confidence: 0.88,
  advisoryStatus: "advisory",
} as const;

describe("assistant contracts", () => {
  it("parses safe provider-neutral V1 requests and responses", () => {
    expect(parseAssistantRequest(safeRequest)).toEqual(safeRequest);
    expect(parseAssistantResponse(safeResponse)).toEqual(safeResponse);
  });

  it.each([
    [{ ...safeRequest, schemaVersion: "2.0" }, "schemaVersion"],
    [{ ...safeRequest, operation: "scan-page" }, "operation"],
    [{ ...safeRequest, pageHtml: "<main>secret</main>" }, "unexpected field"],
    [
      {
        ...safeRequest,
        evidence: { ...safeRequest.evidence, visibleText: "x".repeat(501) },
      },
      "evidence.visibleText",
    ],
  ])("fails closed for unsafe requests", (request, message) => {
    expect(() => parseAssistantRequest(request)).toThrow(message);
  });

  it("enforces the total serialized request limit", () => {
    const oversized = {
      ...safeRequest,
      finding: {
        ...safeRequest.finding,
        failureSummary: "x".repeat(ASSISTANT_REQUEST_MAX_BYTES),
      },
    };
    expect(() => parseAssistantRequest(oversized)).toThrow("serialized");
  });

  it("rejects secret-looking page evidence even when it uses an allowed field", () => {
    expect(() =>
      parseAssistantRequest({
        ...safeRequest,
        evidence: {
          ...safeRequest.evidence,
          attributes: { "aria-label": "Bearer abcdefghijklmnopqrstuvwxyz" },
        },
      }),
    ).toThrow("sensitive");
  });

  it.each([
    [{ ...safeResponse, schemaVersion: "2.0" }, "schemaVersion"],
    [{ ...safeResponse, confidence: 2 }, "confidence"],
    [{ ...safeResponse, advisoryStatus: "compliant" }, "advisoryStatus"],
    [
      { ...safeResponse, helpUrl: "https://invented.example" },
      "unexpected field",
    ],
    [{ ...safeResponse, remediationOptions: [] }, "remediationOptions"],
    [
      {
        ...safeResponse,
        rationale: "This maps to WCAG 1.1.1 at https://invented.example/help.",
      },
      "standard references or URLs",
    ],
  ])("fails closed for untrusted model responses", (response, message) => {
    expect(() => parseAssistantResponse(response)).toThrow(message);
  });
});

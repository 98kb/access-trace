import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../../src/contracts";
import {
  parseExtensionRequest,
  parseExtensionResponse,
} from "../../src/messages";

describe("GitHub extension message parsing", () => {
  it("parses github-get-state request and response", () => {
    const req = parseExtensionRequest({
      schemaVersion: SCHEMA_VERSION,
      type: "github-get-state",
    });
    expect(req.type).toBe("github-get-state");

    const res = parseExtensionResponse({
      schemaVersion: SCHEMA_VERSION,
      type: "github-state-result",
      ok: true,
      connection: {
        schemaVersion: "1.0",
        state: "disconnected",
        user: null,
        expiresAt: null,
        error: null,
      },
      permissionGranted: false,
    });
    expect(res.type).toBe("github-state-result");
  });

  it("parses github-create-issue request and response", () => {
    const req = parseExtensionRequest({
      schemaVersion: SCHEMA_VERSION,
      type: "github-create-issue",
      findingId: "f-123",
      operationId: "op-456",
    });
    expect(req.type).toBe("github-create-issue");
    if (req.type === "github-create-issue") {
      expect(req.findingId).toBe("f-123");
      expect(req.operationId).toBe("op-456");
    }

    const res = parseExtensionResponse({
      schemaVersion: SCHEMA_VERSION,
      type: "github-create-issue-result",
      ok: true,
      issueNumber: 42,
      htmlUrl: "https://github.com/org/repo/issues/42",
      labelMissing: false,
    });
    expect(res.type).toBe("github-create-issue-result");
  });

  it("parses open-integrations-page request", () => {
    const req = parseExtensionRequest({
      schemaVersion: SCHEMA_VERSION,
      type: "open-integrations-page",
      domainKey: "example.com",
    });
    expect(req.type).toBe("open-integrations-page");
  });
});

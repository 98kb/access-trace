import { describe, expect, it } from "vitest";

import { parseExtensionRequest, parseExtensionResponse } from "../src/messages";

const report = {
  schemaVersion: "1.0",
  scanId: "scan-1",
  scanner: { name: "axe-core", version: "4.13.0" },
  page: { url: "https://example.test", title: "Example" },
  startedAt: "2026-09-05T10:00:00.000Z",
  durationMs: 12,
  coverage: { complete: true, ruleCounts: { passes: 1, inapplicable: 2 } },
  findings: [],
  warnings: [],
  skippedRegions: [],
} as const;

describe("extension message parsing", () => {
  it("accepts versioned requests and responses", () => {
    expect(
      parseExtensionRequest({ schemaVersion: "1.0", type: "scan-request" }),
    ).toEqual({
      schemaVersion: "1.0",
      type: "scan-request",
    });
    expect(
      parseExtensionRequest({
        schemaVersion: "1.0",
        type: "overlay-command",
        command: "select",
        findingId: "finding-1",
      }),
    ).toMatchObject({ command: "select", findingId: "finding-1" });
    expect(
      parseExtensionResponse({
        schemaVersion: "1.0",
        type: "scan-result",
        ok: true,
        report,
      }),
    ).toMatchObject({
      ok: true,
      report: { scanId: "scan-1" },
    });
  });

  it.each([
    [
      { schemaVersion: "2.0", type: "scan-request" },
      "Unsupported schema version",
    ],
    [{ schemaVersion: "1.0", type: "surprise" }, "Unknown message type"],
    [
      { schemaVersion: "1.0", type: "overlay-command", command: "select" },
      "findingId",
    ],
    [
      {
        schemaVersion: "1.0",
        type: "scan-result",
        ok: true,
        report: { schemaVersion: "1.0" },
      },
      "scanId",
    ],
  ])("fails closed for malformed messages", (message, expected) => {
    expect(() =>
      "ok" in message
        ? parseExtensionResponse(message)
        : parseExtensionRequest(message),
    ).toThrow(expected);
  });
});

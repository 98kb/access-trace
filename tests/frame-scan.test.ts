import { describe, expect, it, vi } from "vitest";

import type { FrameScanV1 } from "../src/aggregate";
import type { FindingV1 } from "../src/contracts";
import {
  broadcastCommand,
  routeSelection,
  runTabScan,
  type FrameTransport,
} from "../src/frame-scan";

function finding(frameId: number, ruleId: string): FindingV1 {
  return {
    findingId: `scan-1:${frameId}:${ruleId}`,
    ruleId,
    status: "violation",
    impact: "critical",
    tags: [],
    help: "help",
    helpUrl: "https://example.test/rule",
    failureSummary: "summary",
    locator: { segments: [{ type: "css", selector: "img" }] },
    evidence: "<img>",
    nodeRef: `scan-1:${frameId}:abc`,
    frame: {
      frameId,
      parentFrameId: frameId === 0 ? -1 : 0,
      url: "https://example.test/",
      depth: frameId === 0 ? 0 : 1,
    },
  };
}

function frameScan(overrides: Partial<FrameScanV1> = {}): FrameScanV1 {
  return {
    scanId: "scan-1",
    scannerVersion: "4.13.0",
    frameId: 0,
    parentFrameId: -1,
    depth: 0,
    url: "https://example.test/",
    childFrames: [],
    openShadowRoots: 0,
    closedShadowRoots: 0,
    ruleCounts: { passes: 1, inapplicable: 1 },
    findings: [],
    ...overrides,
  };
}

const okFrame = (frameScan: FrameScanV1) => ({
  schemaVersion: "1.0",
  type: "frame-scan-result",
  ok: true,
  frameScan,
});

const base = {
  tabId: 1,
  scanId: "scan-1",
  page: { url: "https://example.test/", title: "Example" },
  startedAt: "2026-09-05T10:00:00.000Z",
  elapsedMs: () => 25,
};

describe("runTabScan", () => {
  it("aggregates every injected frame into one report", async () => {
    const transport: FrameTransport = {
      inject: async () => [0, 3],
      send: async (_tabId, frameId) =>
        okFrame(
          frameId === 0
            ? frameScan({
                findings: [finding(0, "image-alt")],
                childFrames: [
                  {
                    selector: "#child",
                    url: "https://example.test/child",
                    sameOrigin: true,
                  },
                ],
              })
            : frameScan({
                frameId: 3,
                depth: 1,
                url: "https://example.test/child",
                findings: [finding(3, "label")],
              }),
        ),
    };

    const report = await runTabScan({ ...base, transport });

    expect(report.findings.map((item) => item.ruleId)).toEqual([
      "image-alt",
      "label",
    ]);
    expect(report.coverage.frames).toMatchObject({ discovered: 1, scanned: 1 });
    expect(report.coverage.complete).toBe(true);
  });

  it("records a frame that never answers as a failed region, not a scanned one", async () => {
    vi.useFakeTimers();
    const transport: FrameTransport = {
      inject: async () => [0, 7],
      send: (_tabId, frameId) =>
        frameId === 0
          ? Promise.resolve(
              okFrame(
                frameScan({
                  childFrames: [
                    {
                      selector: "#slow",
                      url: "https://example.test/slow",
                      sameOrigin: true,
                    },
                  ],
                }),
              ),
            )
          : new Promise(() => {}),
    };

    const pending = runTabScan({ ...base, transport, frameTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    const report = await pending;

    expect(report.coverage.frames).toMatchObject({ scanned: 0, failed: 1 });
    expect(report.coverage.regions).toContainEqual(
      expect.objectContaining({
        kind: "frame",
        state: "failed",
        reason: "timeout",
      }),
    );
    vi.useRealTimers();
  });

  it("discards a frame answering for a superseded scan", async () => {
    const transport: FrameTransport = {
      inject: async () => [0, 2],
      send: async (_tabId, frameId) =>
        okFrame(
          frameId === 0
            ? frameScan({})
            : frameScan({ scanId: "scan-0", frameId: 2, depth: 1 }),
        ),
    };

    const report = await runTabScan({ ...base, transport });

    expect(report.coverage.frames).toMatchObject({ scanned: 0, failed: 1 });
    expect(report.findings).toEqual([]);
  });

  it("raises a typed permission failure when nothing could be injected", async () => {
    await expect(
      runTabScan({
        ...base,
        transport: { inject: async () => [], send: async () => undefined },
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });

    await expect(
      runTabScan({
        ...base,
        transport: {
          inject: async () => {
            throw new Error("Cannot access contents of the page");
          },
          send: async () => undefined,
        },
      }),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("marks an aborted scan as cancelled coverage rather than a clean result", async () => {
    const controller = new AbortController();
    controller.abort();
    const report = await runTabScan({
      ...base,
      signal: controller.signal,
      transport: {
        inject: async () => [0],
        send: async () => okFrame(frameScan({})),
      },
    });

    expect(report.coverage.cancelled).toBe(true);
    expect(report.coverage.complete).toBe(false);
  });
});

describe("routeSelection", () => {
  const acknowledge = {
    schemaVersion: "1.0",
    type: "command-result",
    ok: true,
  };

  it("selects in the owning frame and deselects in the others", async () => {
    const sent: Array<{ frameId: number; command: string }> = [];
    const transport: FrameTransport = {
      inject: async () => [],
      send: async (_tabId, frameId, message) => {
        sent.push({
          frameId,
          command: (message as { command: string }).command,
        });
        return acknowledge;
      },
    };

    await expect(
      routeSelection({
        tabId: 1,
        frameIds: [0, 4, 9],
        owningFrameId: 4,
        findingId: "f1",
        transport,
      }),
    ).resolves.toEqual({ ok: true });
    expect(sent).toEqual([
      { frameId: 0, command: "deselect" },
      { frameId: 9, command: "deselect" },
      { frameId: 4, command: "select" },
    ]);
  });

  it("reports an unreachable owning frame distinctly from a stale target", async () => {
    await expect(
      routeSelection({
        tabId: 1,
        frameIds: [0, 4],
        owningFrameId: 4,
        findingId: "f1",
        transport: {
          inject: async () => [],
          send: async (_tabId, frameId) => {
            if (frameId === 4) throw new Error("Receiving end does not exist.");
            return acknowledge;
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "frame-unreachable" },
    });

    await expect(
      routeSelection({
        tabId: 1,
        frameIds: [0],
        owningFrameId: 0,
        findingId: "f1",
        transport: {
          inject: async () => [],
          send: async () => ({
            schemaVersion: "1.0",
            type: "command-result",
            ok: false,
            error: { code: "stale-finding", message: "The page changed." },
          }),
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-finding" } });
  });

  it("refuses to guess a frame when the finding has no frame identity", async () => {
    await expect(
      routeSelection({
        tabId: 1,
        frameIds: [0, 4],
        owningFrameId: undefined,
        findingId: "f1",
        transport: {
          inject: async () => [],
          send: async () => {
            throw new Error("should not be called");
          },
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-finding" } });
  });

  it("treats a missing content context as an explicit failure", async () => {
    await expect(
      routeSelection({
        tabId: 1,
        frameIds: [0],
        owningFrameId: 0,
        findingId: "f1",
        transport: { inject: async () => [], send: async () => undefined },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "frame-unreachable" },
    });
  });
});

describe("broadcastCommand", () => {
  const acknowledge = {
    schemaVersion: "1.0",
    type: "command-result",
    ok: true,
  };

  it("acknowledges only when every scanned frame acknowledges", async () => {
    const seen: number[] = [];
    await expect(
      broadcastCommand({
        tabId: 1,
        frameIds: [0, 2],
        message: {
          schemaVersion: "1.0",
          type: "overlay-command",
          command: "hide",
        },
        transport: {
          inject: async () => [],
          send: async (_tabId, frameId) => {
            seen.push(frameId);
            return acknowledge;
          },
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(seen).toEqual([0, 2]);
  });

  it("reports a frame that lost its scan instead of claiming success", async () => {
    await expect(
      broadcastCommand({
        tabId: 1,
        frameIds: [0, 2],
        message: {
          schemaVersion: "1.0",
          type: "overlay-command",
          command: "show-all",
        },
        transport: {
          inject: async () => [],
          send: async (_tabId, frameId) =>
            frameId === 2
              ? {
                  schemaVersion: "1.0",
                  type: "command-result",
                  ok: false,
                  error: {
                    code: "stale-finding",
                    message: "This document has no current scan to display.",
                  },
                }
              : acknowledge,
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-finding" } });
  });

  it("reports an unreachable frame rather than silently dropping the command", async () => {
    await expect(
      broadcastCommand({
        tabId: 1,
        frameIds: [0],
        message: {},
        transport: {
          inject: async () => [],
          send: async () => {
            throw new Error("Receiving end does not exist.");
          },
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "frame-unreachable" },
    });
  });

  it("refuses a command when no frame was scanned", async () => {
    await expect(
      broadcastCommand({
        tabId: 1,
        frameIds: [],
        message: {},
        transport: {
          inject: async () => [],
          send: async () => acknowledge,
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "stale-finding" } });
  });
});

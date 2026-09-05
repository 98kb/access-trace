import { describe, expect, it } from "vitest";

import { aggregateFrameScans } from "../src/aggregate";
import type { ScanReportV1 } from "../src/contracts";
import { createTabStateStore, tabStateKey } from "../src/tab-state";

function fakeSession() {
  const data = new Map<string, unknown>();
  return {
    data,
    area: {
      get: async (key: string) =>
        data.has(key) ? { [key]: data.get(key) } : {},
      set: async (items: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(items)) data.set(key, value);
      },
      remove: async (key: string) => void data.delete(key),
    },
  };
}

const report: ScanReportV1 = aggregateFrameScans({
  scanId: "scan-1",
  page: { url: "https://example.test/", title: "Example" },
  startedAt: "2026-09-05T10:00:00.000Z",
  durationMs: 12,
  scannerVersion: "4.13.0",
  failures: [],
  frames: [
    {
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
    },
  ],
});

describe("tab session state", () => {
  it("survives a worker restart by rereading validated session storage", async () => {
    const session = fakeSession();
    const first = createTabStateStore(session.area, () => "t1");
    await first.replaceReport(4, report);

    const afterRestart = createTabStateStore(session.area, () => "t2");
    const restored = await afterRestart.read(4);

    expect(restored?.report?.scanId).toBe("scan-1");
    expect(restored?.stale).toBe(false);
  });

  it("marks state stale once and drops the evidence preview with it", async () => {
    const session = fakeSession();
    const store = createTabStateStore(session.area, () => "t1");
    await store.replaceReport(4, report);
    await store.write(4, {
      preview: {
        findingId: "f1",
        request: {
          schemaVersion: "1.0",
          operation: "explain-finding",
          finding: {
            ruleId: "image-alt",
            source: "axe-core",
            status: "violation",
            impact: "critical",
            tags: [],
            help: "help",
            failureSummary: "summary",
          },
          evidence: {
            tagName: "img",
            role: "img",
            accessibleName: "",
            attributes: {},
            visibleText: "",
            computedStyles: {},
          },
          disclosure: {
            execution: "local",
            screenshotIncluded: false,
            evidenceCategories: ["tag name"],
          },
        },
      },
    });

    expect(await store.markStale(4, "Navigation")).toBe(true);
    expect(await store.markStale(4, "Navigation again")).toBe(false);
    const state = await store.read(4);
    expect(state).toMatchObject({ stale: true, staleReason: "Navigation" });
    expect(state?.preview).toBeUndefined();
    expect(state?.report?.scanId).toBe("scan-1");
  });

  it("discards corrupt persisted state instead of surfacing it", async () => {
    const session = fakeSession();
    session.data.set(tabStateKey(9), { schemaVersion: "0.9" });
    const store = createTabStateStore(session.area, () => "t1");

    expect(await store.read(9)).toBeUndefined();
    expect(session.data.has(tabStateKey(9))).toBe(false);
  });

  it("clears everything for a closed tab", async () => {
    const session = fakeSession();
    const store = createTabStateStore(session.area, () => "t1");
    await store.replaceReport(4, report);
    await store.clear(4);

    expect(await store.read(4)).toBeUndefined();
    expect([...session.data.keys()]).toEqual([]);
  });

  it("never writes anything outside the tab-state session namespace", async () => {
    const session = fakeSession();
    const store = createTabStateStore(session.area, () => "t1");
    await store.replaceReport(4, report);
    await store.markStale(4, "reason");

    expect([...session.data.keys()]).toEqual([tabStateKey(4)]);
  });
});

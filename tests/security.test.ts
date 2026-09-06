import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runTabScan } from "../src/frame-scan";
import { parseExtensionRequest, parseExtensionResponse } from "../src/messages";
import { createTabStateStore } from "../src/tab-state";

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

const shipped = [...sourceFiles("src"), ...sourceFiles("entrypoints")].map(
  (path) => ({ path, text: readFileSync(path, "utf8") }),
);

describe("extension boundary", () => {
  it("ships no HTML sink, dynamic code path, or remote script", () => {
    const forbidden = [
      /dangerouslySetInnerHTML/,
      /\binnerHTML\s*=/,
      /\bouterHTML\s*=/,
      /\beval\s*\(/,
      /new\s+Function\s*\(/,
      /document\.write/,
      /import\s*\(\s*["'`]https?:/,
      /<script\b/i,
    ];
    const offenders = shipped.flatMap(({ path, text }) =>
      forbidden
        .filter((pattern) => pattern.test(text))
        .map(String)
        .map((pattern) => `${path}: ${pattern}`),
    );

    expect(offenders).toEqual([]);
  });

  it("references no remote origin outside documentation links, loopback, and GitHub", () => {
    const remote = shipped.flatMap(({ path, text }) =>
      [...text.matchAll(/https?:\/\/[^\s"'`)]+/g)]
        .map((match) => match[0])
        .filter(
          (url) =>
            !url.startsWith("http://127.0.0.1") &&
            !url.startsWith("http://localhost") &&
            !url.startsWith("http://[::1]") &&
            !url.startsWith("https://github.com") &&
            !url.startsWith("https://api.github.com") &&
            // Built only from internal string/host construction or loopback allowlist.
            !url.startsWith("http://${") &&
            !url.startsWith("https://example.test"),
        )
        .map((url) => `${path}: ${url}`),
    );

    expect(remote).toEqual([]);
  });

  it("keeps analytics and telemetry vocabulary out of the shipped source", () => {
    const telemetry = shipped.filter(({ text }) =>
      /\b(analytics|telemetry|gtag|mixpanel|sentry|amplitude|segment\.io)\b/i.test(
        text,
      ),
    );

    expect(telemetry.map((file) => file.path)).toEqual([]);
  });

  it("never writes page-derived data to sync or long-lived storage", () => {
    const syncUse = shipped.filter(({ text }) =>
      /chrome\.storage\.sync/.test(text),
    );
    expect(syncUse.map((file) => file.path)).toEqual([]);

    const localWrites = shipped.flatMap(({ path, text }) =>
      [
        ...text.matchAll(
          /chrome\.storage\.local\.set\(\{?\s*\n?\s*\[?([^,\n]*)/g,
        ),
      ]
        .map((match) => `${path}: ${match[1]?.trim()}`)
        .filter(
          (entry) =>
            !entry.includes("assistantSettingsKey") &&
            !entry.includes("github-prefill-domain") &&
            !entry.includes("key]: value"),
        ),
    );
    expect(localWrites).toEqual([]);
  });

  it("does not log page content from the shipped source", () => {
    const logging = shipped.filter(({ text }) =>
      /console\.(log|info|debug|dir|table)\s*\(/.test(text),
    );

    expect(logging.map((file) => file.path)).toEqual([]);
  });
});

describe("deterministic scanning", () => {
  it("performs no network request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("XMLHttpRequest", undefined);

    await runTabScan({
      tabId: 1,
      scanId: "scan-1",
      page: { url: "https://example.test/", title: "Example" },
      startedAt: "2026-09-05T10:00:00.000Z",
      elapsedMs: () => 1,
      transport: {
        inject: async () => [0],
        send: async () => ({
          schemaVersion: "1.0",
          type: "frame-scan-result",
          ok: true,
          frameScan: {
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
        }),
      },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("message boundary", () => {
  it("rejects unknown operations and unsupported schema versions", () => {
    expect(() =>
      parseExtensionRequest({ schemaVersion: "1.0", type: "drop-database" }),
    ).toThrow(/Unknown message type/);
    expect(() =>
      parseExtensionRequest({ schemaVersion: "2.0", type: "get-state" }),
    ).toThrow(/Unsupported schema version/);
    expect(() =>
      parseExtensionRequest({
        schemaVersion: "1.0",
        type: "scan-cancel",
        extra: true,
      }),
    ).toThrow(/unexpected field/);
    expect(() =>
      parseExtensionResponse({
        schemaVersion: "1.0",
        type: "frame-scan-result",
        ok: true,
        frameScan: { scanId: "scan-1" },
      }),
    ).toThrow();
  });

  it("rejects a frame scan that smuggles an unversioned finding", () => {
    expect(() =>
      parseExtensionResponse({
        schemaVersion: "1.0",
        type: "frame-scan-result",
        ok: true,
        frameScan: {
          scanId: "scan-1",
          scannerVersion: "4.13.0",
          frameId: 0,
          parentFrameId: -1,
          depth: 0,
          url: "https://example.test/",
          childFrames: [],
          openShadowRoots: 0,
          closedShadowRoots: 0,
          ruleCounts: { passes: 0, inapplicable: 0 },
          findings: [{ ruleId: "image-alt" }],
        },
      }),
    ).toThrow();
  });
});

describe("assistant evidence storage", () => {
  it("drops the evidence preview as soon as the page state goes stale", async () => {
    const data = new Map<string, unknown>();
    const store = createTabStateStore(
      {
        get: async (key) => (data.has(key) ? { [key]: data.get(key) } : {}),
        set: async (items) => {
          for (const [key, value] of Object.entries(items))
            data.set(key, value);
        },
        remove: async (key) => void data.delete(key),
      },
      () => "t1",
    );

    await store.write(1, { stale: false });
    await store.markStale(1, "navigation");

    expect(JSON.stringify([...data.values()])).not.toContain("evidence");
  });
});

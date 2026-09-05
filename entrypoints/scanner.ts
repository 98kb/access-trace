import axe from "axe-core";

import type { ScanReportV1 } from "../src/contracts";
import { SCHEMA_VERSION } from "../src/contracts";
import { parseExtensionRequest, type ExtensionResponse } from "../src/messages";
import { normalizeAxeResults } from "../src/normalize";
import { OverlayController } from "../src/overlay";

type ScannerState = {
  report?: ScanReportV1;
  elements: Map<string, Element>;
  overlay?: OverlayController;
};

type ScannerGlobal = typeof globalThis & {
  __accessibilityInspectorScanner?: ScannerState;
};

function resolveTarget(target: Array<string | string[]>): Element | undefined {
  let root: Document | ShadowRoot = document;
  let found: Element | null = null;
  for (let partIndex = 0; partIndex < target.length; partIndex += 1) {
    const part = target[partIndex]!;
    const selectors = typeof part === "string" ? [part] : part;
    for (let index = 0; index < selectors.length; index += 1) {
      found = root.querySelector(selectors[index]!);
      if (!found) return undefined;
      if (index < selectors.length - 1) {
        if (!found.shadowRoot) return undefined;
        root = found.shadowRoot;
      }
    }
    if (partIndex < target.length - 1) {
      const frameDocument: Document | null =
        (found as HTMLIFrameElement | null)?.contentDocument ?? null;
      if (!frameDocument) return undefined;
      root = frameDocument;
    }
  }
  return found ?? undefined;
}

function bindElements(
  report: ScanReportV1,
  results: axe.AxeResults,
): Map<string, Element> {
  const targets = [...results.violations, ...results.incomplete].flatMap(
    (result) => result.nodes.map((node) => node.target),
  );
  return new Map(
    report.findings.flatMap((finding, index) => {
      const element = resolveTarget(targets[index] as Array<string | string[]>);
      return element ? [[finding.nodeRef, element] as const] : [];
    }),
  );
}

export default defineUnlistedScript(() => {
  const scope = globalThis as ScannerGlobal;
  if (scope.__accessibilityInspectorScanner) return;
  const state: ScannerState = { elements: new Map() };
  scope.__accessibilityInspectorScanner = state;

  const failure = (
    type: "scan-result" | "command-result",
    code: "invalid-message" | "scan-failed" | "stale-finding",
    message: string,
  ): ExtensionResponse => ({
    schemaVersion: SCHEMA_VERSION,
    type,
    ok: false,
    error: { code, message },
  });

  const handle = async (raw: unknown): Promise<ExtensionResponse> => {
    let request;
    try {
      request = parseExtensionRequest(raw);
    } catch (error) {
      return failure(
        "command-result",
        "invalid-message",
        error instanceof Error ? error.message : "Invalid scanner message.",
      );
    }

    if (request.type === "scan-request") {
      state.overlay?.destroy();
      state.overlay = undefined;
      state.report = undefined;
      state.elements.clear();
      const started = performance.now();
      try {
        const results = await axe.run(document, {
          runOnly: {
            type: "tag",
            values: [
              "wcag2a",
              "wcag2aa",
              "wcag21a",
              "wcag21aa",
              "wcag22a",
              "wcag22aa",
              "best-practice",
            ],
          },
          resultTypes: ["violations", "incomplete", "passes", "inapplicable"],
        });
        const frames = document.querySelectorAll("iframe").length;
        const warnings = [
          "Closed shadow roots cannot be detected or inspected.",
        ];
        const skippedRegions: ScanReportV1["skippedRegions"] = [
          {
            kind: "shadow-root",
            reason: "Closed shadow roots are not exposed to page scripts.",
          },
        ];
        if (frames > 0) {
          warnings.push(
            `${frames} frame${frames === 1 ? "" : "s"} may have incomplete coverage.`,
          );
          skippedRegions.push({
            kind: "frame",
            reason: "Cross-origin frame geometry is outside this scan.",
          });
        }
        const report = normalizeAxeResults(results, {
          scanId: crypto.randomUUID(),
          title: document.title,
          durationMs: Math.round(performance.now() - started),
          warnings,
          skippedRegions,
        });
        state.report = report;
        state.elements = bindElements(report, results);
        return {
          schemaVersion: SCHEMA_VERSION,
          type: "scan-result",
          ok: true,
          report,
        };
      } catch (error) {
        return failure(
          "scan-result",
          "scan-failed",
          error instanceof Error
            ? error.message
            : "axe-core could not scan this page.",
        );
      }
    }

    if (request.type !== "overlay-command")
      return failure(
        "command-result",
        "invalid-message",
        "Unsupported scanner command.",
      );
    if (request.command === "clear") {
      state.overlay?.destroy();
      state.overlay = undefined;
      state.report = undefined;
      state.elements.clear();
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "command-result",
        ok: true,
      };
    }
    if (!state.report)
      return failure(
        "command-result",
        "stale-finding",
        "No current scan exists for this page.",
      );
    state.overlay ??= new OverlayController(document, (nodeRef) =>
      state.elements.get(nodeRef),
    );
    if (request.command === "hide") state.overlay.hide();
    if (request.command === "show-all") {
      if (!state.overlay.show(state.report.findings))
        return failure(
          "command-result",
          "stale-finding",
          "The page changed. Rescan before showing all findings.",
        );
    }
    if (request.command === "select") {
      const finding = state.report.findings.find(
        (item) => item.findingId === request.findingId,
      );
      if (!finding)
        return failure(
          "command-result",
          "stale-finding",
          "The finding is not part of the current scan.",
        );
      state.overlay.show(state.report.findings);
      if (!state.overlay.select(finding.nodeRef))
        return failure(
          "command-result",
          "stale-finding",
          "The page changed. Rescan to locate this finding.",
        );
    }
    return { schemaVersion: SCHEMA_VERSION, type: "command-result", ok: true };
  };

  const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
    _sender,
    sendResponse,
  ) => {
    void handle(message).then(sendResponse);
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener(
    "pagehide",
    () => {
      state.overlay?.destroy();
      chrome.runtime.onMessage.removeListener(listener);
      delete scope.__accessibilityInspectorScanner;
    },
    { once: true },
  );
});

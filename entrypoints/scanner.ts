import axe from "axe-core";

import type { ChildFrameDescriptorV1, FrameScanV1 } from "../src/aggregate";
import type { FindingV1, FrameRefV1 } from "../src/contracts";
import { SCHEMA_VERSION } from "../src/contracts";
import { buildCoverage } from "../src/coverage";
import { buildAssistantRequest } from "../src/evidence";
import {
  elementSnippet,
  resolveLocator,
  type LocatorResolution,
} from "../src/locator";
import { parseExtensionRequest, type ExtensionResponse } from "../src/messages";
import { normalizeAxeResults } from "../src/normalize";
import { OverlayController } from "../src/overlay";

type ScannerState = {
  findings: FindingV1[];
  elements: Map<string, Element>;
  overlay?: OverlayController;
  stale: boolean;
  scannedUrl?: string;
  stopWatching?: () => void;
};

type ScannerGlobal = typeof globalThis & {
  __accessibilityInspectorScanner?: ScannerState;
};

const MUTATION_DEBOUNCE_MS = 400;
const SHADOW_SCAN_NODE_BUDGET = 20_000;

function absoluteFrameUrl(frame: HTMLIFrameElement | HTMLFrameElement): string {
  try {
    const inner = frame.contentWindow?.location.href;
    if (inner) return inner;
  } catch {
    // Cross-origin frames deny location access; fall back to the declared src.
  }
  if (!frame.getAttribute("src")) return "about:blank";
  try {
    return new URL(frame.getAttribute("src")!, document.baseURI).href;
  } catch {
    return "about:blank";
  }
}

function childFrameDescriptors(): ChildFrameDescriptorV1[] {
  return [...document.querySelectorAll("iframe, frame")].map(
    (element, index) => {
      const frame = element as HTMLIFrameElement | HTMLFrameElement;
      let sameOrigin = false;
      try {
        sameOrigin = frame.contentDocument !== null;
      } catch {
        sameOrigin = false;
      }
      return {
        selector: frame.id
          ? `#${frame.id}`
          : `${frame.tagName.toLowerCase()}:nth-of-type(${index + 1})`,
        url: absoluteFrameUrl(frame),
        sameOrigin,
      };
    },
  );
}

/**
 * Counts open shadow roots within a node budget. `truncated` says whether the
 * walk stopped early, so the count is never presented as exhaustive when it
 * is not.
 */
function countOpenShadowRoots(): { count: number; truncated: boolean } {
  let count = 0;
  let visited = 0;
  const roots: Array<Document | ShadowRoot> = [document];
  while (roots.length > 0) {
    const root = roots.pop()!;
    for (const element of root.querySelectorAll("*")) {
      visited += 1;
      if (visited >= SHADOW_SCAN_NODE_BUDGET) return { count, truncated: true };
      if (element.shadowRoot) {
        count += 1;
        roots.push(element.shadowRoot);
      }
    }
  }
  return { count, truncated: false };
}

/** Depth is observable from the window chain even across origins. */
function frameDepth(): number {
  let depth = 0;
  let view: Window = window;
  while (view !== view.parent && depth < 32) {
    view = view.parent;
    depth += 1;
  }
  return depth;
}

function bindElements(findings: FindingV1[]): Map<string, Element> {
  const bound = new Map<string, Element>();
  for (const finding of findings) {
    const resolution: LocatorResolution = resolveLocator(
      document,
      finding.locator.segments,
      finding.evidence,
    );
    if (resolution.ok) bound.set(finding.nodeRef, resolution.element);
  }
  return bound;
}

export default defineUnlistedScript(() => {
  const scope = globalThis as ScannerGlobal;
  if (scope.__accessibilityInspectorScanner) return;
  const state: ScannerState = {
    findings: [],
    elements: new Map(),
    stale: false,
  };
  scope.__accessibilityInspectorScanner = state;

  const failure = (
    type: "scan-result" | "command-result" | "frame-scan-result",
    code:
      | "invalid-message"
      | "scan-failed"
      | "stale-finding"
      | "frame-unreachable",
    message: string,
  ): ExtensionResponse => ({
    schemaVersion: SCHEMA_VERSION,
    type,
    ok: false,
    error: { code, message },
  });

  const reset = (): void => {
    state.overlay?.destroy();
    state.overlay = undefined;
    state.findings = [];
    state.elements.clear();
    state.stale = false;
    state.scannedUrl = undefined;
    state.stopWatching?.();
    state.stopWatching = undefined;
  };

  const reportStale = (reason: string): void => {
    if (state.stale) return;
    state.stale = true;
    state.stopWatching?.();
    state.stopWatching = undefined;
    state.overlay?.deselect();
    void chrome.runtime
      .sendMessage({
        schemaVersion: SCHEMA_VERSION,
        type: "scan-stale",
        reason,
      })
      .catch(() => undefined);
  };

  /**
   * Watches only for structural changes and only long enough to notice that a
   * bound element left the document or that the document routed elsewhere. It
   * never triggers a rescan by itself.
   *
   * Same-document routing is detected here rather than from `tabs.onUpdated`,
   * because that signal only carries the new URL when the extension holds a
   * host permission for the tab. The history API is observed through the
   * standard events and a URL comparison, never by patching page APIs.
   */
  const watchForStaleness = (): void => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      timer = undefined;
      if (
        state.scannedUrl !== undefined &&
        location.href !== state.scannedUrl
      ) {
        reportStale(
          "The page navigated within the document, so the previous scan no longer applies.",
        );
        return;
      }
      const detached = [...state.elements.values()].some(
        (element) => !element.isConnected,
      );
      if (detached)
        reportStale(
          "The page changed after the scan, so some findings no longer point at live elements.",
        );
    };
    const schedule = () => {
      if (timer !== undefined) return;
      timer = setTimeout(check, MUTATION_DEBOUNCE_MS);
    };

    const observer =
      typeof MutationObserver === "undefined"
        ? undefined
        : new MutationObserver(schedule);
    observer?.observe(document, { childList: true, subtree: true });
    window.addEventListener("popstate", schedule);
    window.addEventListener("hashchange", schedule);
    state.stopWatching = () => {
      observer?.disconnect();
      window.removeEventListener("popstate", schedule);
      window.removeEventListener("hashchange", schedule);
      if (timer !== undefined) clearTimeout(timer);
    };
  };

  const runFrameScan = async (
    scanId: string,
    frameId: number,
  ): Promise<ExtensionResponse> => {
    const frame: FrameRefV1 = {
      frameId,
      parentFrameId: -1,
      url: location.href,
      depth: frameDepth(),
    };
    reset();
    const started = performance.now();
    const results = await axe.run(document, {
      iframes: false,
      // Each frame reports only its own document; frame coverage is reported by
      // the coverage model, which knows which frames were actually reached.
      // axe's own `frame-tested` warning would contradict it.
      rules: { "frame-tested": { enabled: false } },
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
    const ruleCounts = {
      passes: results.passes.length,
      inapplicable: results.inapplicable.length,
    };
    const report = normalizeAxeResults(results, {
      scanId,
      title: document.title,
      durationMs: Math.round(performance.now() - started),
      frame,
      coverage: buildCoverage({
        ruleCounts,
        openShadowRoots: 0,
        closedShadowRoots: 0,
        regions: [
          {
            kind: "document",
            state: "scanned",
            detail: frame.url,
            frameId: frame.frameId,
            url: frame.url,
          },
        ],
      }),
    });
    state.findings = report.findings;
    state.elements = bindElements(report.findings);
    state.scannedUrl = location.href;
    watchForStaleness();
    const shadowRoots = countOpenShadowRoots();
    const frameScan: FrameScanV1 = {
      scanId,
      scannerVersion: results.testEngine.version,
      frameId: frame.frameId,
      parentFrameId: frame.parentFrameId,
      depth: frame.depth,
      url: frame.url,
      childFrames: childFrameDescriptors(),
      openShadowRoots: shadowRoots.count,
      shadowWalkTruncated: shadowRoots.truncated,
      closedShadowRoots: 0,
      ruleCounts,
      findings: report.findings,
    };
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "frame-scan-result",
      ok: true,
      frameScan,
    };
  };

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
      if (!request.scan)
        return failure(
          "frame-scan-result",
          "invalid-message",
          "A frame scan requires a scan identity.",
        );
      try {
        return await runFrameScan(request.scan.scanId, request.scan.frameId);
      } catch (error) {
        return failure(
          "frame-scan-result",
          "scan-failed",
          error instanceof Error
            ? error.message
            : "axe-core could not scan this document.",
        );
      }
    }

    if (request.type === "assistant-evidence") {
      const finding = state.findings.find(
        (item) =>
          item.findingId === request.findingId && item.status === "violation",
      );
      const element = finding ? state.elements.get(finding.nodeRef) : undefined;
      if (
        !finding ||
        !element?.isConnected ||
        elementSnippet(element) !== finding.evidence
      )
        return {
          schemaVersion: SCHEMA_VERSION,
          type: "assistant-preview-result",
          ok: false,
          error: {
            code: "stale-finding",
            message: "The page changed. Rescan before explaining this finding.",
          },
        };
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-preview-result",
        ok: true,
        request: buildAssistantRequest(element, finding),
      };
    }

    if (request.type !== "overlay-command")
      return failure(
        "command-result",
        "invalid-message",
        "Unsupported scanner command.",
      );
    if (request.command === "clear") {
      reset();
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "command-result",
        ok: true,
      };
    }
    if (state.findings.length === 0)
      return failure(
        "command-result",
        "stale-finding",
        "This document has no current scan to display.",
      );
    state.overlay ??= new OverlayController(document, (nodeRef) =>
      state.elements.get(nodeRef),
    );
    if (request.command === "hide") state.overlay.hide();
    if (request.command === "deselect") state.overlay.deselect();
    if (request.command === "show-all") state.overlay.show(state.findings);
    if (request.command === "select") {
      const finding = state.findings.find(
        (item) => item.findingId === request.findingId,
      );
      if (!finding)
        return failure(
          "command-result",
          "stale-finding",
          "The finding is not part of this document's current scan.",
        );
      state.overlay.show(state.findings);
      const element = state.elements.get(finding.nodeRef);
      if (
        !element?.isConnected ||
        elementSnippet(element) !== finding.evidence ||
        !state.overlay.select(finding.nodeRef)
      ) {
        reportStale("The selected element changed after the scan.");
        return failure(
          "command-result",
          "stale-finding",
          "The page changed. Rescan to locate this finding.",
        );
      }
    }
    return { schemaVersion: SCHEMA_VERSION, type: "command-result", ok: true };
  };

  const listener: Parameters<typeof chrome.runtime.onMessage.addListener>[0] = (
    message,
    sender,
    sendResponse,
  ) => {
    if (sender.id !== chrome.runtime.id) return false;
    void handle(message).then(sendResponse);
    return true;
  };
  chrome.runtime.onMessage.addListener(listener);
  window.addEventListener(
    "pagehide",
    () => {
      reset();
      chrome.runtime.onMessage.removeListener(listener);
      delete scope.__accessibilityInspectorScanner;
    },
    { once: true },
  );
});

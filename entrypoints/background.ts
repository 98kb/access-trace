import type { ScanReportV1 } from "../src/contracts";
import { SCHEMA_VERSION } from "../src/contracts";
import {
  parseExtensionRequest,
  parseExtensionResponse,
  parseScanReport,
  type ExtensionResponse,
} from "../src/messages";
import { createScanCoordinator, ExpectedScanError } from "../src/orchestrator";

const storageKey = (tabId: number) => `scan-report:${tabId}`;

async function activeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab?.id)
    throw new ExpectedScanError(
      "scan-failed",
      "No active browser tab was found.",
    );
  return tab;
}

function assertSupported(url?: string): void {
  if (!url)
    throw new ExpectedScanError(
      "unsupported-page",
      "This page does not expose a scannable URL.",
    );
  const protocol = new URL(url).protocol;
  if (!["http:", "https:", "file:"].includes(protocol)) {
    throw new ExpectedScanError(
      "unsupported-page",
      `${protocol} pages cannot be scanned by Chrome extensions.`,
    );
  }
}

async function clearOverlay(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      schemaVersion: SCHEMA_VERSION,
      type: "overlay-command",
      command: "clear",
    });
  } catch {
    // No scanner context exists yet, which is the expected first-scan state.
  }
}

async function performScan(tabId: number): Promise<ScanReportV1> {
  const tab = await chrome.tabs.get(tabId);
  assertSupported(tab.url);
  await clearOverlay(tabId);
  await chrome.storage.session.remove(storageKey(tabId));
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["scanner.js"],
    });
  } catch (error) {
    throw new ExpectedScanError(
      "permission-denied",
      error instanceof Error
        ? error.message
        : "Chrome denied access to this page.",
    );
  }
  const response = parseExtensionResponse(
    await chrome.tabs.sendMessage(tabId, {
      schemaVersion: SCHEMA_VERSION,
      type: "scan-request",
    }),
  );
  if (!response.ok)
    throw new ExpectedScanError(response.error.code, response.error.message);
  if (response.type !== "scan-result")
    throw new ExpectedScanError(
      "invalid-message",
      "The scanner returned an unexpected response.",
    );
  await chrome.storage.session.set({ [storageKey(tabId)]: response.report });
  return response.report;
}

export default defineBackground(() => {
  const coordinator = createScanCoordinator(performScan);

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id) void chrome.sidePanel.open({ tabId: tab.id });
  });

  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    void (async (): Promise<ExtensionResponse> => {
      try {
        const request = parseExtensionRequest(raw);
        const tab = await activeTab();
        if (request.type === "get-state") {
          const key = storageKey(tab.id!);
          const stored = (await chrome.storage.session.get(key))[key];
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "state-result",
            ok: true,
            report: stored === undefined ? null : parseScanReport(stored),
          };
        }
        if (request.type === "scan-request") {
          const outcome = await coordinator.scan(tab.id!);
          return outcome.ok
            ? {
                schemaVersion: SCHEMA_VERSION,
                type: "scan-result",
                ok: true,
                report: outcome.report,
              }
            : {
                schemaVersion: SCHEMA_VERSION,
                type: "scan-result",
                ok: false,
                error: outcome.error,
              };
        }
        assertSupported(tab.url);
        try {
          return parseExtensionResponse(
            await chrome.tabs.sendMessage(tab.id!, request),
          );
        } catch {
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "command-result",
            ok: false,
            error: {
              code: "stale-finding",
              message: "The page changed. Rescan before locating this finding.",
            },
          };
        }
      } catch (error) {
        return {
          schemaVersion: SCHEMA_VERSION,
          type: "command-result",
          ok: false,
          error: {
            code:
              error instanceof ExpectedScanError
                ? error.code
                : "invalid-message",
            message:
              error instanceof Error
                ? error.message
                : "The extension message was invalid.",
          },
        };
      }
    })().then(sendResponse);
    return true;
  });

  chrome.tabs.onRemoved.addListener(
    (tabId) => void chrome.storage.session.remove(storageKey(tabId)),
  );
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "loading")
      void chrome.storage.session.remove(storageKey(tabId));
  });
});

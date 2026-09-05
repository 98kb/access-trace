import type { ScanReportV1 } from "../src/contracts";
import { SCHEMA_VERSION } from "../src/contracts";
import {
  parseExtensionRequest,
  parseExtensionResponse,
  parseScanReport,
  type AssistantFailure,
  type ExtensionResponse,
} from "../src/messages";
import {
  AssistantProviderError,
  DEFAULT_ASSISTANT_SETTINGS,
  OllamaAssistantProvider,
  parseAssistantSettings,
  type AssistantSettingsV1,
} from "../src/ollama";
import { createScanCoordinator, ExpectedScanError } from "../src/orchestrator";

const storageKey = (tabId: number) => `scan-report:${tabId}`;
const assistantSettingsKey = "assistant-settings:v1";
const provider = new OllamaAssistantProvider();
const generations = new Map<number, AbortController>();
const previews = new Map<
  number,
  {
    findingId: string;
    request: import("../src/assistant-contracts").AssistantRequestV1;
  }
>();

async function assistantSettings(): Promise<AssistantSettingsV1> {
  const stored = (await chrome.storage.local.get(assistantSettingsKey))[
    assistantSettingsKey
  ];
  return stored === undefined
    ? DEFAULT_ASSISTANT_SETTINGS
    : parseAssistantSettings(stored);
}

function permissionOrigin(settings: AssistantSettingsV1): string {
  return `http://${settings.host}/*`;
}

async function hasAssistantPermission(
  settings: AssistantSettingsV1,
): Promise<boolean> {
  return chrome.permissions.contains({ origins: [permissionOrigin(settings)] });
}

async function assistantEvidence(
  tabId: number,
  findingId: string,
): Promise<
  | Extract<ExtensionResponse, { type: "assistant-preview-result"; ok: true }>
  | {
      schemaVersion: typeof SCHEMA_VERSION;
      type: "assistant-preview-result";
      ok: false;
      error: AssistantFailure;
    }
> {
  try {
    const response = parseExtensionResponse(
      await chrome.tabs.sendMessage(tabId, {
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-evidence",
        findingId,
      }),
    );
    if (response.type !== "assistant-preview-result")
      return {
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-preview-result",
        ok: false,
        error: {
          code: "stale-finding",
          message: "The scanner returned unexpected evidence data.",
        },
      };
    return response.ok
      ? response
      : {
          schemaVersion: SCHEMA_VERSION,
          type: "assistant-preview-result",
          ok: false,
          error: response.error,
        };
  } catch {
    return {
      schemaVersion: SCHEMA_VERSION,
      type: "assistant-preview-result",
      ok: false,
      error: {
        code: "stale-finding",
        message: "The page changed. Rescan before explaining this finding.",
      },
    };
  }
}

function assistantResponseType(raw: unknown) {
  const type =
    raw && typeof raw === "object"
      ? String((raw as { type?: unknown }).type)
      : "";
  if (type === "assistant-settings-get" || type === "assistant-settings-set")
    return "assistant-settings-result" as const;
  if (type === "assistant-test") return "assistant-test-result" as const;
  if (type === "assistant-preview" || type === "assistant-evidence")
    return "assistant-preview-result" as const;
  if (type === "assistant-generate") return "assistant-result" as const;
  if (type === "assistant-cancel") return "assistant-command-result" as const;
  return undefined;
}

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
  if (response.type !== "scan-result")
    throw new ExpectedScanError(
      "invalid-message",
      "The scanner returned an unexpected response.",
    );
  if (!response.ok)
    throw new ExpectedScanError(response.error.code, response.error.message);
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
        if (request.type === "assistant-settings-get") {
          const settings = await assistantSettings();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "assistant-settings-result",
            ok: true,
            settings,
            permissionGranted: await hasAssistantPermission(settings),
          };
        }
        if (request.type === "assistant-settings-set") {
          await chrome.storage.local.set({
            [assistantSettingsKey]: request.settings,
          });
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "assistant-settings-result",
            ok: true,
            settings: request.settings,
            permissionGranted: await hasAssistantPermission(request.settings),
          };
        }
        if (request.type === "assistant-test") {
          const settings = await assistantSettings();
          if (!settings.enabled)
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-test-result",
              ok: false,
              error: {
                code: "disabled",
                message: "Enable local AI before testing the connection.",
              },
            };
          if (!(await hasAssistantPermission(settings)))
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-test-result",
              ok: false,
              error: {
                code: "permission-denied",
                message:
                  "Chrome permission for the configured loopback provider is missing.",
              },
            };
          const result = await provider.checkAvailability(settings);
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "assistant-test-result",
            ok: true,
            ...result,
          };
        }
        if (request.type === "assistant-preview") {
          const settings = await assistantSettings();
          if (!settings.enabled)
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-preview-result",
              ok: false,
              error: {
                code: "disabled",
                message: "Enable local AI before previewing evidence.",
              },
            };
          const evidence = await assistantEvidence(tab.id!, request.findingId);
          if (evidence.ok)
            previews.set(tab.id!, {
              findingId: request.findingId,
              request: evidence.request,
            });
          return evidence;
        }
        if (request.type === "assistant-generate") {
          const settings = await assistantSettings();
          if (!settings.enabled)
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-result",
              ok: false,
              error: {
                code: "disabled",
                message: "Enable local AI before requesting an advisory.",
              },
            };
          if (!(await hasAssistantPermission(settings)))
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-result",
              ok: false,
              error: {
                code: "permission-denied",
                message:
                  "Loopback permission is missing. Enable or test the provider again.",
              },
            };
          const evidence = await assistantEvidence(tab.id!, request.findingId);
          if (!evidence.ok)
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-result",
              ok: false,
              error: evidence.error,
            };
          const preview = previews.get(tab.id!);
          if (
            preview?.findingId !== request.findingId ||
            JSON.stringify(preview.request) !== JSON.stringify(evidence.request)
          )
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-result",
              ok: false,
              error: {
                code: "stale-finding",
                message:
                  "The evidence changed. Preview it again before sending.",
              },
            };
          const controller = new AbortController();
          generations.set(tab.id!, controller);
          try {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-result",
              ok: true,
              response: await provider.execute(
                evidence.request,
                settings,
                controller.signal,
              ),
            };
          } finally {
            generations.delete(tab.id!);
          }
        }
        if (request.type === "assistant-cancel") {
          generations.get(tab.id!)?.abort();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "assistant-command-result",
            ok: true,
          };
        }
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
          previews.delete(tab.id!);
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
        const assistantType = assistantResponseType(raw);
        if (assistantType)
          return {
            schemaVersion: SCHEMA_VERSION,
            type: assistantType,
            ok: false,
            error: {
              code:
                error instanceof AssistantProviderError
                  ? error.code
                  : "invalid-configuration",
              message:
                error instanceof Error
                  ? error.message
                  : "The local AI request failed.",
            },
          } as ExtensionResponse;
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

  chrome.tabs.onRemoved.addListener((tabId) => {
    generations.get(tabId)?.abort();
    generations.delete(tabId);
    previews.delete(tabId);
    void chrome.storage.session.remove(storageKey(tabId));
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "loading") {
      generations.get(tabId)?.abort();
      generations.delete(tabId);
      previews.delete(tabId);
      void chrome.storage.session.remove(storageKey(tabId));
    }
  });
});

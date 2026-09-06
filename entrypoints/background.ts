import {
  canonicalJson,
  type AssistantRequestV1,
} from "../src/assistant-contracts";
import type { ScanReportV1 } from "../src/contracts";
import { SCHEMA_VERSION } from "../src/contracts";
import {
  broadcastCommand,
  routeSelection,
  runTabScan,
  type FrameTransport,
} from "../src/frame-scan";
import {
  parseExtensionRequest,
  parseExtensionResponse,
  type AssistantFailure,
  type ExtensionRequest,
  type ExtensionResponse,
} from "../src/messages";
import { frameIdFromNodeRef } from "../src/normalize";
import {
  AssistantProviderError,
  DEFAULT_ASSISTANT_SETTINGS,
  OllamaAssistantProvider,
  parseAssistantSettings,
  type AssistantSettingsV1,
} from "../src/ollama";
import { createScanCoordinator, ExpectedScanError } from "../src/orchestrator";
import { createTabStateStore } from "../src/tab-state";
import { GitHubAuthManager } from "../src/github/auth";
import { getGitHubAppConfig } from "../src/github/config";
import { GitHubDiscoveryClient } from "../src/github/discovery";
import { getDomainKeyFromUrl } from "../src/github/domain";
import { GitHubIssueManager } from "../src/github/issue";
import { DomainMappingStore } from "../src/github/mappings";
import { chromeLocalStorage } from "../src/github/storage";

const assistantSettingsKey = "assistant-settings:v1";
const provider = new OllamaAssistantProvider();
const generations = new Map<number, AbortController>();
const state = createTabStateStore(chrome.storage.session, () =>
  new Date().toISOString(),
);

const githubConfig = getGitHubAppConfig();
const githubAuth = new GitHubAuthManager({
  config: githubConfig,
  storage: chromeLocalStorage,
});
const domainMappings = new DomainMappingStore(chromeLocalStorage);
const githubDiscovery = new GitHubDiscoveryClient();
const githubIssueManager = new GitHubIssueManager({
  storage: chromeLocalStorage,
});

async function hasGitHubPermission(): Promise<boolean> {
  return chrome.permissions.contains({
    origins: ["https://github.com/*", "https://api.github.com/*"],
  });
}

const transport: FrameTransport = {
  async inject(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["scanner.js"],
    });
    return results
      .map((result) => result.frameId)
      .filter((frameId): frameId is number => typeof frameId === "number");
  },
  send(tabId, frameId, message) {
    return chrome.tabs.sendMessage(tabId, message, { frameId });
  },
};

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
  if (!["http:", "https:", "file:"].includes(protocol))
    throw new ExpectedScanError(
      "unsupported-page",
      `${protocol} pages cannot be scanned by Chrome extensions.`,
    );
}

/**
 * Talks to scanner contexts that already exist. Injection happens only inside
 * `performScan`, so nothing is ever put into a page the user did not scan.
 */
async function notifyFrames(
  tabId: number,
  message: Extract<ExtensionRequest, { type: "overlay-command" }>,
): Promise<void> {
  // Omitting `frameId` delivers to every frame that has a listener; a tab with
  // no scanner context simply rejects, which is the expected pre-scan state.
  await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
}

/** Frames the current report says it scanned, without touching the page. */
function scannedFrameIds(report: ScanReportV1): number[] {
  const fromCoverage = (report.coverage.regions ?? [])
    .filter(
      (region) => region.state === "scanned" && region.frameId !== undefined,
    )
    .map((region) => region.frameId!);
  const fromFindings = report.findings.flatMap((finding) => {
    const frameId =
      finding.frame?.frameId ?? frameIdFromNodeRef(finding.nodeRef);
    return frameId === undefined ? [] : [frameId];
  });
  return [...new Set([...fromCoverage, ...fromFindings])];
}

async function invalidate(tabId: number, reason: string): Promise<void> {
  coordinator.cancel(tabId);
  generations.get(tabId)?.abort();
  generations.delete(tabId);
  await state.markStale(tabId, reason);
  await notifyFrames(tabId, {
    schemaVersion: SCHEMA_VERSION,
    type: "overlay-command",
    command: "clear",
  });
}

async function performScan(
  tabId: number,
  signal: AbortSignal,
): Promise<ScanReportV1> {
  const tab = await chrome.tabs.get(tabId);
  assertSupported(tab.url);
  await notifyFrames(tabId, {
    schemaVersion: SCHEMA_VERSION,
    type: "overlay-command",
    command: "clear",
  });
  await state.clear(tabId);
  const started = performance.now();
  const report = await runTabScan({
    tabId,
    scanId: crypto.randomUUID(),
    page: { url: tab.url ?? "", title: tab.title ?? "" },
    startedAt: new Date().toISOString(),
    transport,
    signal,
    elapsedMs: () => Math.round(performance.now() - started),
  });
  if (signal.aborted)
    throw new ExpectedScanError(
      "cancelled",
      "The scan was cancelled before it finished.",
    );
  await state.replaceReport(tabId, report);
  return report;
}

const coordinator = createScanCoordinator(performScan);

async function assistantEvidence(
  tabId: number,
  findingId: string,
): Promise<
  | { ok: true; request: AssistantRequestV1 }
  | { ok: false; error: AssistantFailure }
> {
  const current = await state.read(tabId);
  const finding = current?.report?.findings.find(
    (item) => item.findingId === findingId,
  );
  if (!current?.report || current.stale || !finding)
    return {
      ok: false,
      error: {
        code: "stale-finding",
        message: "The page changed. Rescan before explaining this finding.",
      },
    };
  const frameId = finding.frame?.frameId ?? frameIdFromNodeRef(finding.nodeRef);
  if (frameId === undefined)
    return {
      ok: false,
      error: {
        code: "stale-finding",
        message: "This finding has no known frame in the current scan.",
      },
    };
  try {
    const response = parseExtensionResponse(
      await transport.send(tabId, frameId, {
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-evidence",
        findingId,
      }),
    );
    if (response.type !== "assistant-preview-result")
      return {
        ok: false,
        error: {
          code: "stale-finding",
          message: "The scanner returned unexpected evidence data.",
        },
      };
    return response.ok
      ? { ok: true, request: response.request }
      : { ok: false, error: response.error };
  } catch {
    return {
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

function githubResponseType(raw: unknown) {
  const type =
    raw && typeof raw === "object"
      ? String((raw as { type?: unknown }).type)
      : "";
  if (type === "github-get-state") return "github-state-result" as const;
  if (type === "github-start-device-flow")
    return "github-device-flow-start-result" as const;
  if (type === "github-poll-device-flow")
    return "github-device-flow-poll-result" as const;
  if (type === "github-cancel-device-flow" || type === "github-disconnect")
    return "github-command-result" as const;
  if (type === "github-list-repositories")
    return "github-repositories-result" as const;
  if (type === "github-list-labels") return "github-labels-result" as const;
  if (
    type === "github-get-mappings" ||
    type === "github-save-mapping" ||
    type === "github-delete-mapping"
  )
    return "github-mappings-result" as const;
  if (type === "github-create-issue")
    return "github-create-issue-result" as const;
  if (type === "github-check-issue")
    return "github-check-issue-result" as const;
  if (type === "open-integrations-page")
    return "github-command-result" as const;
  return undefined;
}

export default defineBackground(() => {
  chrome.action.onClicked.addListener((tab) => {
    if (tab.id) void chrome.sidePanel.open({ tabId: tab.id });
  });

  chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    // Only this extension's own pages and its injected scanners may drive
    // state, and each may only issue the operations that belong to its side.
    if (sender.id !== chrome.runtime.id) return false;
    const fromExtensionPage = (sender.url ?? "").startsWith(
      `chrome-extension://${chrome.runtime.id}/`,
    );
    void (async (): Promise<ExtensionResponse> => {
      try {
        const request = parseExtensionRequest(raw);

        if (request.type === "scan-stale") {
          const tabId = sender.tab?.id;
          if (fromExtensionPage || tabId === undefined)
            throw new ExpectedScanError(
              "invalid-message",
              "Staleness can only be reported by an inspected page.",
            );
          await state.markStale(tabId, request.reason);
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "command-result",
            ok: true,
          };
        }
        if (!fromExtensionPage)
          throw new ExpectedScanError(
            "invalid-message",
            "This operation is only available to the extension panel.",
          );

        if (request.type === "github-get-state") {
          const view = await githubAuth.getConnectionView();
          const perm = await hasGitHubPermission();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-state-result",
            ok: true,
            connection: view,
            permissionGranted: perm,
          };
        }
        if (request.type === "github-start-device-flow") {
          const flow = await githubAuth.startDeviceFlow();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-device-flow-start-result",
            ok: true,
            flow,
          };
        }
        if (request.type === "github-poll-device-flow") {
          const pollResult = await githubAuth.pollDeviceFlowStep();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-device-flow-poll-result",
            ok: true,
            result: pollResult,
          };
        }
        if (request.type === "github-cancel-device-flow") {
          githubAuth.cancelDeviceFlow();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-command-result",
            ok: true,
          };
        }
        if (request.type === "github-disconnect") {
          await githubAuth.disconnect();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-command-result",
            ok: true,
          };
        }
        if (request.type === "github-list-repositories") {
          const token = await githubAuth.getValidAccessToken();
          if (!token) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-repositories-result",
              ok: false,
              error: {
                code: "unauthenticated",
                message: "GitHub authentication required.",
              },
            };
          }
          const repos = await githubDiscovery.listAccessibleRepositories(token);
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-repositories-result",
            ok: true,
            repositories: repos,
          };
        }
        if (request.type === "github-list-labels") {
          const token = await githubAuth.getValidAccessToken();
          if (!token) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-labels-result",
              ok: false,
              error: {
                code: "unauthenticated",
                message: "GitHub authentication required.",
              },
            };
          }
          const labels = await githubDiscovery.listRepositoryLabels(
            token,
            request.owner,
            request.repo,
          );
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-labels-result",
            ok: true,
            labels,
          };
        }
        if (request.type === "github-get-mappings") {
          const mappings = await domainMappings.getMappings();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-mappings-result",
            ok: true,
            mappings,
          };
        }
        if (request.type === "github-save-mapping") {
          await domainMappings.saveMapping(request.mapping);
          const mappings = await domainMappings.getMappings();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-mappings-result",
            ok: true,
            mappings,
          };
        }
        if (request.type === "github-delete-mapping") {
          await domainMappings.deleteMapping(request.domainKey);
          const mappings = await domainMappings.getMappings();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-mappings-result",
            ok: true,
            mappings,
          };
        }
        if (request.type === "open-integrations-page") {
          if (request.domainKey) {
            await chrome.storage.local.set({
              "github-prefill-domain": request.domainKey,
            });
          }
          await chrome.runtime.openOptionsPage();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-command-result",
            ok: true,
          };
        }

        const tab = await activeTab();
        const tabId = tab.id!;

        if (request.type === "github-check-issue") {
          const domainKey = tab.url ? getDomainKeyFromUrl(tab.url) : null;
          if (!domainKey) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-check-issue-result",
              ok: true,
              existing: null,
              mapped: false,
              domainKey: null,
            };
          }
          const mapping = await domainMappings.getMappingForDomain(domainKey);
          if (!mapping) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-check-issue-result",
              ok: true,
              existing: null,
              mapped: false,
              domainKey,
            };
          }
          const current = await state.read(tabId);
          const finding = current?.report?.findings.find(
            (item) => item.findingId === request.findingId,
          );
          if (!current?.report || current.stale || !finding) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-check-issue-result",
              ok: true,
              existing: null,
              mapped: true,
              domainKey,
            };
          }
          const existing = await githubIssueManager.getExistingIssueRecord(
            mapping.repository.id,
            domainKey,
            tab.url!,
            finding,
          );
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-check-issue-result",
            ok: true,
            existing,
            mapped: true,
            domainKey,
          };
        }

        if (request.type === "github-create-issue") {
          const current = await state.read(tabId);
          const finding = current?.report?.findings.find(
            (item) => item.findingId === request.findingId,
          );
          if (!current?.report || current.stale || !finding) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-create-issue-result",
              ok: false,
              error: {
                code: "stale-finding",
                message: "The page changed. Rescan before creating an issue.",
              },
            };
          }
          const domainKey = tab.url ? getDomainKeyFromUrl(tab.url) : null;
          if (!domainKey) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-create-issue-result",
              ok: false,
              error: {
                code: "unsupported-page",
                message:
                  "This page URL is not supported for GitHub issue creation.",
              },
            };
          }
          const mapping = await domainMappings.getMappingForDomain(domainKey);
          if (!mapping) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-create-issue-result",
              ok: false,
              error: {
                code: "no-mapping",
                message: `No repository mapping configured for domain ${domainKey}.`,
              },
            };
          }
          const token = await githubAuth.getValidAccessToken();
          if (!token) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-create-issue-result",
              ok: false,
              error: {
                code: "unauthenticated",
                message:
                  "GitHub connection expired or missing. Please reconnect at /integrations.",
              },
            };
          }

          const issueResult = await githubIssueManager.createIssue({
            accessToken: token,
            mapping,
            finding,
            pageUrl: tab.url!,
            scannerInfo: current.report.scanner,
            operationId: request.operationId,
          });

          if (!issueResult.ok) {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-create-issue-result",
              ok: false,
              error: {
                code: issueResult.error.code,
                message: issueResult.error.message,
                ...(issueResult.ambiguous ? { ambiguous: true } : {}),
              },
            };
          }

          return {
            schemaVersion: SCHEMA_VERSION,
            type: "github-create-issue-result",
            ok: true,
            issueNumber: issueResult.issueNumber,
            htmlUrl: issueResult.htmlUrl,
            labelMissing: issueResult.labelMissing,
          };
        }

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
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "assistant-test-result",
            ok: true,
            ...(await provider.checkAvailability(settings)),
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
          const evidence = await assistantEvidence(tabId, request.findingId);
          if (!evidence.ok)
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-preview-result",
              ok: false,
              error: evidence.error,
            };
          await state.write(tabId, {
            preview: {
              findingId: request.findingId,
              request: evidence.request,
            },
          });
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "assistant-preview-result",
            ok: true,
            request: evidence.request,
          };
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
          if (generations.has(tabId))
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-result",
              ok: false,
              error: {
                code: "invalid-configuration",
                message: "An advisory is already being generated for this tab.",
              },
            };
          const evidence = await assistantEvidence(tabId, request.findingId);
          if (!evidence.ok)
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-result",
              ok: false,
              error: evidence.error,
            };
          const preview = (await state.read(tabId))?.preview;
          if (
            preview?.findingId !== request.findingId ||
            canonicalJson(preview.request) !== canonicalJson(evidence.request)
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
          generations.set(tabId, controller);
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
            generations.delete(tabId);
          }
        }
        if (request.type === "assistant-cancel") {
          generations.get(tabId)?.abort();
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "assistant-command-result",
            ok: true,
          };
        }
        if (request.type === "get-state") {
          const current = await state.read(tabId);
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "state-result",
            ok: true,
            report: current?.report ?? null,
            stale: current?.stale ?? false,
            ...(current?.staleReason
              ? { staleReason: current.staleReason }
              : {}),
          };
        }
        if (request.type === "scan-cancel") {
          coordinator.cancel(tabId);
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "command-result",
            ok: true,
          };
        }
        if (request.type === "scan-request") {
          const outcome = await coordinator.scan(tabId);
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

        if (request.type !== "overlay-command")
          throw new ExpectedScanError(
            "invalid-message",
            `The panel cannot issue '${request.type}'.`,
          );
        assertSupported(tab.url);
        const current = await state.read(tabId);
        if (!current?.report)
          return {
            schemaVersion: SCHEMA_VERSION,
            type: "command-result",
            ok: false,
            error: {
              code: "stale-finding",
              message: "No current scan exists for this page.",
            },
          };
        if (request.command === "select") {
          const finding = current.report.findings.find(
            (item) => item.findingId === request.findingId,
          );
          const outcome = await routeSelection({
            tabId,
            frameIds: scannedFrameIds(current.report),
            owningFrameId:
              finding?.frame?.frameId ??
              (finding ? frameIdFromNodeRef(finding.nodeRef) : undefined),
            findingId: request.findingId!,
            transport,
          });
          return outcome.ok
            ? {
                schemaVersion: SCHEMA_VERSION,
                type: "command-result",
                ok: true,
              }
            : {
                schemaVersion: SCHEMA_VERSION,
                type: "command-result",
                ok: false,
                error: outcome.error,
              };
        }
        const outcome = await broadcastCommand({
          tabId,
          frameIds: scannedFrameIds(current.report),
          message: request,
          transport,
        });
        return outcome.ok
          ? { schemaVersion: SCHEMA_VERSION, type: "command-result", ok: true }
          : {
              schemaVersion: SCHEMA_VERSION,
              type: "command-result",
              ok: false,
              error: outcome.error,
            };
      } catch (error) {
        const githubType = githubResponseType(raw);
        if (githubType)
          return {
            schemaVersion: SCHEMA_VERSION,
            type: githubType,
            ok: false,
            error: {
              code:
                error instanceof ExpectedScanError
                  ? error.code
                  : "github-error",
              message:
                error instanceof Error
                  ? error.message
                  : "The GitHub integration request failed.",
            },
          } as ExtensionResponse;
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
    coordinator.cancel(tabId);
    generations.get(tabId)?.abort();
    generations.delete(tabId);
    void state.clear(tabId);
  });

  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    coordinator.cancel(removedTabId);
    generations.get(removedTabId)?.abort();
    generations.delete(removedTabId);
    void state.clear(removedTabId);
    void state.markStale(
      addedTabId,
      "Chrome replaced this tab, so the previous scan no longer applies.",
    );
  });

  // Covers full navigation, tab restore, and same-document SPA route changes,
  // all of which surface here without any extra permission.
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status === "loading")
      void invalidate(
        tabId,
        "The page navigated, so the previous scan no longer applies.",
      );
    else if (change.url)
      void invalidate(
        tabId,
        "The page URL changed, so the previous scan no longer applies.",
      );
  });
});

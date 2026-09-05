import type { AssistantRequestV1 } from "./assistant-contracts";
import { parseAssistantRequest } from "./assistant-contracts";
import type { ScanReportV1 } from "./contracts";
import { SCHEMA_VERSION } from "./contracts";
import { MessageValidationError, parseScanReport } from "./messages";

/**
 * Everything the side panel needs to redraw itself after the Manifest V3
 * service worker is suspended. It lives in session storage only: never sync,
 * never local, and never beyond the browsing session.
 */
export type TabSessionStateV1 = {
  schemaVersion: typeof SCHEMA_VERSION;
  report: ScanReportV1 | null;
  stale: boolean;
  staleReason?: string;
  preview?: { findingId: string; request: AssistantRequestV1 };
  updatedAt: string;
};

export const TAB_STATE_KEY_PREFIX = "tab-state:";

export function tabStateKey(tabId: number): string {
  return `${TAB_STATE_KEY_PREFIX}${tabId}`;
}

export function parseTabState(value: unknown): TabSessionStateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new MessageValidationError("tab state must be an object");
  const state = value as Record<string, unknown>;
  if (state.schemaVersion !== SCHEMA_VERSION)
    throw new MessageValidationError("tab state has an unsupported version");
  if (typeof state.stale !== "boolean")
    throw new MessageValidationError("tab state stale must be a boolean");
  if (typeof state.updatedAt !== "string")
    throw new MessageValidationError("tab state updatedAt must be a string");
  const preview = state.preview as
    | { findingId?: unknown; request?: unknown }
    | undefined;
  return {
    schemaVersion: SCHEMA_VERSION,
    report: state.report == null ? null : parseScanReport(state.report),
    stale: state.stale,
    ...(typeof state.staleReason === "string"
      ? { staleReason: state.staleReason }
      : {}),
    ...(preview
      ? {
          preview: {
            findingId: String(preview.findingId),
            request: parseAssistantRequest(preview.request),
          },
        }
      : {}),
    updatedAt: state.updatedAt,
  };
}

type StorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
};

export function createTabStateStore(area: StorageArea, now: () => string) {
  async function read(tabId: number): Promise<TabSessionStateV1 | undefined> {
    const key = tabStateKey(tabId);
    const stored = (await area.get(key))[key];
    if (stored === undefined) return undefined;
    try {
      return parseTabState(stored);
    } catch {
      await area.remove(key);
      return undefined;
    }
  }

  async function write(
    tabId: number,
    patch: Partial<Omit<TabSessionStateV1, "schemaVersion" | "updatedAt">>,
  ): Promise<TabSessionStateV1> {
    const current = await read(tabId);
    const next: TabSessionStateV1 = {
      schemaVersion: SCHEMA_VERSION,
      report: current?.report ?? null,
      stale: current?.stale ?? false,
      ...(current?.staleReason ? { staleReason: current.staleReason } : {}),
      ...(current?.preview ? { preview: current.preview } : {}),
      ...patch,
      updatedAt: now(),
    };
    if (patch.staleReason === undefined && patch.stale === false)
      delete next.staleReason;
    if ("preview" in patch && patch.preview === undefined) delete next.preview;
    await area.set({ [tabStateKey(tabId)]: next });
    return next;
  }

  return {
    read,
    write,

    /** Records a new scan and drops any evidence preview tied to the old one. */
    async replaceReport(
      tabId: number,
      report: ScanReportV1,
    ): Promise<TabSessionStateV1> {
      return write(tabId, {
        report,
        stale: false,
        staleReason: undefined,
        preview: undefined,
      });
    },

    /** Marks existing state stale without discarding it or starting a scan. */
    async markStale(tabId: number, reason: string): Promise<boolean> {
      const current = await read(tabId);
      if (!current || current.stale) return false;
      await write(tabId, {
        stale: true,
        staleReason: reason,
        preview: undefined,
      });
      return true;
    },

    async clear(tabId: number): Promise<void> {
      await area.remove(tabStateKey(tabId));
    },
  };
}

import type { ScanReportV1 } from "./contracts";
import type { ScanFailure } from "./messages";

export type ScanOutcome =
  | { ok: true; report: ScanReportV1 }
  | { ok: false; error: ScanFailure };

export const DEFAULT_SCAN_TIMEOUT_MS = 30_000;

export class ExpectedScanError extends Error {
  constructor(
    readonly code: ScanFailure["code"],
    message: string,
  ) {
    super(message);
  }
}

type PerformScan = (
  tabId: number,
  signal: AbortSignal,
) => Promise<ScanReportV1>;

type ActiveScan = {
  task: Promise<ScanOutcome>;
  controller: AbortController;
};

/**
 * One scan per tab at a time. A cancelled or timed-out scan resolves to its own
 * typed outcome and its late result is dropped rather than replacing newer state.
 */
export function createScanCoordinator(
  performScan: PerformScan,
  options: { timeoutMs?: number } = {},
) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;
  const active = new Map<number, ActiveScan>();

  function settle(tabId: number, entry: ActiveScan): void {
    if (active.get(tabId) === entry) active.delete(tabId);
  }

  return {
    scan(tabId: number): Promise<ScanOutcome> {
      const existing = active.get(tabId);
      if (existing) return existing.task;

      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      const entry: ActiveScan = { controller, task: undefined! };

      // The outcome never waits on a worker that ignores its abort signal; a
      // late result from an abandoned scan is dropped instead of applied.
      const abandoned = new Promise<ScanOutcome>((resolve) => {
        controller.signal.addEventListener(
          "abort",
          () =>
            resolve({
              ok: false,
              error: timedOut
                ? {
                    code: "timeout",
                    message: `The scan did not finish within ${timeoutMs} ms.`,
                  }
                : {
                    code: "cancelled",
                    message: "The scan was cancelled before it finished.",
                  },
            }),
          { once: true },
        );
      });

      const performed = performScan(tabId, controller.signal)
        .then((report): ScanOutcome => ({ ok: true, report }))
        .catch(
          (error): ScanOutcome => ({
            ok: false,
            error: {
              code:
                error instanceof ExpectedScanError ? error.code : "scan-failed",
              message:
                error instanceof Error
                  ? error.message
                  : "The page could not be scanned.",
            },
          }),
        );

      entry.task = Promise.race([performed, abandoned]).finally(() => {
        clearTimeout(timer);
        settle(tabId, entry);
      });

      active.set(tabId, entry);
      return entry.task;
    },

    cancel(tabId: number): boolean {
      const entry = active.get(tabId);
      if (!entry) return false;
      active.delete(tabId);
      entry.controller.abort();
      return true;
    },
  };
}

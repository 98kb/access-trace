import type { ScanReportV1 } from "./contracts";
import type { ScanFailure } from "./messages";

export type ScanOutcome =
  | { ok: true; report: ScanReportV1 }
  | { ok: false; error: ScanFailure };

export class ExpectedScanError extends Error {
  constructor(
    readonly code: ScanFailure["code"],
    message: string,
  ) {
    super(message);
  }
}

export function createScanCoordinator(
  performScan: (tabId: number) => Promise<ScanReportV1>,
) {
  const active = new Map<number, Promise<ScanOutcome>>();

  return {
    scan(tabId: number): Promise<ScanOutcome> {
      const existing = active.get(tabId);
      if (existing) return existing;

      const task = performScan(tabId)
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
        )
        .finally(() => active.delete(tabId));
      active.set(tabId, task);
      return task;
    },
  };
}

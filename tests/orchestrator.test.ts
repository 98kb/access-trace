import { describe, expect, it, vi } from "vitest";

import type { ScanReportV1 } from "../src/contracts";
import { createScanCoordinator } from "../src/orchestrator";

const report = { schemaVersion: "1.0", scanId: "scan-1" } as ScanReportV1;

describe("scan coordinator", () => {
  it("joins concurrent scans for the same tab and allows a later rescan", async () => {
    let finish!: (report: ScanReportV1) => void;
    const perform = vi.fn(
      () => new Promise<ScanReportV1>((resolve) => (finish = resolve)),
    );
    const coordinator = createScanCoordinator(perform);

    const first = coordinator.scan(7);
    const duplicate = coordinator.scan(7);
    expect(perform).toHaveBeenCalledTimes(1);
    finish(report);
    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { ok: true, report },
      { ok: true, report },
    ]);

    perform.mockResolvedValue(report);
    await coordinator.scan(7);
    expect(perform).toHaveBeenCalledTimes(2);
  });

  it("returns a typed failure instead of leaking scanner exceptions", async () => {
    const coordinator = createScanCoordinator(async () => {
      throw new Error("Cannot access a chrome:// URL");
    });

    await expect(coordinator.scan(3)).resolves.toEqual({
      ok: false,
      error: { code: "scan-failed", message: "Cannot access a chrome:// URL" },
    });
  });

  it("cancels an in-progress scan with a distinct outcome and aborts the worker", async () => {
    let observed!: AbortSignal;
    const coordinator = createScanCoordinator(
      (_tabId, signal) =>
        new Promise<ScanReportV1>((_resolve, reject) => {
          observed = signal;
          signal.addEventListener("abort", () =>
            reject(new Error("worker aborted")),
          );
        }),
    );

    const pending = coordinator.scan(1);
    expect(coordinator.cancel(1)).toBe(true);

    await expect(pending).resolves.toEqual({
      ok: false,
      error: {
        code: "cancelled",
        message: "The scan was cancelled before it finished.",
      },
    });
    expect(observed.aborted).toBe(true);
    expect(coordinator.cancel(1)).toBe(false);
  });

  it("fails a scan that outruns its timeout and does not retry it", async () => {
    vi.useFakeTimers();
    const perform = vi.fn(() => new Promise<ScanReportV1>(() => {}));
    const coordinator = createScanCoordinator(perform, { timeoutMs: 5_000 });

    const pending = coordinator.scan(2);
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toEqual({
      ok: false,
      error: {
        code: "timeout",
        message: "The scan did not finish within 5000 ms.",
      },
    });
    expect(perform).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("discards a late result whose scan was already superseded", async () => {
    let finishFirst!: (report: ScanReportV1) => void;
    const perform = vi
      .fn<(tabId: number, signal: AbortSignal) => Promise<ScanReportV1>>()
      .mockImplementationOnce(
        () => new Promise<ScanReportV1>((resolve) => (finishFirst = resolve)),
      )
      .mockResolvedValue({ ...report, scanId: "scan-2" });
    const coordinator = createScanCoordinator(perform);

    const first = coordinator.scan(9);
    coordinator.cancel(9);
    await expect(first).resolves.toMatchObject({ ok: false });

    const second = await coordinator.scan(9);
    finishFirst({ ...report, scanId: "scan-late" });
    expect(second).toEqual({
      ok: true,
      report: { ...report, scanId: "scan-2" },
    });
    expect(perform).toHaveBeenCalledTimes(2);
    expect(coordinator.cancel(9)).toBe(false);
  });
});

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
});

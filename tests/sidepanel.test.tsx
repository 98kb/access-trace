import axe from "axe-core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import App from "../entrypoints/sidepanel/App";
import type { ScanReportV1 } from "../src/contracts";
import type { ExtensionRequest, ExtensionResponse } from "../src/messages";

const scannedReport: ScanReportV1 = {
  schemaVersion: "1.0",
  scanId: "scan-1",
  scanner: { name: "axe-core", version: "4.13.0" },
  page: { url: "https://example.test/fixture", title: "Fixture page" },
  startedAt: "2026-09-05T10:00:00.000Z",
  durationMs: 24,
  coverage: { complete: true, ruleCounts: { passes: 17, inapplicable: 40 } },
  warnings: [],
  skippedRegions: [],
  findings: [
    {
      findingId: "finding-image",
      ruleId: "image-alt",
      status: "violation",
      impact: "critical",
      tags: ["wcag2a", "wcag111"],
      help: "Images must have alternative text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
      failureSummary: "Add alternative text.",
      locator: { segments: [{ type: "css", selector: "#hero" }] },
      evidence: '<img id="hero" src="hero.png">',
      nodeRef: "node-image",
    },
    {
      findingId: "finding-contrast",
      ruleId: "color-contrast",
      status: "needs-review",
      impact: "unknown",
      tags: ["wcag2aa", "wcag143"],
      help: "Contrast must be reviewed",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/color-contrast",
      failureSummary: "Contrast could not be determined.",
      locator: { segments: [{ type: "css", selector: ".hero-copy" }] },
      evidence: '<p class="hero-copy">Text</p>',
      nodeRef: "node-contrast",
    },
  ],
};

describe("side panel", () => {
  it("scans only on request, filters findings, selects a target, and toggles the overlay", async () => {
    let finishScan!: (response: ExtensionResponse) => void;
    const send = vi.fn(
      (request: ExtensionRequest): Promise<ExtensionResponse> => {
        if (request.type === "get-state")
          return Promise.resolve({
            schemaVersion: "1.0",
            type: "state-result",
            ok: true,
            report: null,
          });
        if (request.type === "scan-request")
          return new Promise((resolve) => (finishScan = resolve));
        return Promise.resolve({
          schemaVersion: "1.0",
          type: "command-result",
          ok: true,
        });
      },
    );
    const user = userEvent.setup();
    render(<App send={send} />);

    const scan = await screen.findByRole("button", { name: "Scan this page" });
    expect(send).toHaveBeenCalledTimes(1);
    await user.click(scan);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Scanning the rendered page",
    );
    finishScan({
      schemaVersion: "1.0",
      type: "scan-result",
      ok: true,
      report: scannedReport,
    });

    expect(await screen.findByText("Fixture page")).toBeVisible();
    expect(screen.getByLabelText("Finding counts")).toHaveTextContent(
      "1 violation",
    );
    expect(screen.getByLabelText("Finding counts")).toHaveTextContent(
      "1 needs review",
    );
    expect(screen.getByRole("button", { name: /image-alt/i })).toBeVisible();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Status" }),
      "needs-review",
    );
    expect(
      screen.queryByRole("button", { name: /image-alt/i }),
    ).not.toBeInTheDocument();
    const contrast = screen.getByRole("button", { name: /color-contrast/i });
    await user.click(contrast);
    expect(send).toHaveBeenLastCalledWith({
      schemaVersion: "1.0",
      type: "overlay-command",
      command: "select",
      findingId: "finding-contrast",
    });

    await user.click(screen.getByRole("button", { name: "Hide overlay" }));
    expect(send).toHaveBeenLastCalledWith({
      schemaVersion: "1.0",
      type: "overlay-command",
      command: "hide",
    });
    await user.click(screen.getByRole("button", { name: "Show overlay" }));
    expect(send).toHaveBeenLastCalledWith({
      schemaVersion: "1.0",
      type: "overlay-command",
      command: "show-all",
    });
  });

  it("presents clean and unsupported states without claiming compliance", async () => {
    const user = userEvent.setup();
    const send = vi
      .fn<(request: ExtensionRequest) => Promise<ExtensionResponse>>()
      .mockResolvedValueOnce({
        schemaVersion: "1.0",
        type: "state-result",
        ok: true,
        report: null,
      })
      .mockResolvedValueOnce({
        schemaVersion: "1.0",
        type: "scan-result",
        ok: true,
        report: { ...scannedReport, findings: [] },
      })
      .mockResolvedValueOnce({
        schemaVersion: "1.0",
        type: "scan-result",
        ok: false,
        error: {
          code: "unsupported-page",
          message: "Chrome internal pages cannot be scanned.",
        },
      });
    const { container } = render(<App send={send} />);
    await user.click(
      await screen.findByRole("button", { name: "Scan this page" }),
    );
    expect(await screen.findByText("No automated findings")).toBeVisible();
    expect(screen.getByText(/does not prove WCAG compliance/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Rescan" }));
    expect(
      await screen.findByRole("heading", {
        name: "This page is not supported",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("Chrome internal pages cannot be scanned."),
    ).toBeVisible();

    await waitFor(async () =>
      expect(
        (
          await axe.run(container, {
            rules: { "color-contrast": { enabled: false } },
          })
        ).violations,
      ).toEqual([]),
    );
  });

  it("shows stale overlay failures with a visible rescan recovery", async () => {
    const send = vi.fn(
      (request: ExtensionRequest): Promise<ExtensionResponse> => {
        if (request.type === "get-state")
          return Promise.resolve({
            schemaVersion: "1.0",
            type: "state-result",
            ok: true,
            report: scannedReport,
          });
        return Promise.resolve({
          schemaVersion: "1.0",
          type: "command-result",
          ok: false,
          error: {
            code: "stale-finding",
            message: "The page changed. Rescan before locating this finding.",
          },
        });
      },
    );
    const user = userEvent.setup();
    render(<App send={send} />);

    await user.click(await screen.findByRole("button", { name: /image-alt/i }));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "The page changed. Rescan before locating this finding.",
    );
    expect(alert).toContainElement(
      screen.getByRole("button", { name: "Rescan page" }),
    );
  });

  it("recovers visibly when extension messaging rejects", async () => {
    const send = vi
      .fn<(request: ExtensionRequest) => Promise<ExtensionResponse>>()
      .mockResolvedValueOnce({
        schemaVersion: "1.0",
        type: "state-result",
        ok: true,
        report: null,
      })
      .mockRejectedValueOnce(new Error("Extension context unavailable."));
    const user = userEvent.setup();
    render(<App send={send} />);

    await user.click(
      await screen.findByRole("button", { name: "Scan this page" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "The scan could not be completed",
      }),
    ).toBeVisible();
    expect(screen.getByText("Extension context unavailable.")).toBeVisible();
  });
});

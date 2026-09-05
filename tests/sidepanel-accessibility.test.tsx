import axe from "axe-core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import App from "../entrypoints/sidepanel/App";
import { CLOSED_SHADOW_ROOT_NOTE } from "../src/aggregate";
import type { ScanReportV1 } from "../src/contracts";
import type { ExtensionRequest, ExtensionResponse } from "../src/messages";
import { DEFAULT_ASSISTANT_SETTINGS } from "../src/ollama";

const report: ScanReportV1 = {
  schemaVersion: "1.0",
  scanId: "scan-1",
  scanner: { name: "axe-core", version: "4.13.0" },
  page: {
    url: "https://example.test/a-very-long-path-segment-that-should-wrap-instead-of-scrolling",
    title: "Fixture page with an unusually long document title for wrapping",
  },
  startedAt: "2026-09-05T10:00:00.000Z",
  durationMs: 24,
  coverage: {
    complete: false,
    ruleCounts: { passes: 17, inapplicable: 40 },
    topDocument: "scanned",
    frames: { discovered: 2, scanned: 1, skipped: 1, failed: 0 },
    shadowRoots: { openScanned: 1, closedEncountered: 0 },
    regions: [
      {
        kind: "document",
        state: "scanned",
        detail: "Top document",
        frameId: 0,
      },
      {
        kind: "frame",
        state: "scanned",
        detail: "https://example.test/widget",
        frameId: 3,
      },
      {
        kind: "frame",
        state: "skipped",
        reason: "cross-origin-frame",
        detail: "https://other.test/ad",
      },
    ],
    cancelled: false,
    partial: true,
  },
  warnings: [
    "1 frame was skipped because it is cross-origin and inaccessible to this extension.",
    CLOSED_SHADOW_ROOT_NOTE,
  ],
  skippedRegions: [],
  findings: [
    {
      findingId: "finding-image",
      ruleId: "image-alt",
      status: "violation",
      impact: "critical",
      tags: ["wcag2a"],
      help: "Images must have alternative text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
      failureSummary: "Add alternative text.",
      locator: { segments: [{ type: "css", selector: "#hero" }] },
      evidence: '<img id="hero" src="hero.png">',
      nodeRef: "scan-1:0:hero",
      frame: {
        frameId: 0,
        parentFrameId: -1,
        url: "https://example.test/",
        depth: 0,
      },
    },
    {
      findingId: "finding-frame-label",
      ruleId: "label",
      status: "violation",
      impact: "serious",
      tags: ["wcag2a"],
      help: "Form elements must have labels",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.13/label",
      failureSummary: "Add a label.",
      locator: { segments: [{ type: "css", selector: "#field" }] },
      evidence: '<input id="field">',
      nodeRef: "scan-1:3:field",
      frame: {
        frameId: 3,
        parentFrameId: -1,
        url: "https://example.test/widget",
        depth: 1,
      },
    },
  ],
};

function stubSend(
  overrides: Partial<
    Record<ExtensionRequest["type"], () => Promise<ExtensionResponse>>
  > = {},
  state: Partial<Extract<ExtensionResponse, { type: "state-result" }>> = {},
) {
  return vi.fn((request: ExtensionRequest): Promise<ExtensionResponse> => {
    const override = overrides[request.type];
    if (override) return override();
    if (request.type === "get-state")
      return Promise.resolve({
        schemaVersion: "1.0",
        type: "state-result",
        ok: true,
        report,
        ...state,
      } as ExtensionResponse);
    if (request.type === "scan-request")
      return Promise.resolve({
        schemaVersion: "1.0",
        type: "scan-result",
        ok: true,
        report,
      });
    return Promise.resolve({
      schemaVersion: "1.0",
      type: "command-result",
      ok: true,
    });
  });
}

describe("side panel accessibility", () => {
  it("reaches every primary control by keyboard alone", async () => {
    const send = stubSend();
    const user = userEvent.setup();
    render(<App send={send} />);
    await screen.findByRole("heading", { name: "Findings" });

    const reachable = new Set<string>();
    for (let step = 0; step < 40; step += 1) {
      await user.tab();
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body)
        reachable.add(
          `${active.tagName}:${active.getAttribute("aria-label") ?? active.textContent?.trim().slice(0, 30)}`,
        );
    }

    expect([...reachable].join("|")).toContain("Rescan");
    expect([...reachable].join("|")).toContain("Show overlay");
    expect([...reachable].join("|")).toContain("image-alt");
  });

  it("activates a finding with the keyboard and announces the selection", async () => {
    const send = stubSend();
    const user = userEvent.setup();
    render(<App send={send} />);

    const finding = await screen.findByRole("button", {
      name: /^image-alt critical/i,
    });
    finding.focus();
    await user.keyboard("{Enter}");

    expect(send).toHaveBeenLastCalledWith({
      schemaVersion: "1.0",
      type: "overlay-command",
      command: "select",
      findingId: "finding-image",
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Finding selected on the page",
      ),
    );
    expect(finding).toHaveAttribute("aria-pressed", "true");
  });

  it("announces filter result counts without needing a visual scan", async () => {
    const send = stubSend();
    const user = userEvent.setup();
    render(<App send={send} />);
    await screen.findByRole("heading", { name: "Findings" });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Impact" }),
      "critical",
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "1 of 2 findings match the current filters",
    );
  });

  it("states what was scanned and what was skipped instead of only warning vaguely", async () => {
    render(<App send={stubSend()} />);
    const coverage = await screen.findByRole("region", {
      name: "Scan coverage",
    });

    expect(coverage).toHaveTextContent(
      "Scanned the top document and 1 of 2 child frames.",
    );
    expect(coverage).toHaveTextContent(
      "1 frame was skipped because it is cross-origin and inaccessible",
    );
    expect(coverage).toHaveTextContent(
      "Closed shadow roots cannot be detected",
    );
  });

  it("attributes a finding to the frame that owns it", async () => {
    render(<App send={stubSend()} />);
    const finding = await screen.findByRole("button", { name: /^label\b/i });

    expect(finding).toHaveTextContent("In frame: https://example.test/widget");
    expect(
      within(
        screen.getByRole("button", { name: /^image-alt critical/i }),
      ).queryByText(/In frame/),
    ).toBeNull();
  });

  it("communicates severity with text, not colour alone", async () => {
    render(<App send={stubSend()} />);
    const finding = await screen.findByRole("button", {
      name: /^image-alt critical/i,
    });

    expect(finding).toHaveTextContent("critical");
    expect(finding).toHaveTextContent("Violation");
  });

  it("opens external help without handing the opener to the target", async () => {
    render(<App send={stubSend()} />);
    await screen.findByRole("heading", { name: "Findings" });

    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel") ?? "").toMatch(/noreferrer|noopener/);
    }
  });

  it("passes Axe on the populated results state", async () => {
    const { container } = render(<App send={stubSend()} />);
    await screen.findByRole("heading", { name: "Findings" });

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
});

describe("side panel staleness and lifecycle", () => {
  it("blocks highlighting and offers a rescan when state goes stale", async () => {
    const send = stubSend({}, {
      stale: true,
      staleReason:
        "The page URL changed, so the previous scan no longer applies.",
    } as never);
    render(<App send={send} />);

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("These findings are out of date");
    expect(banner).toHaveTextContent("The page URL changed");
    expect(
      screen.getByRole("button", { name: /^image-alt critical/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Show overlay" })).toBeDisabled();
    expect(
      within(banner).getByRole("button", { name: "Rescan page" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("heading", { name: "These findings are out of date" }),
    ).toHaveFocus();
  });

  it("refreshes when the background reports a change after a worker restart", async () => {
    let notify!: () => void;
    let stale = false;
    const send = vi.fn(
      (request: ExtensionRequest): Promise<ExtensionResponse> => {
        if (request.type === "get-state")
          return Promise.resolve({
            schemaVersion: "1.0",
            type: "state-result",
            ok: true,
            report,
            stale,
            ...(stale ? { staleReason: "The page navigated." } : {}),
          } as ExtensionResponse);
        return Promise.resolve({
          schemaVersion: "1.0",
          type: "command-result",
          ok: true,
        });
      },
    );
    render(
      <App
        send={send}
        subscribeToState={(listener) => {
          notify = listener;
          return () => undefined;
        }}
      />,
    );
    await screen.findByRole("heading", { name: "Findings" });
    expect(screen.queryByRole("alert")).toBeNull();

    stale = true;
    notify();

    expect(
      await screen.findByRole("heading", {
        name: "These findings are out of date",
      }),
    ).toBeVisible();
  });

  it("keeps a stale banner when a refresh cannot prove the report is fresh", async () => {
    let notify!: () => void;
    let carryReport = true;
    const send = vi.fn(
      (request: ExtensionRequest): Promise<ExtensionResponse> => {
        if (request.type === "get-state")
          return Promise.resolve({
            schemaVersion: "1.0",
            type: "state-result",
            ok: true,
            report: carryReport ? report : null,
            stale: carryReport,
            ...(carryReport ? { staleReason: "The page navigated." } : {}),
          } as ExtensionResponse);
        return Promise.resolve({
          schemaVersion: "1.0",
          type: "command-result",
          ok: true,
        });
      },
    );
    render(
      <App
        send={send}
        subscribeToState={(listener) => {
          notify = listener;
          return () => undefined;
        }}
      />,
    );
    await screen.findByRole("heading", {
      name: "These findings are out of date",
    });

    carryReport = false;
    notify();
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));

    expect(
      screen.getByRole("heading", { name: "These findings are out of date" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /^image-alt critical/i }),
    ).toBeDisabled();
  });

  it("offers cancellation while scanning and does not start a duplicate scan", async () => {
    let finish!: (response: ExtensionResponse) => void;
    const send = stubSend(
      {
        "get-state": () =>
          Promise.resolve({
            schemaVersion: "1.0",
            type: "state-result",
            ok: true,
            report: null,
          }),
        "scan-request": () => new Promise((resolve) => (finish = resolve)),
      },
      {},
    );
    const user = userEvent.setup();
    render(<App send={send} />);

    await user.click(
      await screen.findByRole("button", { name: "Scan this page" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel scan" }));

    expect(
      send.mock.calls.filter(([request]) => request.type === "scan-request"),
    ).toHaveLength(1);
    expect(
      send.mock.calls.filter(([request]) => request.type === "scan-cancel"),
    ).toHaveLength(1);

    finish({
      schemaVersion: "1.0",
      type: "scan-result",
      ok: false,
      error: {
        code: "cancelled",
        message: "The scan was cancelled before it finished.",
      },
    });
    expect(
      await screen.findByRole("heading", { name: "The scan was cancelled" }),
    ).toBeVisible();
  });

  it("downgrades to permission-needed when loopback access is revoked, without breaking scanning", async () => {
    let scans = 0;
    const send = vi.fn(
      (request: ExtensionRequest): Promise<ExtensionResponse> => {
        if (request.type === "get-state")
          return Promise.resolve({
            schemaVersion: "1.0",
            type: "state-result",
            ok: true,
            report,
          } as ExtensionResponse);
        if (request.type === "assistant-settings-get")
          return Promise.resolve({
            schemaVersion: "1.0",
            type: "assistant-settings-result",
            ok: true,
            settings: { ...DEFAULT_ASSISTANT_SETTINGS, enabled: true },
            permissionGranted: true,
          });
        if (request.type === "assistant-preview")
          // Chrome revoked the loopback origin between enabling and using it.
          return Promise.resolve({
            schemaVersion: "1.0",
            type: "assistant-preview-result",
            ok: false,
            error: {
              code: "permission-denied",
              message:
                "Chrome permission for the configured loopback provider is missing.",
            },
          });
        if (request.type === "scan-request") {
          scans += 1;
          return Promise.resolve({
            schemaVersion: "1.0",
            type: "scan-result",
            ok: true,
            report,
          });
        }
        return Promise.resolve({
          schemaVersion: "1.0",
          type: "command-result",
          ok: true,
        });
      },
    );
    const user = userEvent.setup();
    render(<App send={send} />);

    await user.click(
      await screen.findByRole("button", {
        name: "Explain image-alt with local AI",
      }),
    );

    expect(
      await screen.findByText("Permission needed for the loopback provider"),
    ).toBeVisible();

    // Deterministic scanning is untouched by the revoked optional permission.
    await user.click(screen.getByRole("button", { name: "Rescan" }));
    await waitFor(() => expect(scans).toBe(1));
    expect(
      screen.getByRole("heading", { name: "Findings" }),
    ).toBeInTheDocument();
  });

  it("surfaces a scan timeout as its own recoverable state", async () => {
    const send = stubSend({
      "get-state": () =>
        Promise.resolve({
          schemaVersion: "1.0",
          type: "state-result",
          ok: true,
          report: null,
        }),
      "scan-request": () =>
        Promise.resolve({
          schemaVersion: "1.0",
          type: "scan-result",
          ok: false,
          error: {
            code: "timeout",
            message: "The scan did not finish within 30000 ms.",
          },
        }),
    });
    const user = userEvent.setup();
    render(<App send={send} />);

    await user.click(
      await screen.findByRole("button", { name: "Scan this page" }),
    );

    expect(
      await screen.findByRole("heading", { name: "The scan timed out" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });
});

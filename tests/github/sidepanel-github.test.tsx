import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "../../entrypoints/sidepanel/App";
import { SCHEMA_VERSION } from "../../src/contracts";
import type { ExtensionRequest, ExtensionResponse } from "../../src/messages";

const sampleReport = {
  schemaVersion: SCHEMA_VERSION,
  scanId: "scan-123",
  scanner: { name: "axe-core" as const, version: "4.13.0" },
  page: { url: "https://example.com/checkout", title: "Checkout Page" },
  startedAt: "2026-09-06T10:00:00.000Z",
  durationMs: 120,
  coverage: {
    complete: true,
    topDocument: "scanned" as const,
    ruleCounts: { passes: 10, inapplicable: 5 },
    frames: { discovered: 1, scanned: 1, skipped: 0, failed: 0 },
    shadowRoots: { openScanned: 0, closedEncountered: 0 },
    regions: [
      {
        kind: "document" as const,
        state: "scanned" as const,
        detail: "Top document scanned",
      },
    ],
  },
  skippedRegions: [],
  warnings: [],
  findings: [
    {
      findingId: "f-1",
      ruleId: "image-alt",
      status: "violation" as const,
      impact: "critical" as const,
      tags: ["wcag2a"],
      help: "Images must have alt text",
      helpUrl: "https://example.com/rule",
      failureSummary: "Fix missing alt",
      evidence: '<img src="cat.png">',
      nodeRef: "node-1",
      locator: { segments: [{ type: "css" as const, selector: "img" }] },
    },
  ],
};

describe("Side panel GitHub finding card action", () => {
  it("renders Add issue on GitHub action and opens integrations page when unmapped", async () => {
    const send = vi
      .fn()
      .mockImplementation(
        async (req: ExtensionRequest): Promise<ExtensionResponse> => {
          if (req.type === "get-state") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "state-result",
              ok: true,
              report: sampleReport,
            };
          }
          if (req.type === "assistant-settings-get") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-settings-result",
              ok: true,
              settings: {
                enabled: false,
                host: "127.0.0.1",
                port: 11434,
                model: "llama3",
                timeoutMs: 30000,
              },
              permissionGranted: true,
            };
          }
          if (req.type === "github-check-issue") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-check-issue-result",
              ok: true,
              existing: null,
              mapped: false,
              domainKey: "example.com",
            };
          }
          if (req.type === "open-integrations-page") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-command-result",
              ok: true,
            };
          }
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    const user = userEvent.setup();
    render(<App send={send} />);

    await waitFor(() => {
      expect(screen.getByText("Fix missing alt")).toBeInTheDocument();
    });

    const githubBtn = screen.getByRole("button", {
      name: "Add issue on GitHub",
    });
    expect(githubBtn).toBeInTheDocument();

    await user.click(githubBtn);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "open-integrations-page",
        domainKey: "example.com",
      }),
    );
  });

  it("creates issue when mapped and updates action to View GitHub issue", async () => {
    const send = vi
      .fn()
      .mockImplementation(
        async (req: ExtensionRequest): Promise<ExtensionResponse> => {
          if (req.type === "get-state") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "state-result",
              ok: true,
              report: sampleReport,
            };
          }
          if (req.type === "assistant-settings-get") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "assistant-settings-result",
              ok: true,
              settings: {
                enabled: false,
                host: "127.0.0.1",
                port: 11434,
                model: "llama3",
                timeoutMs: 30000,
              },
              permissionGranted: true,
            };
          }
          if (req.type === "github-check-issue") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-check-issue-result",
              ok: true,
              existing: null,
              mapped: true,
              domainKey: "example.com",
            };
          }
          if (req.type === "github-create-issue") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-create-issue-result",
              ok: true,
              issueNumber: 42,
              htmlUrl: "https://github.com/acme/web/issues/42",
              labelMissing: false,
            };
          }
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    const user = userEvent.setup();
    render(<App send={send} />);

    await waitFor(() => {
      expect(screen.getByText("Fix missing alt")).toBeInTheDocument();
    });

    const addBtn = screen.getByRole("button", {
      name: "Add issue on GitHub",
    });
    await user.click(addBtn);

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "View GitHub issue" }),
      ).toBeInTheDocument();
    });

    const viewLink = screen.getByRole("link", { name: "View GitHub issue" });
    expect(viewLink).toHaveAttribute(
      "href",
      "https://github.com/acme/web/issues/42",
    );
  });
});

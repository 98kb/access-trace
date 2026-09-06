import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OptionsApp from "../../entrypoints/options/App";
import { SCHEMA_VERSION } from "../../src/contracts";
import type { ExtensionRequest, ExtensionResponse } from "../../src/messages";

describe("Options page at /integrations", () => {
  it("renders not-configured state when client ID is absent", async () => {
    const send = vi
      .fn()
      .mockImplementation(
        async (req: ExtensionRequest): Promise<ExtensionResponse> => {
          if (req.type === "github-get-state") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-state-result",
              ok: true,
              connection: {
                schemaVersion: "1.0",
                state: "not-configured",
                user: null,
                expiresAt: null,
                error: {
                  code: "not-configured",
                  message:
                    "GitHub App client ID is not configured in this build.",
                },
              },
              permissionGranted: false,
            };
          }
          if (req.type === "github-get-mappings") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-mappings-result",
              ok: true,
              mappings: [],
            };
          }
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    render(<OptionsApp send={send} />);

    await waitFor(() => {
      expect(
        screen.getByText(
          /GitHub App client ID is not configured in this build/,
        ),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("heading", { name: "Integrations" }),
    ).toBeInTheDocument();
  });

  it("handles Connect GitHub flow and mapping creation", async () => {
    const send = vi
      .fn()
      .mockImplementation(
        async (req: ExtensionRequest): Promise<ExtensionResponse> => {
          if (req.type === "github-get-state") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-state-result",
              ok: true,
              connection: {
                schemaVersion: "1.0",
                state: "connected",
                user: { id: 1, login: "octocat", name: "Monalisa Octocat" },
                expiresAt: "2026-09-06T18:00:00.000Z",
                error: null,
              },
              permissionGranted: true,
            };
          }
          if (req.type === "github-get-mappings") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-mappings-result",
              ok: true,
              mappings: [],
            };
          }
          if (req.type === "github-list-repositories") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-repositories-result",
              ok: true,
              repositories: [
                {
                  id: 101,
                  owner: "acme",
                  name: "web-app",
                  fullName: "acme/web-app",
                  htmlUrl: "https://github.com/acme/web-app",
                  installationId: 99,
                },
              ],
            };
          }
          if (req.type === "github-list-labels") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-labels-result",
              ok: true,
              labels: [{ id: 50, name: "accessibility", color: "d4c5f9" }],
            };
          }
          if (req.type === "github-save-mapping") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-mappings-result",
              ok: true,
              mappings: [req.mapping],
            };
          }
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    const user = userEvent.setup();
    render(<OptionsApp send={send} initialPrefillDomain="example.com" />);

    await waitFor(() => {
      expect(screen.getByText("@octocat")).toBeInTheDocument();
    });

    expect(screen.getByText("Data disclosure")).toBeInTheDocument();

    const domainInput = screen.getByLabelText("Exact domain");
    expect(domainInput).toHaveValue("example.com");

    const repoSelect = screen.getByLabelText("GitHub repository");
    await waitFor(() => {
      expect(screen.getByText("acme/web-app")).toBeInTheDocument();
    });
    await user.selectOptions(repoSelect, "101");

    const labelSelect = screen.getByLabelText("Repository label (optional)");
    await waitFor(() => {
      expect(screen.getByText("accessibility")).toBeInTheDocument();
    });
    await user.selectOptions(labelSelect, "accessibility");

    const saveBtn = screen.getByRole("button", { name: "Save mapping" });
    await user.click(saveBtn);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "github-save-mapping",
        mapping: expect.objectContaining({
          domainKey: "example.com",
          repository: expect.objectContaining({ fullName: "acme/web-app" }),
          label: expect.objectContaining({ name: "accessibility" }),
        }),
      }),
    );
  });
});

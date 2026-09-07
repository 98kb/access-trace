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

  it("starts device flow when clicking Connect GitHub and confirming in dialog", async () => {
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
                state: "disconnected",
                user: null,
                expiresAt: null,
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
          if (req.type === "github-start-device-flow") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-device-flow-start-result",
              ok: true,
              flow: {
                userCode: "ABCD-1234",
                verificationUri: "https://github.com/login/device",
                expiresIn: 900,
                interval: 5,
              },
            };
          }
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    const user = userEvent.setup();
    render(<OptionsApp send={send} />);

    const connectBtn = await screen.findByRole("button", {
      name: "Connect GitHub",
    });
    await user.click(connectBtn);

    const confirmBtn = screen.getByRole("button", {
      name: "I have installed it, Continue to Connect",
    });
    await user.click(confirmBtn);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "github-start-device-flow",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: "Open GitHub Verification Page" }),
    ).toHaveAttribute("href", "https://github.com/login/device");
  });

  it("displays clear notice and domain hint when opened with prefill domain in disconnected state", async () => {
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
                state: "disconnected",
                user: null,
                expiresAt: null,
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
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    render(<OptionsApp send={send} initialPrefillDomain="mysite.org" />);

    await waitFor(() => {
      expect(
        screen.getByText(
          "Configure GitHub repository mapping for mysite.org to enable issue creation.",
        ),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("mysite.org")).toBeInTheDocument();
    expect(screen.getByText(/Target domain to map:/)).toBeInTheDocument();
  });

  it("handles device flow completion, updates UI and stops polling", async () => {
    let connectionState: "disconnected" | "connecting" | "connected" =
      "disconnected";
    let pollCount = 0;

    const send = vi
      .fn()
      .mockImplementation(
        async (req: ExtensionRequest): Promise<ExtensionResponse> => {
          if (req.type === "github-get-state") {
            if (connectionState === "connected") {
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
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-state-result",
              ok: true,
              connection: {
                schemaVersion: "1.0",
                state: connectionState,
                user: null,
                expiresAt: null,
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
          if (req.type === "github-start-device-flow") {
            connectionState = "connecting";
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-device-flow-start-result",
              ok: true,
              flow: {
                userCode: "ABCD-1234",
                verificationUri: "https://github.com/login/device",
                expiresIn: 900,
                interval: 1,
              },
            };
          }
          if (req.type === "github-poll-device-flow") {
            pollCount++;
            connectionState = "connected";
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-device-flow-poll-result",
              ok: true,
              result: {
                status: "success",
              },
            };
          }
          if (req.type === "github-list-repositories") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-repositories-result",
              ok: true,
              repositories: [],
            };
          }
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    const user = userEvent.setup();
    render(<OptionsApp send={send} />);

    const connectBtn = await screen.findByRole("button", {
      name: "Connect GitHub",
    });
    await user.click(connectBtn);
    await user.click(
      screen.getByRole("button", {
        name: "I have installed it, Continue to Connect",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    });

    // Wait for the 1s interval poll to happen and UI to reflect connected state
    await waitFor(
      () => {
        expect(screen.getByText("@octocat")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    const pollsAtSuccess = pollCount;
    // Wait a bit more to ensure it stopped polling
    await new Promise((r) => setTimeout(r, 1500));
    expect(pollCount).toBe(pollsAtSuccess);
  });

  it("handles real GitHubAuthManager device flow transition to connected state in OptionsApp", async () => {
    const { GitHubAuthManager } = await import("../../src/github/auth");

    const mockStorage: Record<string, unknown> = {};
    const mockFetch = vi.fn();

    // 1. Device code
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: "dev_12345",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 1,
      }),
    });

    // 2. Poll 1: authorization_pending
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "authorization_pending" }),
    });

    // 3. Poll 2: success token response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "ghu_access_token_123",
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "ghr_refresh_token_123",
        refresh_token_expires_in: 15768000,
      }),
    });

    // 4. GET /user response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 99,
        login: "octocat",
        name: "Monalisa Octocat",
        avatar_url: "https://github.com/avatar.png",
      }),
    });

    // 5. GET /user/installations (from list-repositories)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        installations: [],
      }),
    });

    const authManager = new GitHubAuthManager({
      config: {
        clientId: "test-client-id",
        installationUrl: "https://github.com/apps/test-app",
      },
      fetch: mockFetch as unknown as typeof fetch,
      storage: {
        get: async (key: string) => mockStorage[key],
        set: async (key: string, val: unknown) => {
          mockStorage[key] = val;
        },
        remove: async (key: string) => {
          delete mockStorage[key];
        },
      },
    });

    let pollCount = 0;

    const send = vi
      .fn()
      .mockImplementation(
        async (req: ExtensionRequest): Promise<ExtensionResponse> => {
          if (req.type === "github-get-state") {
            const view = await authManager.getConnectionView();
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-state-result",
              ok: true,
              connection: view,
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
          if (req.type === "github-start-device-flow") {
            const flow = await authManager.startDeviceFlow();
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-device-flow-start-result",
              ok: true,
              flow,
            };
          }
          if (req.type === "github-poll-device-flow") {
            pollCount++;
            const result = await authManager.pollDeviceFlowStep();
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-device-flow-poll-result",
              ok: true,
              result,
            };
          }
          if (req.type === "github-list-repositories") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-repositories-result",
              ok: true,
              repositories: [],
            };
          }
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    const user = userEvent.setup();
    render(<OptionsApp send={send} />);

    const connectBtn = await screen.findByRole("button", {
      name: "Connect GitHub",
    });
    await user.click(connectBtn);
    await user.click(
      screen.getByRole("button", {
        name: "I have installed it, Continue to Connect",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    });

    // Wait for the poll to resolve and UI to reflect connected state
    await waitFor(
      () => {
        expect(screen.getByText("@octocat")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    const pollsAtSuccess = pollCount;
    await new Promise((r) => setTimeout(r, 1500));
    expect(pollCount).toBe(pollsAtSuccess);
  });

  it("successfully connects and stops polling when GitHub returns tokens without refresh_token", async () => {
    const { GitHubAuthManager } = await import("../../src/github/auth");

    const mockStorage: Record<string, unknown> = {};
    const mockFetch = vi.fn();

    // 1. Device code
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: "dev_12345",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 1,
      }),
    });

    // 2. Poll 1: authorization_pending
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "authorization_pending" }),
    });

    // 3. Poll 2: success token response WITHOUT refresh_token (standard GitHub App default)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "ghu_access_token_123",
        token_type: "bearer",
        scope: "",
      }),
    });

    // 4. GET /user response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 99,
        login: "octocat",
        name: "Monalisa Octocat",
        avatar_url: "https://github.com/avatar.png",
      }),
    });

    // 5. GET /user/installations (from list-repositories)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        installations: [],
      }),
    });

    const authManager = new GitHubAuthManager({
      config: {
        clientId: "test-client-id",
        installationUrl: "https://github.com/apps/test-app",
      },
      fetch: mockFetch as unknown as typeof fetch,
      storage: {
        get: async (key: string) => mockStorage[key],
        set: async (key: string, val: unknown) => {
          mockStorage[key] = val;
        },
        remove: async (key: string) => {
          delete mockStorage[key];
        },
      },
    });

    let pollCount = 0;

    const send = vi
      .fn()
      .mockImplementation(
        async (req: ExtensionRequest): Promise<ExtensionResponse> => {
          if (req.type === "github-get-state") {
            const view = await authManager.getConnectionView();
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-state-result",
              ok: true,
              connection: view,
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
          if (req.type === "github-start-device-flow") {
            const flow = await authManager.startDeviceFlow();
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-device-flow-start-result",
              ok: true,
              flow,
            };
          }
          if (req.type === "github-poll-device-flow") {
            pollCount++;
            const result = await authManager.pollDeviceFlowStep();
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-device-flow-poll-result",
              ok: true,
              result,
            };
          }
          if (req.type === "github-list-repositories") {
            return {
              schemaVersion: SCHEMA_VERSION,
              type: "github-repositories-result",
              ok: true,
              repositories: [],
            };
          }
          throw new Error(`Unexpected request: ${req.type}`);
        },
      );

    const user = userEvent.setup();
    render(<OptionsApp send={send} />);

    const connectBtn = await screen.findByRole("button", {
      name: "Connect GitHub",
    });
    await user.click(connectBtn);
    await user.click(
      screen.getByRole("button", {
        name: "I have installed it, Continue to Connect",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
    });

    // Wait for the poll to resolve and UI to reflect connected state
    await waitFor(
      () => {
        expect(screen.getByText("@octocat")).toBeInTheDocument();
      },
      { timeout: 4000 },
    );

    const pollsAtSuccess = pollCount;
    await new Promise((r) => setTimeout(r, 1500));
    expect(pollCount).toBe(pollsAtSuccess);
  });

  describe("1-Click GitHub App Install Flow and Banner", () => {
    it("prominently displays 1-click install action banner when connected with 0 repositories", async () => {
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
                  installationUrl: "https://github.com/apps/access-trace",
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
                repositories: [],
              };
            }
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      render(<OptionsApp send={send} />);

      await waitFor(() => {
        expect(screen.getByText("@octocat")).toBeInTheDocument();
      });

      // Verify the banner/card is prominently displayed
      const banner = await screen.findByLabelText(
        "Connect Repositories on GitHub",
      );
      expect(banner).toBeInTheDocument();
      expect(
        screen.getByText(
          "Connect Repositories on GitHub: Select which repositories Access Trace can report accessibility bugs to.",
        ),
      ).toBeInTheDocument();

      // Verify direct 1-click installation URL resolution appended /installations/new
      const installLinks = screen.getAllByRole("link", {
        name: "Install GitHub App",
      });
      expect(installLinks.length).toBeGreaterThanOrEqual(1);
      for (const link of installLinks) {
        expect(link).toHaveAttribute(
          "href",
          "https://github.com/apps/access-trace/installations/new",
        );
      }
    });

    it("falls back to https://github.com/settings/apps when installationUrl is not configured", async () => {
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
                  installationUrl: null,
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
                repositories: [],
              };
            }
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      render(<OptionsApp send={send} />);

      await waitFor(() => {
        expect(screen.getByText("@octocat")).toBeInTheDocument();
      });

      const installLinks = await screen.findAllByRole("link", {
        name: "Install GitHub App",
      });
      for (const link of installLinks) {
        expect(link).toHaveAttribute(
          "href",
          "https://github.com/settings/apps",
        );
      }
    });
  });

  describe("Auto-refresh on window focus / visibility change", () => {
    it("automatically triggers loadRepositories when window receives focus", async () => {
      let repoListCalls = 0;
      let returnedRepos = [
        {
          id: 101,
          owner: "acme",
          name: "initial-repo",
          fullName: "acme/initial-repo",
          htmlUrl: "https://github.com/acme/initial-repo",
          installationId: 10,
        },
      ];

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
              repoListCalls++;
              return {
                schemaVersion: SCHEMA_VERSION,
                type: "github-repositories-result",
                ok: true,
                repositories: returnedRepos,
              };
            }
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      render(<OptionsApp send={send} />);

      await waitFor(() => {
        expect(repoListCalls).toBe(1);
      });

      // Update repositories returned (simulating user installing app in another tab)
      returnedRepos = [
        {
          id: 101,
          owner: "acme",
          name: "initial-repo",
          fullName: "acme/initial-repo",
          htmlUrl: "https://github.com/acme/initial-repo",
          installationId: 10,
        },
        {
          id: 202,
          owner: "acme",
          name: "new-installed-repo",
          fullName: "acme/new-installed-repo",
          htmlUrl: "https://github.com/acme/new-installed-repo",
          installationId: 10,
        },
      ];

      // Simulate user switching back to Options window/tab
      window.dispatchEvent(new Event("focus"));

      await waitFor(() => {
        expect(repoListCalls).toBe(2);
      });

      // Also simulate document visibilitychange
      document.dispatchEvent(new Event("visibilitychange"));

      await waitFor(() => {
        expect(repoListCalls).toBe(3);
      });
    });

    it("does not trigger auto-refresh when document is hidden", async () => {
      let repoListCalls = 0;

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
              repoListCalls++;
              return {
                schemaVersion: SCHEMA_VERSION,
                type: "github-repositories-result",
                ok: true,
                repositories: [],
              };
            }
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      render(<OptionsApp send={send} />);

      await waitFor(() => {
        expect(repoListCalls).toBe(1);
      });

      // Mock visibilityState as hidden
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        configurable: true,
      });

      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));

      // Call count should NOT increase
      expect(repoListCalls).toBe(1);

      // Restore visibilityState to visible
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        configurable: true,
      });

      window.dispatchEvent(new Event("focus"));
      await waitFor(() => {
        expect(repoListCalls).toBe(2);
      });
    });
  });

  describe("Manual repository entry fallback in Domain Mapping", () => {
    it("allows toggling manual entry mode, validates input, and saves mapping", async () => {
      let savedMapping: unknown = null;

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
                repositories: [],
              };
            }
            if (req.type === "github-save-mapping") {
              savedMapping = req.mapping;
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
      render(
        <OptionsApp send={send} initialPrefillDomain="custom.example.com" />,
      );

      await waitFor(() => {
        expect(screen.getByText("@octocat")).toBeInTheDocument();
      });

      // The form is shown with domain prefilled
      expect(screen.getByLabelText("Exact domain")).toHaveValue(
        "custom.example.com",
      );

      // Since repositories is empty, we see the empty warning callout box with Enter Repository Manually
      const enterManualBtnInCallout = screen.getByRole("button", {
        name: "Enter Repository Manually",
      });
      expect(enterManualBtnInCallout).toBeInTheDocument();

      // Or toggle using the header link button
      const toggleBtn = screen.getByRole("button", {
        name: "Enter repository manually",
      });
      await user.click(toggleBtn);

      // Now manual text input is shown
      const manualInput = screen.getByPlaceholderText(
        "owner/repo (e.g. acme/web-app)",
      );
      expect(manualInput).toBeInTheDocument();

      // Toggle button text should update
      expect(
        screen.getByRole("button", {
          name: "Choose from accessible repositories",
        }),
      ).toBeInTheDocument();

      // Attempt saving with invalid format
      await user.type(manualInput, "invalid-repo-format");
      const saveBtn = screen.getByRole("button", { name: "Save mapping" });
      await user.click(saveBtn);

      expect(
        screen.getByText(
          "Repository must be in owner/repo format (e.g. acme/web-app).",
        ),
      ).toBeInTheDocument();

      // Fix format
      await user.clear(manualInput);
      await user.type(manualInput, "myorg/custom-service");
      await user.click(saveBtn);

      await waitFor(() => {
        expect(send).toHaveBeenCalledWith(
          expect.objectContaining({
            type: "github-save-mapping",
            mapping: expect.objectContaining({
              domainKey: "custom.example.com",
              repository: expect.objectContaining({
                owner: "myorg",
                name: "custom-service",
                fullName: "myorg/custom-service",
                htmlUrl: "https://github.com/myorg/custom-service",
              }),
            }),
          }),
        );
      });

      expect(savedMapping).toMatchObject({
        domainKey: "custom.example.com",
        repository: {
          owner: "myorg",
          name: "custom-service",
          fullName: "myorg/custom-service",
          htmlUrl: "https://github.com/myorg/custom-service",
        },
      });
    });

    it("allows switching back to accessible repositories list from manual mode", async () => {
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
                    id: 501,
                    owner: "myteam",
                    name: "portal",
                    fullName: "myteam/portal",
                    htmlUrl: "https://github.com/myteam/portal",
                    installationId: 44,
                  },
                ],
              };
            }
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      const user = userEvent.setup();
      render(<OptionsApp send={send} initialPrefillDomain="portal.com" />);

      await waitFor(() => {
        expect(screen.getByText("myteam/portal")).toBeInTheDocument();
      });

      // Switch to manual mode
      const toggleManual = screen.getByRole("button", {
        name: "Enter repository manually",
      });
      await user.click(toggleManual);

      expect(
        screen.getByPlaceholderText("owner/repo (e.g. acme/web-app)"),
      ).toBeInTheDocument();

      // Switch back to select list
      const toggleSelect = screen.getByRole("button", {
        name: "Choose from accessible repositories",
      });
      await user.click(toggleSelect);

      expect(screen.getByLabelText("GitHub repository")).toBeInstanceOf(
        HTMLSelectElement,
      );
    });
  });

  describe("Onboarding sequence and pre-connection confirmation dialog", () => {
    it("renders Install GitHub App as primary call to action and Connect GitHub indicating prerequisite installation", async () => {
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
                  state: "disconnected",
                  user: null,
                  expiresAt: null,
                  error: null,
                  installationUrl: "https://github.com/apps/access-trace",
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
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      render(<OptionsApp send={send} />);

      const installLink = await screen.findByRole("link", {
        name: "Install GitHub App",
      });
      expect(installLink).toBeInTheDocument();
      expect(installLink).toHaveClass("primary");
      expect(installLink).toHaveAttribute(
        "href",
        "https://github.com/apps/access-trace/installations/new",
      );
      expect(installLink).toHaveAttribute("target", "_blank");
      expect(installLink).toHaveAttribute("rel", "noreferrer");

      expect(
        screen.getByText(
          /Repository access must be granted on GitHub before connecting/i,
        ),
      ).toBeInTheDocument();

      const connectBtn = screen.getByRole("button", {
        name: "Connect GitHub",
      });
      expect(connectBtn).toBeInTheDocument();
      expect(connectBtn).toHaveClass("secondary");
      expect(
        screen.getByText(/Already installed\? Connect GitHub/i),
      ).toBeInTheDocument();

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("opens confirmation dialog explaining 401 installation requirement when clicking Connect GitHub", async () => {
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
                  state: "disconnected",
                  user: null,
                  expiresAt: null,
                  error: null,
                  installationUrl: "https://github.com/apps/access-trace",
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
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      const user = userEvent.setup();
      render(<OptionsApp send={send} />);

      const connectBtn = await screen.findByRole("button", {
        name: "Connect GitHub",
      });
      await user.click(connectBtn);

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(dialog).toHaveAttribute("aria-modal", "true");
      expect(dialog).toHaveAttribute(
        "aria-labelledby",
        "confirm-install-dialog-title",
      );
      expect(dialog).toHaveAttribute(
        "aria-describedby",
        "confirm-install-dialog-desc",
      );

      expect(
        screen.getByRole("heading", {
          name: "Install GitHub App Before Connecting",
        }),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          "You must install the GitHub App on your personal account or organization with repository access before authorizing. Authorizing before installation causes GitHub to reject requests with a 401 Unauthorized error.",
        ),
      ).toBeInTheDocument();

      const dialogInstallLink = screen.getAllByRole("link", {
        name: "Install GitHub App",
      })[1];
      expect(dialogInstallLink).toHaveAttribute(
        "href",
        "https://github.com/apps/access-trace/installations/new",
      );
      expect(dialogInstallLink).toHaveAttribute("target", "_blank");
      expect(dialogInstallLink).toHaveAttribute("rel", "noreferrer");

      expect(
        screen.getByRole("button", {
          name: "I have installed it, Continue to Connect",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument();

      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("proceeds to device flow when confirming inside the dialog", async () => {
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
                  state: "disconnected",
                  user: null,
                  expiresAt: null,
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
            if (req.type === "github-start-device-flow") {
              return {
                schemaVersion: SCHEMA_VERSION,
                type: "github-device-flow-start-result",
                ok: true,
                flow: {
                  userCode: "ABCD-1234",
                  verificationUri: "https://github.com/login/device",
                  expiresIn: 900,
                  interval: 5,
                },
              };
            }
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      const user = userEvent.setup();
      render(<OptionsApp send={send} />);

      const connectBtn = await screen.findByRole("button", {
        name: "Connect GitHub",
      });
      await user.click(connectBtn);

      const confirmBtn = screen.getByRole("button", {
        name: "I have installed it, Continue to Connect",
      });
      await user.click(confirmBtn);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "github-start-device-flow",
        }),
      );

      await waitFor(() => {
        expect(screen.getByText("ABCD-1234")).toBeInTheDocument();
      });
      expect(
        screen.getByRole("link", { name: "Open GitHub Verification Page" }),
      ).toHaveAttribute("href", "https://github.com/login/device");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps user on disconnected view without starting device flow when canceled", async () => {
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
                  state: "disconnected",
                  user: null,
                  expiresAt: null,
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
            throw new Error(`Unexpected request: ${req.type}`);
          },
        );

      const user = userEvent.setup();
      render(<OptionsApp send={send} />);

      const connectBtn = await screen.findByRole("button", {
        name: "Connect GitHub",
      });
      await user.click(connectBtn);

      expect(screen.getByRole("dialog")).toBeInTheDocument();

      const cancelBtn = screen.getByRole("button", { name: "Cancel" });
      await user.click(cancelBtn);

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(send).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "github-start-device-flow",
        }),
      );
      expect(
        screen.getByRole("button", { name: "Connect GitHub" }),
      ).toBeInTheDocument();
    });

    it("clicking Disconnect GitHub removes credentials and resets the view back to onboarding", async () => {
      let connectionState: "connected" | "disconnected" = "connected";
      const send = vi
        .fn()
        .mockImplementation(
          async (req: ExtensionRequest): Promise<ExtensionResponse> => {
            if (req.type === "github-get-state") {
              if (connectionState === "connected") {
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
              return {
                schemaVersion: SCHEMA_VERSION,
                type: "github-state-result",
                ok: true,
                connection: {
                  schemaVersion: "1.0",
                  state: "disconnected",
                  user: null,
                  expiresAt: null,
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
            if (req.type === "github-disconnect") {
              connectionState = "disconnected";
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
      render(<OptionsApp send={send} />);

      await waitFor(() => {
        expect(screen.getByText("@octocat")).toBeInTheDocument();
      });

      const disconnectBtn = screen.getByRole("button", {
        name: "Disconnect GitHub",
      });
      expect(disconnectBtn).toBeInTheDocument();

      await user.click(disconnectBtn);

      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "github-disconnect",
        }),
      );

      await waitFor(() => {
        expect(
          screen.getByRole("link", { name: "Install GitHub App" }),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("button", { name: "Connect GitHub" }),
        ).toBeInTheDocument();
      });
      expect(screen.queryByText("@octocat")).not.toBeInTheDocument();
    });

    it("displays Disconnect GitHub in error state and calls handleDisconnect", async () => {
      let stateToReturn: "error" | "disconnected" = "error";

      const send = vi
        .fn()
        .mockImplementation(
          async (req: ExtensionRequest): Promise<ExtensionResponse> => {
            if (req.type === "github-get-state") {
              if (stateToReturn === "error") {
                return {
                  schemaVersion: SCHEMA_VERSION,
                  type: "github-state-result",
                  ok: true,
                  connection: {
                    schemaVersion: "1.0",
                    state: "error",
                    user: null,
                    expiresAt: null,
                    error: {
                      code: "unauthorized",
                      message: "Bad credentials or installation missing",
                    },
                  },
                  permissionGranted: true,
                };
              }
              return {
                schemaVersion: SCHEMA_VERSION,
                type: "github-state-result",
                ok: true,
                connection: {
                  schemaVersion: "1.0",
                  state: "disconnected",
                  user: null,
                  expiresAt: null,
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
            if (req.type === "github-disconnect") {
              stateToReturn = "disconnected";
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
      render(<OptionsApp send={send} />);

      await waitFor(() => {
        expect(
          screen.getByText("Bad credentials or installation missing"),
        ).toBeInTheDocument();
      });

      const disconnectBtn = screen.getByRole("button", {
        name: "Disconnect GitHub",
      });
      expect(disconnectBtn).toBeInTheDocument();

      await user.click(disconnectBtn);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "github-disconnect",
        }),
      );

      await waitFor(() => {
        expect(
          screen.queryByText("Bad credentials or installation missing"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole("link", { name: "Install GitHub App" }),
        ).toBeInTheDocument();
      });
    });

    it("displays Disconnect GitHub in expired state and calls handleDisconnect", async () => {
      let stateToReturn: "expired" | "disconnected" = "expired";

      const send = vi
        .fn()
        .mockImplementation(
          async (req: ExtensionRequest): Promise<ExtensionResponse> => {
            if (req.type === "github-get-state") {
              if (stateToReturn === "expired") {
                return {
                  schemaVersion: SCHEMA_VERSION,
                  type: "github-state-result",
                  ok: true,
                  connection: {
                    schemaVersion: "1.0",
                    state: "expired",
                    user: null,
                    expiresAt: null,
                    error: null,
                  },
                  permissionGranted: true,
                };
              }
              return {
                schemaVersion: SCHEMA_VERSION,
                type: "github-state-result",
                ok: true,
                connection: {
                  schemaVersion: "1.0",
                  state: "disconnected",
                  user: null,
                  expiresAt: null,
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
            if (req.type === "github-disconnect") {
              stateToReturn = "disconnected";
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
      render(<OptionsApp send={send} />);

      const reconnectBtn = await screen.findByRole("button", {
        name: "Reconnect GitHub",
      });
      expect(reconnectBtn).toBeInTheDocument();

      const disconnectBtn = screen.getByRole("button", {
        name: "Disconnect GitHub",
      });
      expect(disconnectBtn).toBeInTheDocument();

      await user.click(disconnectBtn);
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "github-disconnect",
        }),
      );

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: "Reconnect GitHub" }),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole("link", { name: "Install GitHub App" }),
        ).toBeInTheDocument();
      });
    });
  });
});

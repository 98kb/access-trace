import { describe, expect, it, vi, beforeEach } from "vitest";
import { GitHubAuthManager } from "../../src/github/auth";
import type { GitHubAppConfig } from "../../src/github/config";

describe("GitHub Device Flow and Auth Manager", () => {
  const config: GitHubAppConfig = {
    clientId: "test-client-id",
    installationUrl: "https://github.com/apps/test-app",
  };

  let mockStorage: Record<string, unknown>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockStorage = {};
    mockFetch = vi.fn();
  });

  const createManager = (fetchImpl = mockFetch) => {
    return new GitHubAuthManager({
      config,
      fetch: fetchImpl as unknown as typeof fetch,
      storage: {
        get: async (key: string) => mockStorage[key],
        set: async (key: string, value: unknown) => {
          mockStorage[key] = value;
        },
        remove: async (key: string) => {
          delete mockStorage[key];
        },
      },
    });
  };

  it("returns not-configured view when config is null", async () => {
    const manager = new GitHubAuthManager({
      config: null,
      fetch: mockFetch as unknown as typeof fetch,
      storage: {
        get: async () => undefined,
        set: async () => {},
        remove: async () => {},
      },
    });
    const view = await manager.getConnectionView();
    expect(view.state).toBe("not-configured");
    expect(view.user).toBeNull();
  });

  it("starts device authorization flow", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: "dev_12345",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });

    const manager = createManager();
    const flow = await manager.startDeviceFlow();

    expect(flow).toEqual({
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresIn: 900,
      interval: 5,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://github.com/login/device/code",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Accept: "application/json",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ client_id: "test-client-id", scope: "" }),
      }),
    );
  });

  it("handles device flow polling success and validates user profile", async () => {
    // 1. Device code request
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: "dev_12345",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });

    const manager = createManager();
    await manager.startDeviceFlow();

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

    // Step poll once
    const pollResult1 = await manager.pollDeviceFlowStep();
    expect(pollResult1.status).toBe("pending");
    expect(pollResult1.nextIntervalSec).toBe(5);

    // Step poll second time
    const pollResult2 = await manager.pollDeviceFlowStep();
    expect(pollResult2.status).toBe("success");

    const view = await manager.getConnectionView();
    expect(view.state).toBe("connected");
    expect(view.user).toEqual({
      id: 99,
      login: "octocat",
      name: "Monalisa Octocat",
      avatarUrl: "https://github.com/avatar.png",
    });

    // Credentials stored internally
    const storedCred = mockStorage[
      "github-credentials:v1"
    ] as unknown as Record<string, unknown>;
    expect(storedCred["accessToken"]).toBe("ghu_access_token_123");
    // Ensure access token NEVER exposed in view
    expect("accessToken" in view).toBe(false);
  });

  it("handles slow_down by adding 5 seconds to polling interval", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        device_code: "dev_12345",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
    });

    const manager = createManager();
    await manager.startDeviceFlow();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: "slow_down" }),
    });

    const pollResult = await manager.pollDeviceFlowStep();
    expect(pollResult.status).toBe("pending");
    expect(pollResult.nextIntervalSec).toBe(10); // 5 + 5
  });

  it("serializes token refresh and rotates credentials atomically", async () => {
    const manager = createManager();

    // Setup near-expiry stored credential
    mockStorage["github-credentials:v1"] = {
      schemaVersion: "1.0",
      accessToken: "ghu_old_access",
      accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), // expired
      refreshToken: "ghr_old_refresh",
      refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      tokenType: "bearer",
      userId: 99,
      userLogin: "octocat",
      updatedAt: new Date().toISOString(),
    };

    // Refresh response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "ghu_new_access",
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "ghr_new_refresh",
        refresh_token_expires_in: 15768000,
      }),
    });

    // Trigger concurrent token requests
    const [t1, t2] = await Promise.all([
      manager.getValidAccessToken(),
      manager.getValidAccessToken(),
    ]);

    expect(t1).toBe("ghu_new_access");
    expect(t2).toBe("ghu_new_access");
    expect(mockFetch).toHaveBeenCalledTimes(1); // Only refreshed once!

    const storedCred = mockStorage[
      "github-credentials:v1"
    ] as unknown as Record<string, unknown>;
    expect(storedCred.accessToken).toBe("ghu_new_access");
    expect(storedCred.refreshToken).toBe("ghr_new_refresh");
  });

  it("clears credentials and sets expired state on unrecoverable auth failure", async () => {
    const manager = createManager();

    // Setup expired refresh token
    mockStorage["github-credentials:v1"] = {
      schemaVersion: "1.0",
      accessToken: "ghu_old_access",
      accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(),
      refreshToken: "ghr_expired_refresh",
      refreshTokenExpiresAt: new Date(Date.now() - 5000).toISOString(),
      tokenType: "bearer",
      userId: 99,
      userLogin: "octocat",
      updatedAt: new Date().toISOString(),
    };

    const token = await manager.getValidAccessToken();
    expect(token).toBeNull();

    const view = await manager.getConnectionView();
    expect(view.state).toBe("expired");
    expect(view.user?.login).toBe("octocat");
  });

  it("disconnects and clears non-sensitive identity cache while retaining domain mappings", async () => {
    const manager = createManager();
    mockStorage["github-credentials:v1"] = {
      schemaVersion: "1.0",
      accessToken: "ghu_access",
      accessTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      refreshToken: "ghr_refresh",
      refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      tokenType: "bearer",
      userId: 99,
      userLogin: "octocat",
      updatedAt: new Date().toISOString(),
    };
    mockStorage["github-domain-mappings:v1"] = [{ domainKey: "example.com" }];

    await manager.disconnect();

    expect(mockStorage["github-credentials:v1"]).toBeUndefined();
    expect(mockStorage["github-domain-mappings:v1"]).toBeDefined(); // Retained
    const view = await manager.getConnectionView();
    expect(view.state).toBe("disconnected");
  });
});

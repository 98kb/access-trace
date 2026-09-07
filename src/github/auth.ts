import { resolveGitHubInstallationUrl, type GitHubAppConfig } from "./config";
export { resolveGitHubInstallationUrl };
import {
  GITHUB_SCHEMA_VERSION,
  parseGitHubCredential,
  type DeviceFlowCodeResponse,
  type GitHubConnectionViewV1,
  type GitHubCredentialV1,
  type GitHubUserV1,
} from "./contracts";

export interface SimpleStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface GitHubAuthManagerOptions {
  config: GitHubAppConfig | null;
  storage: SimpleStorage;
  fetch?: typeof fetch;
}

export interface DevicePollResult {
  status: "pending" | "success" | "expired" | "denied" | "error";
  nextIntervalSec?: number;
  error?: { code: string; message: string };
}

const CREDENTIAL_STORAGE_KEY = "github-credentials:v1";
const API_VERSION = "2022-11-28";
const BUFFER_EXPIRY_MS = 60 * 1000; // 60 seconds buffer before expiry

export class GitHubAuthManager {
  private config: GitHubAppConfig | null;
  private storage: SimpleStorage;
  private fetchImpl: typeof fetch;

  private activeDeviceCode: string | null = null;
  private activeIntervalSec: number = 5;
  private activeExpiresAtMs: number = 0;
  private connectingState: boolean = false;
  private refreshPromise: Promise<string | null> | null = null;

  constructor(options: GitHubAuthManagerOptions) {
    this.config = options.config;
    this.storage = options.storage;
    this.fetchImpl = (options.fetch ?? globalThis.fetch).bind(globalThis);
  }

  public updateConfig(config: GitHubAppConfig | null): void {
    this.config = config;
  }

  /**
   * Returns non-sensitive connection state exposed to options and side panel.
   * NEVER includes access/refresh tokens.
   */
  async getConnectionView(): Promise<GitHubConnectionViewV1> {
    if (!this.config) {
      return {
        schemaVersion: GITHUB_SCHEMA_VERSION,
        state: "not-configured",
        user: null,
        expiresAt: null,
        error: {
          code: "not-configured",
          message: "GitHub App client ID is not configured in this build.",
        },
      };
    }

    const installationUrl = this.config.installationUrl
      ? resolveGitHubInstallationUrl(this.config.installationUrl)
      : null;

    if (this.connectingState) {
      return {
        schemaVersion: GITHUB_SCHEMA_VERSION,
        state: "connecting",
        user: null,
        expiresAt: this.activeExpiresAtMs
          ? new Date(this.activeExpiresAtMs).toISOString()
          : null,
        error: null,
        installationUrl,
      };
    }

    const cred = await this.readCredential();
    if (!cred) {
      return {
        schemaVersion: GITHUB_SCHEMA_VERSION,
        state: "disconnected",
        user: null,
        expiresAt: null,
        error: null,
        installationUrl,
      };
    }

    // Check if refresh token is expired
    if (
      cred.refreshTokenExpiresAt &&
      new Date(cred.refreshTokenExpiresAt).getTime() <= Date.now()
    ) {
      await this.clearCredentials();
      return {
        schemaVersion: GITHUB_SCHEMA_VERSION,
        state: "expired",
        user: {
          id: cred.userId,
          login: cred.userLogin,
          ...(cred.userName ? { name: cred.userName } : {}),
          ...(cred.userAvatarUrl ? { avatarUrl: cred.userAvatarUrl } : {}),
        },
        expiresAt: cred.accessTokenExpiresAt ?? null,
        error: {
          code: "token-expired",
          message:
            "Authorization expired. Please reconnect your GitHub account.",
        },
        installationUrl,
      };
    }

    const user: GitHubUserV1 = {
      id: cred.userId,
      login: cred.userLogin,
      ...(cred.userName ? { name: cred.userName } : {}),
      ...(cred.userAvatarUrl ? { avatarUrl: cred.userAvatarUrl } : {}),
    };

    return {
      schemaVersion: GITHUB_SCHEMA_VERSION,
      state: "connected",
      user,
      expiresAt: cred.accessTokenExpiresAt ?? null,
      error: null,
      installationUrl,
    };
  }

  /**
   * Starts GitHub App device flow.
   * Step 2 of device authorization: POST https://github.com/login/device/code
   */
  async startDeviceFlow(): Promise<DeviceFlowCodeResponse> {
    if (!this.config) {
      throw new Error("GitHub App client ID is missing.");
    }

    const res = await this.fetchImpl("https://github.com/login/device/code", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        scope: "",
      }),
    });

    if (!res.ok) {
      throw new Error(`Device code request failed with status ${res.status}`);
    }

    const data = (await res.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval?: number;
    };

    if (!data.device_code || !data.user_code || !data.verification_uri) {
      throw new Error("Invalid device code response from GitHub");
    }

    this.activeDeviceCode = data.device_code;
    this.activeIntervalSec = data.interval ?? 5;
    this.activeExpiresAtMs = Date.now() + (data.expires_in ?? 900) * 1000;
    this.connectingState = true;

    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in ?? 900,
      interval: this.activeIntervalSec,
    };
  }

  /**
   * Cancels active device authorization flow.
   */
  cancelDeviceFlow(): void {
    this.activeDeviceCode = null;
    this.connectingState = false;
  }

  /**
   * Performs a single polling step for device flow authorization.
   */
  async pollDeviceFlowStep(): Promise<DevicePollResult> {
    if (!this.config || !this.activeDeviceCode) {
      return {
        status: "error",
        error: {
          code: "no-flow",
          message: "No device authorization flow is active.",
        },
      };
    }

    if (Date.now() >= this.activeExpiresAtMs) {
      this.cancelDeviceFlow();
      return {
        status: "expired",
        error: {
          code: "expired_token",
          message: "The device code has expired.",
        },
      };
    }

    let res: Response;
    try {
      res = await this.fetchImpl(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: this.config.clientId,
            device_code: this.activeDeviceCode,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          }),
        },
      );
    } catch (fetchErr) {
      this.cancelDeviceFlow();
      return {
        status: "error",
        error: {
          code: "network_error",
          message:
            fetchErr instanceof Error
              ? fetchErr.message
              : "Failed to connect to GitHub token endpoint.",
        },
      };
    }

    if (!res.ok) {
      this.cancelDeviceFlow();
      return {
        status: "error",
        error: { code: "http_failure", message: `HTTP error ${res.status}` },
      };
    }

    let data: {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      refresh_token?: string;
      refresh_token_expires_in?: number;
      error?: string;
      error_description?: string;
      interval?: number;
    };

    try {
      data = (await res.json()) as typeof data;
    } catch {
      this.cancelDeviceFlow();
      return {
        status: "error",
        error: {
          code: "invalid_json",
          message: "GitHub token endpoint returned invalid JSON.",
        },
      };
    }

    if (data.error) {
      if (data.error === "authorization_pending") {
        return {
          status: "pending",
          nextIntervalSec: this.activeIntervalSec,
        };
      }
      if (data.error === "slow_down") {
        this.activeIntervalSec = (data.interval ?? this.activeIntervalSec) + 5;
        return {
          status: "pending",
          nextIntervalSec: this.activeIntervalSec,
        };
      }
      if (data.error === "access_denied") {
        this.cancelDeviceFlow();
        return {
          status: "denied",
          error: {
            code: "access_denied",
            message: "User denied authorization.",
          },
        };
      }
      if (data.error === "expired_token") {
        this.cancelDeviceFlow();
        return {
          status: "expired",
          error: { code: "expired_token", message: "Device code expired." },
        };
      }
      this.cancelDeviceFlow();
      return {
        status: "error",
        error: {
          code: data.error,
          message: data.error_description ?? "Device authorization failed.",
        },
      };
    }

    if (!data.access_token) {
      this.cancelDeviceFlow();
      return {
        status: "error",
        error: {
          code: "invalid_response",
          message: "Access token missing from GitHub OAuth response.",
        },
      };
    }

    // Authorization successful! Fetch user details using access_token.
    try {
      const userProfile = await this.fetchUserProfile(data.access_token);
      const now = Date.now();
      const cred: GitHubCredentialV1 = {
        schemaVersion: GITHUB_SCHEMA_VERSION,
        accessToken: data.access_token,
        ...(data.expires_in !== undefined
          ? {
              accessTokenExpiresAt: new Date(
                now + data.expires_in * 1000,
              ).toISOString(),
            }
          : {}),
        ...(data.refresh_token
          ? {
              refreshToken: data.refresh_token,
              refreshTokenExpiresAt: new Date(
                now + (data.refresh_token_expires_in ?? 15768000) * 1000,
              ).toISOString(),
            }
          : {}),
        tokenType: data.token_type ?? "bearer",
        userId: userProfile.id,
        userLogin: userProfile.login,
        ...(userProfile.name ? { userName: userProfile.name } : {}),
        ...(userProfile.avatar_url
          ? { userAvatarUrl: userProfile.avatar_url }
          : {}),
        updatedAt: new Date(now).toISOString(),
      };

      await this.storage.set(CREDENTIAL_STORAGE_KEY, cred);
      this.cancelDeviceFlow();
      return { status: "success" };
    } catch (err) {
      this.cancelDeviceFlow();
      return {
        status: "error",
        error: {
          code: "user_fetch_failed",
          message:
            err instanceof Error
              ? err.message
              : "Failed to fetch user profile.",
        },
      };
    }
  }

  /**
   * Retrieves a valid access token.
   * If token is missing, expired, or near expiry, handles automatic refresh.
   */
  async getValidAccessToken(): Promise<string | null> {
    const cred = await this.readCredential();
    if (!cred) return null;

    const now = Date.now();

    if (
      cred.refreshTokenExpiresAt &&
      now >= new Date(cred.refreshTokenExpiresAt).getTime()
    ) {
      return null;
    }

    if (!cred.accessTokenExpiresAt) {
      return cred.accessToken;
    }

    const accessExpiry = new Date(cred.accessTokenExpiresAt).getTime();

    // If access token is still fresh, return it
    if (now + BUFFER_EXPIRY_MS < accessExpiry) {
      return cred.accessToken;
    }

    if (!cred.refreshToken) {
      return null;
    }

    // Otherwise, perform serialized refresh
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh(cred);
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  /**
   * Performs token refresh grant.
   */
  private async performTokenRefresh(
    cred: GitHubCredentialV1,
  ): Promise<string | null> {
    if (!this.config || !cred.refreshToken) return null;

    try {
      const res = await this.fetchImpl(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            client_id: this.config.clientId,
            grant_type: "refresh_token",
            refresh_token: cred.refreshToken,
          }),
        },
      );

      if (!res.ok) {
        return null;
      }

      const data = (await res.json()) as {
        access_token?: string;
        token_type?: string;
        expires_in?: number;
        refresh_token?: string;
        refresh_token_expires_in?: number;
        error?: string;
      };

      if (data.error || !data.access_token) {
        return null;
      }

      const now = Date.now();
      const updatedCred: GitHubCredentialV1 = {
        ...cred,
        accessToken: data.access_token,
        ...(data.expires_in !== undefined
          ? {
              accessTokenExpiresAt: new Date(
                now + data.expires_in * 1000,
              ).toISOString(),
            }
          : {}),
        ...(data.refresh_token
          ? {
              refreshToken: data.refresh_token,
              refreshTokenExpiresAt: new Date(
                now + (data.refresh_token_expires_in ?? 15768000) * 1000,
              ).toISOString(),
            }
          : {}),
        tokenType: data.token_type ?? "bearer",
        updatedAt: new Date(now).toISOString(),
      };

      await this.storage.set(CREDENTIAL_STORAGE_KEY, updatedCred);
      return updatedCred.accessToken;
    } catch {
      await this.clearCredentials();
      return null;
    }
  }

  /**
   * Fetches user profile from GitHub API.
   */
  private async fetchUserProfile(token: string): Promise<{
    id: number;
    login: string;
    name?: string;
    avatar_url?: string;
  }> {
    const res = await this.fetchImpl("https://api.github.com/user", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch GitHub user: HTTP ${res.status}`);
    }

    return (await res.json()) as {
      id: number;
      login: string;
      name?: string;
      avatar_url?: string;
    };
  }

  /**
   * Clears stored credentials (disconnects user).
   * Retains domain mappings.
   */
  async disconnect(): Promise<void> {
    this.cancelDeviceFlow();
    await this.clearCredentials();
  }

  private async readCredential(): Promise<GitHubCredentialV1 | null> {
    try {
      const stored = await this.storage.get(CREDENTIAL_STORAGE_KEY);
      if (!stored) return null;
      return parseGitHubCredential(stored);
    } catch {
      await this.clearCredentials();
      return null;
    }
  }

  private async clearCredentials(): Promise<void> {
    await this.storage.remove(CREDENTIAL_STORAGE_KEY);
  }
}

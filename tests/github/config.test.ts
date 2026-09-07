import { describe, expect, it, vi } from "vitest";
import {
  getGitHubAppConfig,
  resolveGitHubInstallationUrl,
} from "../../src/github/config";

describe("GitHub App public configuration", () => {
  it("returns null when VITE_GITHUB_APP_CLIENT_ID is missing or empty", () => {
    vi.stubEnv("VITE_GITHUB_APP_CLIENT_ID", "");
    expect(getGitHubAppConfig()).toBeNull();
  });

  it("returns config object when VITE_GITHUB_APP_CLIENT_ID is present", () => {
    vi.stubEnv("VITE_GITHUB_APP_CLIENT_ID", "Iv1.1234567890abcdef");
    vi.stubEnv(
      "VITE_GITHUB_APP_INSTALLATION_URL",
      "https://github.com/apps/my-app/installations/new",
    );
    expect(getGitHubAppConfig()).toEqual({
      clientId: "Iv1.1234567890abcdef",
      installationUrl: "https://github.com/apps/my-app/installations/new",
    });
  });

  it("normalizes installation URL in getGitHubAppConfig when /installations/new is omitted", () => {
    vi.stubEnv("VITE_GITHUB_APP_CLIENT_ID", "Iv1.1234567890abcdef");
    vi.stubEnv(
      "VITE_GITHUB_APP_INSTALLATION_URL",
      "https://github.com/apps/access-trace",
    );
    expect(getGitHubAppConfig()).toEqual({
      clientId: "Iv1.1234567890abcdef",
      installationUrl: "https://github.com/apps/access-trace/installations/new",
    });
  });

  describe("resolveGitHubInstallationUrl", () => {
    it("falls back to https://github.com/settings/apps when undefined, null, or empty", () => {
      expect(resolveGitHubInstallationUrl(undefined)).toBe(
        "https://github.com/settings/apps",
      );
      expect(resolveGitHubInstallationUrl(null)).toBe(
        "https://github.com/settings/apps",
      );
      expect(resolveGitHubInstallationUrl("")).toBe(
        "https://github.com/settings/apps",
      );
      expect(resolveGitHubInstallationUrl("   ")).toBe(
        "https://github.com/settings/apps",
      );
    });

    it("appends /installations/new when not present", () => {
      expect(
        resolveGitHubInstallationUrl("https://github.com/apps/access-trace"),
      ).toBe("https://github.com/apps/access-trace/installations/new");
      expect(
        resolveGitHubInstallationUrl("https://github.com/apps/access-trace/"),
      ).toBe("https://github.com/apps/access-trace/installations/new");
    });

    it("does not duplicate /installations/new if already present", () => {
      expect(
        resolveGitHubInstallationUrl(
          "https://github.com/apps/access-trace/installations/new",
        ),
      ).toBe("https://github.com/apps/access-trace/installations/new");
      expect(
        resolveGitHubInstallationUrl(
          "https://github.com/apps/access-trace/installations/new/",
        ),
      ).toBe("https://github.com/apps/access-trace/installations/new");
    });

    it("falls back cleanly when configured with settings/apps", () => {
      expect(
        resolveGitHubInstallationUrl("https://github.com/settings/apps"),
      ).toBe("https://github.com/settings/apps");
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { getGitHubAppConfig } from "../../src/github/config";

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
});

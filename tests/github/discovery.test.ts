import { describe, expect, it, vi } from "vitest";
import { GitHubDiscoveryClient } from "../../src/github/discovery";

describe("GitHub Discovery Client", () => {
  it("lists accessible repositories across installations", async () => {
    const mockFetch = vi.fn();

    // GET /user/installations
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        installations: [{ id: 101, account: { login: "acme-corp" } }],
      }),
    });

    // GET /user/installations/101/repositories
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        repositories: [
          {
            id: 501,
            name: "web-app",
            full_name: "acme-corp/web-app",
            html_url: "https://github.com/acme-corp/web-app",
            owner: { login: "acme-corp" },
          },
        ],
      }),
    });

    const client = new GitHubDiscoveryClient(
      mockFetch as unknown as typeof fetch,
    );
    const repos = await client.listAccessibleRepositories("ghu_token_123");

    expect(repos).toEqual([
      {
        id: 501,
        owner: "acme-corp",
        name: "web-app",
        fullName: "acme-corp/web-app",
        htmlUrl: "https://github.com/acme-corp/web-app",
        installationId: 101,
      },
    ]);
  });

  it("lists repository labels", async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 1, name: "accessibility", color: "d4c5f9" },
        { id: 2, name: "bug", color: "d73a4a" },
      ],
    });

    const client = new GitHubDiscoveryClient(
      mockFetch as unknown as typeof fetch,
    );
    const labels = await client.listRepositoryLabels(
      "ghu_token_123",
      "acme-corp",
      "web-app",
    );

    expect(labels).toEqual([
      { id: 1, name: "accessibility", color: "d4c5f9" },
      { id: 2, name: "bug", color: "d73a4a" },
    ]);
  });
});

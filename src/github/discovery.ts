import type { GitHubLabelV1, GitHubRepositoryV1 } from "./contracts";

const API_VERSION = "2022-11-28";

export class GitHubDiscoveryClient {
  private fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = (fetchImpl ?? globalThis.fetch).bind(globalThis);
  }

  /**
   * Discovers all repositories accessible to both the GitHub App installation and the authenticated user.
   */
  async listAccessibleRepositories(
    accessToken: string,
  ): Promise<GitHubRepositoryV1[]> {
    // 1. GET /user/installations
    const instRes = await this.fetchImpl(
      "https://api.github.com/user/installations?per_page=100",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": API_VERSION,
        },
      },
    );

    if (!instRes.ok) {
      throw new Error(`Failed to list installations: HTTP ${instRes.status}`);
    }

    const instData = (await instRes.json()) as {
      installations?: Array<{ id: number; account?: { login?: string } }>;
    };

    const installations = instData.installations ?? [];
    const allRepos: GitHubRepositoryV1[] = [];

    // 2. Fetch repos for each installation
    for (const inst of installations) {
      const repoRes = await this.fetchImpl(
        `https://api.github.com/user/installations/${inst.id}/repositories?per_page=100`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": API_VERSION,
          },
        },
      );

      if (!repoRes.ok) continue;

      const repoData = (await repoRes.json()) as {
        repositories?: Array<{
          id: number;
          name: string;
          full_name: string;
          html_url: string;
          owner?: { login?: string };
        }>;
      };

      const repos = repoData.repositories ?? [];
      for (const repo of repos) {
        allRepos.push({
          id: repo.id,
          owner: repo.owner?.login ?? "",
          name: repo.name,
          fullName: repo.full_name,
          htmlUrl: repo.html_url,
          installationId: inst.id,
        });
      }
    }

    return allRepos;
  }

  /**
   * Lists labels for a given repository.
   */
  async listRepositoryLabels(
    accessToken: string,
    owner: string,
    repo: string,
  ): Promise<GitHubLabelV1[]> {
    const res = await this.fetchImpl(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/labels?per_page=100`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": API_VERSION,
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Failed to list labels: HTTP ${res.status}`);
    }

    const data = (await res.json()) as Array<{
      id: number;
      name: string;
      color: string;
    }>;

    return (data ?? []).map((lbl) => ({
      id: lbl.id,
      name: lbl.name,
      color: lbl.color,
    }));
  }
}

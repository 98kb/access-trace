import type { FindingV1 } from "../contracts";
import type { SimpleStorage } from "./auth";
import type {
  DomainRepositoryMappingV1,
  GitHubIssueRecordV1,
} from "./contracts";
import { computeFindingFingerprint } from "./fingerprint";
import { buildGitHubIssuePayload } from "./payload";

const RECORDS_STORAGE_KEY = "github-issue-records:v1";
const MAX_RECORDS = 500;
const API_VERSION = "2022-11-28";

export interface CreateIssueOptions {
  accessToken: string;
  mapping: DomainRepositoryMappingV1;
  finding: FindingV1;
  pageUrl: string;
  scannerInfo: { name: string; version: string };
  operationId: string;
}

export type GitHubIssueResult =
  | {
      ok: true;
      issueNumber: number;
      htmlUrl: string;
      labelMissing: boolean;
    }
  | {
      ok: false;
      ambiguous: boolean;
      error: { code: string; message: string };
    };

export class GitHubIssueManager {
  private fetchImpl: typeof fetch;
  private storage: SimpleStorage;
  private inFlightOperations = new Map<string, Promise<GitHubIssueResult>>();

  constructor(options: { fetch?: typeof fetch; storage: SimpleStorage }) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.storage = options.storage;
  }

  async getIssueRecords(): Promise<GitHubIssueRecordV1[]> {
    const raw = await this.storage.get(RECORDS_STORAGE_KEY);
    if (!Array.isArray(raw)) return [];
    return raw as GitHubIssueRecordV1[];
  }

  async getExistingIssueRecord(
    repositoryId: number,
    domainKey: string,
    pageUrl: string,
    finding: FindingV1,
  ): Promise<{ issueNumber: number; htmlUrl: string } | null> {
    const fingerprint = computeFindingFingerprint(
      repositoryId,
      domainKey,
      pageUrl,
      finding,
    );
    const records = await this.getIssueRecords();
    const match = records.find((r) => r.fingerprint === fingerprint);
    if (match) {
      return { issueNumber: match.issueNumber, htmlUrl: match.htmlUrl };
    }
    return null;
  }

  async createIssue(options: CreateIssueOptions): Promise<GitHubIssueResult> {
    const { operationId } = options;

    // Deduplicate in-flight operations with same operationId
    const existingPromise = this.inFlightOperations.get(operationId);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = this.executeCreateIssue(options);
    this.inFlightOperations.set(operationId, promise);

    try {
      return await promise;
    } finally {
      this.inFlightOperations.delete(operationId);
    }
  }

  private async executeCreateIssue(
    options: CreateIssueOptions,
  ): Promise<GitHubIssueResult> {
    const { accessToken, mapping, finding, pageUrl, scannerInfo } = options;

    // Check duplicate record
    const existing = await this.getExistingIssueRecord(
      mapping.repository.id,
      mapping.domainKey,
      pageUrl,
      finding,
    );
    if (existing) {
      return {
        ok: true,
        issueNumber: existing.issueNumber,
        htmlUrl: existing.htmlUrl,
        labelMissing: false,
      };
    }

    const fingerprint = computeFindingFingerprint(
      mapping.repository.id,
      mapping.domainKey,
      pageUrl,
      finding,
    );

    const payload = buildGitHubIssuePayload({
      finding,
      pageUrl,
      scannerInfo,
      fingerprint,
    });

    const repoOwner = mapping.repository.owner;
    const repoName = mapping.repository.name;
    const configuredLabel = mapping.label?.name;

    const requestBody: { title: string; body: string; labels?: string[] } = {
      title: payload.title,
      body: payload.body,
      ...(configuredLabel ? { labels: [configuredLabel] } : {}),
    };

    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://api.github.com/repos/${encodeURIComponent(repoOwner)}/${encodeURIComponent(repoName)}/issues`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": API_VERSION,
          },
          body: JSON.stringify(requestBody),
        },
      );
    } catch (caught) {
      // Ambiguous network failure: DO NOT RETRY AUTOMATICALLY
      return {
        ok: false,
        ambiguous: true,
        error: {
          code: "network-error",
          message:
            caught instanceof Error
              ? caught.message
              : "Network request to GitHub failed. The issue may have been created; please check your repository issues.",
        },
      };
    }

    if (!res.ok) {
      let errorMsg = `GitHub API error (HTTP ${res.status})`;
      try {
        const errJson = (await res.json()) as { message?: string };
        if (errJson.message) errorMsg = errJson.message;
      } catch {
        // ignore parse error
      }
      return {
        ok: false,
        ambiguous: false,
        error: { code: `http-${res.status}`, message: errorMsg },
      };
    }

    const data = (await res.json()) as {
      number: number;
      html_url: string;
      labels?: Array<{ name?: string }>;
    };

    const returnedLabels = (data.labels ?? []).map((l) => l.name ?? "");
    const labelMissing =
      Boolean(configuredLabel) && !returnedLabels.includes(configuredLabel!);

    // Persist success record
    await this.saveRecord({
      fingerprint,
      issueNumber: data.number,
      htmlUrl: data.html_url,
      repositoryId: mapping.repository.id,
      timestamp: new Date().toISOString(),
    });

    return {
      ok: true,
      issueNumber: data.number,
      htmlUrl: data.html_url,
      labelMissing,
    };
  }

  private async saveRecord(record: GitHubIssueRecordV1): Promise<void> {
    const records = await this.getIssueRecords();
    records.unshift(record);
    // Bound record storage
    if (records.length > MAX_RECORDS) {
      records.length = MAX_RECORDS;
    }
    await this.storage.set(RECORDS_STORAGE_KEY, records);
  }
}

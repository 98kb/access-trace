import { describe, expect, it, vi, beforeEach } from "vitest";
import type { FindingV1 } from "../../src/contracts";
import type { DomainRepositoryMappingV1 } from "../../src/github/contracts";
import { computeFindingFingerprint } from "../../src/github/fingerprint";
import { GitHubIssueManager } from "../../src/github/issue";

describe("GitHub Issue Manager and Duplicate Control", () => {
  let mockStorage: Record<string, unknown>;
  let mockFetch: ReturnType<typeof vi.fn>;

  const sampleFinding: FindingV1 = {
    findingId: "f-123",
    ruleId: "image-alt",
    status: "violation",
    impact: "critical",
    tags: ["wcag2a"],
    help: "Images must have alt text",
    helpUrl: "https://example.com/rule",
    failureSummary: "Missing alt attribute",
    evidence: '<img src="a.png">',
    nodeRef: "node-1",
    locator: { segments: [{ type: "css", selector: "img#logo" }] },
  };

  const sampleMapping: DomainRepositoryMappingV1 = {
    schemaVersion: "1.0",
    domainKey: "example.com",
    installationId: 101,
    repository: {
      id: 501,
      owner: "acme",
      name: "web",
      fullName: "acme/web",
      htmlUrl: "https://github.com/acme/web",
    },
    label: { id: 1, name: "accessibility", color: "d4c5f9" },
    createdAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:00:00.000Z",
  };

  beforeEach(() => {
    mockStorage = {};
    mockFetch = vi.fn();
  });

  const createManager = () => {
    return new GitHubIssueManager({
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
  };

  it("computes stable fingerprint regardless of scanId or nodeRef", () => {
    const fp1 = computeFindingFingerprint(
      501,
      "example.com",
      "/checkout",
      sampleFinding,
    );
    const fp2 = computeFindingFingerprint(501, "example.com", "/checkout", {
      ...sampleFinding,
      findingId: "different-id",
      nodeRef: "different-node",
    });

    expect(fp1).toBe(fp2);
  });

  it("posts issue to GitHub and saves success record", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        number: 42,
        html_url: "https://github.com/acme/web/issues/42",
        labels: [{ name: "accessibility" }],
      }),
    });

    const manager = createManager();
    const result = await manager.createIssue({
      accessToken: "ghu_token",
      mapping: sampleMapping,
      finding: sampleFinding,
      pageUrl: "https://example.com/checkout",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      operationId: "op-1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issueNumber).toBe(42);
      expect(result.htmlUrl).toBe("https://github.com/acme/web/issues/42");
      expect(result.labelMissing).toBe(false);
    }

    const records = mockStorage["github-issue-records:v1"] as unknown[];
    expect(records).toHaveLength(1);
    expect((records[0] as { issueNumber: number }).issueNumber).toBe(42);
  });

  it("reports labelMissing when configured label is not returned by GitHub", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        number: 43,
        html_url: "https://github.com/acme/web/issues/43",
        labels: [], // No label returned because user lacks label permission
      }),
    });

    const manager = createManager();
    const result = await manager.createIssue({
      accessToken: "ghu_token",
      mapping: sampleMapping,
      finding: sampleFinding,
      pageUrl: "https://example.com/checkout",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      operationId: "op-2",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.labelMissing).toBe(true);
    }
  });

  it("returns existing record if fingerprint already has a recorded issue", async () => {
    const fp = computeFindingFingerprint(
      501,
      "example.com",
      "/checkout",
      sampleFinding,
    );

    mockStorage["github-issue-records:v1"] = [
      {
        fingerprint: fp,
        issueNumber: 99,
        htmlUrl: "https://github.com/acme/web/issues/99",
        repositoryId: 501,
        timestamp: new Date().toISOString(),
      },
    ];

    const manager = createManager();
    const existing = await manager.getExistingIssueRecord(
      501,
      "example.com",
      "/checkout",
      sampleFinding,
    );

    expect(existing).toEqual({
      issueNumber: 99,
      htmlUrl: "https://github.com/acme/web/issues/99",
    });

    // Calling createIssue when already exists returns existing record without posting to API
    const result = await manager.createIssue({
      accessToken: "ghu_token",
      mapping: sampleMapping,
      finding: sampleFinding,
      pageUrl: "https://example.com/checkout",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      operationId: "op-3",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issueNumber).toBe(99);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("deduplicates simultaneous operations with same operationId", async () => {
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 201,
                json: async () => ({
                  number: 100,
                  html_url: "https://github.com/acme/web/issues/100",
                  labels: [],
                }),
              }),
            50,
          ),
        ),
    );

    const manager = createManager();
    const p1 = manager.createIssue({
      accessToken: "ghu_token",
      mapping: sampleMapping,
      finding: sampleFinding,
      pageUrl: "https://example.com/checkout",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      operationId: "op-simultaneous",
    });
    const p2 = manager.createIssue({
      accessToken: "ghu_token",
      mapping: sampleMapping,
      finding: sampleFinding,
      pageUrl: "https://example.com/checkout",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      operationId: "op-simultaneous",
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("handles network failure as ambiguous and does not automatically retry", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const manager = createManager();
    const result = await manager.createIssue({
      accessToken: "ghu_token",
      mapping: sampleMapping,
      finding: sampleFinding,
      pageUrl: "https://example.com/checkout",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      operationId: "op-network-fail",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.ambiguous).toBe(true);
      expect(result.error.code).toBe("network-error");
    }
  });
});

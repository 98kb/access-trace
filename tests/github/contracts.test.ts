import { describe, expect, it } from "vitest";
import {
  parseGitHubConnectionView,
  parseGitHubCredential,
  parseDomainRepositoryMapping,
  GITHUB_SCHEMA_VERSION,
  type GitHubAuthState,
  type GitHubConnectionViewV1,
  type GitHubCredentialV1,
  type DomainRepositoryMappingV1,
} from "../../src/github/contracts";

describe("GitHub contracts validation", () => {
  it("validates GitHubConnectionViewV1", () => {
    const validView: GitHubConnectionViewV1 = {
      schemaVersion: "1.0",
      state: "connected",
      user: {
        id: 12345,
        login: "octocat",
        name: "Monalisa Octocat",
        avatarUrl: "https://github.com/images/error/octocat_happy.gif",
      },
      expiresAt: "2026-09-06T12:00:00.000Z",
      error: null,
    };
    expect(parseGitHubConnectionView(validView)).toEqual(validView);

    expect(() =>
      parseGitHubConnectionView({
        ...validView,
        state: "unknown-state" as unknown as GitHubAuthState,
      }),
    ).toThrow();

    expect(() =>
      parseGitHubConnectionView({
        ...validView,
        schemaVersion: "2.0" as unknown as typeof GITHUB_SCHEMA_VERSION,
      }),
    ).toThrow();
  });

  it("validates GitHubCredentialV1", () => {
    const validCred: GitHubCredentialV1 = {
      schemaVersion: "1.0",
      accessToken: "ghu_16379357193",
      accessTokenExpiresAt: "2026-09-06T19:00:00.000Z",
      refreshToken: "ghr_16379357193",
      refreshTokenExpiresAt: "2027-09-06T19:00:00.000Z",
      tokenType: "bearer",
      userId: 12345,
      userLogin: "octocat",
      updatedAt: "2026-09-06T11:00:00.000Z",
    };
    expect(parseGitHubCredential(validCred)).toEqual(validCred);

    expect(() =>
      parseGitHubCredential({
        ...validCred,
        accessToken: "",
      }),
    ).toThrow();
  });

  it("validates DomainRepositoryMappingV1", () => {
    const validMapping: DomainRepositoryMappingV1 = {
      schemaVersion: "1.0",
      domainKey: "example.com",
      installationId: 9999,
      repository: {
        id: 8888,
        owner: "my-org",
        name: "my-repo",
        fullName: "my-org/my-repo",
        htmlUrl: "https://github.com/my-org/my-repo",
      },
      label: {
        id: 7777,
        name: "accessibility",
        color: "d4c5f9",
      },
      createdAt: "2026-09-06T10:00:00.000Z",
      updatedAt: "2026-09-06T10:00:00.000Z",
    };
    expect(parseDomainRepositoryMapping(validMapping)).toEqual(validMapping);

    expect(() =>
      parseDomainRepositoryMapping({
        ...validMapping,
        domainKey: "INVALID DOMAIN",
      }),
    ).toThrow();
  });
});

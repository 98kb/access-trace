import { getDomainKeyFromUrl } from "./domain";

export const GITHUB_SCHEMA_VERSION = "1.0" as const;

export type GitHubAuthState =
  | "not-configured"
  | "disconnected"
  | "connecting"
  | "connected"
  | "expired"
  | "error";

export interface GitHubUserV1 {
  id: number;
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface GitHubConnectionViewV1 {
  schemaVersion: typeof GITHUB_SCHEMA_VERSION;
  state: GitHubAuthState;
  user: GitHubUserV1 | null;
  expiresAt: string | null;
  error: { code: string; message: string } | null;
}

export interface GitHubCredentialV1 {
  schemaVersion: typeof GITHUB_SCHEMA_VERSION;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tokenType: string;
  userId: number;
  userLogin: string;
  userName?: string;
  userAvatarUrl?: string;
  updatedAt: string;
}

export interface GitHubRepositoryV1 {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  installationId: number;
}

export interface GitHubLabelV1 {
  id: number;
  name: string;
  color: string;
}

export interface DomainRepositoryMappingV1 {
  schemaVersion: typeof GITHUB_SCHEMA_VERSION;
  domainKey: string;
  installationId: number;
  repository: {
    id: number;
    owner: string;
    name: string;
    fullName: string;
    htmlUrl: string;
  };
  label: GitHubLabelV1 | null;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubIssueRecordV1 {
  fingerprint: string;
  issueNumber: number;
  htmlUrl: string;
  repositoryId: number;
  timestamp: string;
}

export interface DeviceFlowCodeResponse {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export class GitHubContractError extends Error {}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GitHubContractError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new GitHubContractError(`${label} must be a non-empty string`);
  }
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new GitHubContractError(`${label} must be a valid number`);
  }
  return value;
}

export function parseGitHubConnectionView(
  value: unknown,
): GitHubConnectionViewV1 {
  const obj = record(value, "GitHubConnectionView");
  if (obj.schemaVersion !== GITHUB_SCHEMA_VERSION) {
    throw new GitHubContractError(
      `Unsupported schema version: ${String(obj.schemaVersion)}`,
    );
  }
  const validStates: GitHubAuthState[] = [
    "not-configured",
    "disconnected",
    "connecting",
    "connected",
    "expired",
    "error",
  ];
  if (!validStates.includes(obj.state as GitHubAuthState)) {
    throw new GitHubContractError(
      `Invalid connection state: ${String(obj.state)}`,
    );
  }

  let user: GitHubUserV1 | null = null;
  if (obj.user !== null && obj.user !== undefined) {
    const u = record(obj.user, "user");
    user = {
      id: number(u.id, "user.id"),
      login: string(u.login, "user.login"),
      ...(typeof u.name === "string" ? { name: u.name } : {}),
      ...(typeof u.avatarUrl === "string" ? { avatarUrl: u.avatarUrl } : {}),
    };
  }

  let error: { code: string; message: string } | null = null;
  if (obj.error !== null && obj.error !== undefined) {
    const err = record(obj.error, "error");
    error = {
      code: string(err.code, "error.code"),
      message: string(err.message, "error.message"),
    };
  }

  return {
    schemaVersion: GITHUB_SCHEMA_VERSION,
    state: obj.state as GitHubAuthState,
    user,
    expiresAt: obj.expiresAt ? string(obj.expiresAt, "expiresAt") : null,
    error,
  };
}

export function parseGitHubCredential(value: unknown): GitHubCredentialV1 {
  const obj = record(value, "GitHubCredential");
  if (obj.schemaVersion !== GITHUB_SCHEMA_VERSION) {
    throw new GitHubContractError(
      `Unsupported schema version: ${String(obj.schemaVersion)}`,
    );
  }
  return {
    schemaVersion: GITHUB_SCHEMA_VERSION,
    accessToken: string(obj.accessToken, "accessToken"),
    accessTokenExpiresAt: string(
      obj.accessTokenExpiresAt,
      "accessTokenExpiresAt",
    ),
    refreshToken: string(obj.refreshToken, "refreshToken"),
    refreshTokenExpiresAt: string(
      obj.refreshTokenExpiresAt,
      "refreshTokenExpiresAt",
    ),
    tokenType: string(obj.tokenType, "tokenType"),
    userId: number(obj.userId, "userId"),
    userLogin: string(obj.userLogin, "userLogin"),
    ...(typeof obj.userName === "string" ? { userName: obj.userName } : {}),
    ...(typeof obj.userAvatarUrl === "string"
      ? { userAvatarUrl: obj.userAvatarUrl }
      : {}),
    updatedAt: string(obj.updatedAt, "updatedAt"),
  };
}

export function parseDomainRepositoryMapping(
  value: unknown,
): DomainRepositoryMappingV1 {
  const obj = record(value, "DomainRepositoryMapping");
  if (obj.schemaVersion !== GITHUB_SCHEMA_VERSION) {
    throw new GitHubContractError(
      `Unsupported schema version: ${String(obj.schemaVersion)}`,
    );
  }
  const domainKey = string(obj.domainKey, "domainKey");
  // Validate domainKey format
  if (domainKey !== getDomainKeyFromUrl(`http://${domainKey}`)) {
    throw new GitHubContractError(`Invalid domainKey format: ${domainKey}`);
  }

  const repo = record(obj.repository, "repository");
  const repository = {
    id: number(repo.id, "repository.id"),
    owner: string(repo.owner, "repository.owner"),
    name: string(repo.name, "repository.name"),
    fullName: string(repo.fullName, "repository.fullName"),
    htmlUrl: string(repo.htmlUrl, "repository.htmlUrl"),
  };

  let label: GitHubLabelV1 | null = null;
  if (obj.label !== null && obj.label !== undefined) {
    const lbl = record(obj.label, "label");
    label = {
      id: number(lbl.id, "label.id"),
      name: string(lbl.name, "label.name"),
      color: string(lbl.color, "label.color"),
    };
  }

  return {
    schemaVersion: GITHUB_SCHEMA_VERSION,
    domainKey,
    installationId: number(obj.installationId, "installationId"),
    repository,
    label,
    createdAt: string(obj.createdAt, "createdAt"),
    updatedAt: string(obj.updatedAt, "updatedAt"),
  };
}

export interface GitHubAppConfig {
  clientId: string;
  installationUrl?: string;
}

export function resolveGitHubInstallationUrl(rawUrl?: string | null): string {
  const trimmed = rawUrl?.trim();
  if (!trimmed || trimmed === "https://github.com/settings/apps") {
    return "https://github.com/settings/apps";
  }
  const cleanUrl = trimmed.replace(/\/+$/, "");
  if (cleanUrl.endsWith("/installations/new")) {
    return cleanUrl;
  }
  return `${cleanUrl}/installations/new`;
}

export function getGitHubAppConfig(): GitHubAppConfig | null {
  const clientId =
    (import.meta.env?.VITE_GITHUB_APP_CLIENT_ID as string | undefined) ?? "";
  if (!clientId || !clientId.trim()) {
    return null;
  }
  const rawInstallationUrl =
    (import.meta.env?.VITE_GITHUB_APP_INSTALLATION_URL as string | undefined) ??
    undefined;

  const installationUrl = rawInstallationUrl?.trim()
    ? resolveGitHubInstallationUrl(rawInstallationUrl.trim())
    : undefined;

  return {
    clientId: clientId.trim(),
    ...(installationUrl ? { installationUrl } : {}),
  };
}

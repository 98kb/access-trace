export interface GitHubAppConfig {
  clientId: string;
  installationUrl?: string;
}

export function getGitHubAppConfig(): GitHubAppConfig | null {
  const clientId =
    (import.meta.env?.VITE_GITHUB_APP_CLIENT_ID as string | undefined) ?? "";
  if (!clientId || !clientId.trim()) {
    return null;
  }
  const installationUrl =
    (import.meta.env?.VITE_GITHUB_APP_INSTALLATION_URL as string | undefined) ??
    undefined;

  return {
    clientId: clientId.trim(),
    ...(installationUrl?.trim()
      ? { installationUrl: installationUrl.trim() }
      : {}),
  };
}

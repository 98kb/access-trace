/**
 * Extracts the canonical domain key from a given URL string.
 *
 * Rules:
 * - Scheme must be http or https.
 * - Result is exact lower-cased host.
 * - Non-default ports are included (e.g. localhost:3000 vs localhost:4000).
 * - Default ports (80 for http, 443 for https) are omitted.
 * - Userinfo, path, query, and fragment are excluded.
 * - Unsupported schemes (chrome://, chrome-extension://, about:, file:, etc.) return null.
 */
export function getDomainKeyFromUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port;
    if (!host) return null;

    const isDefaultPort =
      !port ||
      (parsed.protocol === "http:" && port === "80") ||
      (parsed.protocol === "https:" && port === "443");

    return isDefaultPort ? host : `${host}:${port}`;
  } catch {
    return null;
  }
}

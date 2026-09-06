import type { FindingV1 } from "../contracts";
import { getDomainKeyFromUrl } from "./domain";

/**
 * Computes a simple, fast non-cryptographic string hash (FNV-1a 32-bit hex).
 */
function fnv1a32Hex(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Calculates a deterministic finding fingerprint from stable normalized fields:
 * - repositoryId
 * - domainKey
 * - sanitized pathname
 * - ruleId
 * - normalized locator selector string
 *
 * Excludes volatile fields (scanId, nodeRef, timestamp).
 */
export function computeFindingFingerprint(
  repositoryId: number,
  rawDomain: string,
  rawPageUrlOrPath: string,
  finding: FindingV1,
): string {
  const domainKey = rawDomain.includes("://")
    ? (getDomainKeyFromUrl(rawDomain) ?? rawDomain.toLowerCase())
    : (getDomainKeyFromUrl(`http://${rawDomain}`) ?? rawDomain.toLowerCase());

  let pathname = "/";
  try {
    if (
      rawPageUrlOrPath.startsWith("http:") ||
      rawPageUrlOrPath.startsWith("https:")
    ) {
      pathname = new URL(rawPageUrlOrPath).pathname || "/";
    } else {
      pathname = rawPageUrlOrPath || "/";
    }
  } catch {
    pathname = "/";
  }

  const locatorStr = (finding.locator?.segments ?? [])
    .map((s) => `${s.type}:${s.selector}`)
    .join(">");

  const canonicalKey = [
    String(repositoryId),
    domainKey,
    pathname,
    finding.ruleId,
    locatorStr,
  ].join("|");

  return `fp_${fnv1a32Hex(canonicalKey)}`;
}

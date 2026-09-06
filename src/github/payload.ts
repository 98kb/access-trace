import type { FindingV1 } from "../contracts";

export interface IssuePayloadOptions {
  finding: FindingV1;
  pageUrl: string;
  scannerInfo: { name: string; version: string };
  fingerprint: string;
}

export interface GitHubIssuePayload {
  title: string;
  body: string;
}

/**
 * Sanitizes untrusted text to prevent Markdown breakouts, accidental user mentions,
 * issue references, task-list injection, and HTML execution.
 */
export function sanitizeMarkdown(input: string): string {
  if (!input) return "";
  return (
    input
      // Replace html brackets
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      // Prevent backtick / code block breakouts
      .replace(/`/g, "'")
      // Prevent @mentions
      .replace(/@([a-zA-Z0-9_-]+)/g, "@\u200B$1")
      // Prevent #123 issue references
      .replace(/#([0-9]+)/g, "#\u200B$1")
      // Prevent task list injection [ ] or [x]
      .replace(/\[\s*[xX]?\s*\]/g, "\\[ \\]")
  );
}

/**
 * Strips query string, fragment, and userinfo from a URL, leaving only origin + pathname.
 */
function sanitizePageUrl(rawUrl: string): { origin: string; pathname: string } {
  try {
    const parsed = new URL(rawUrl);
    return {
      origin: parsed.origin,
      pathname: parsed.pathname || "/",
    };
  } catch {
    return { origin: "", pathname: "/" };
  }
}

/**
 * Builds a pure, deterministic GitHub issue title and body payload.
 */
export function buildGitHubIssuePayload(
  options: IssuePayloadOptions,
): GitHubIssuePayload {
  const { finding, pageUrl, scannerInfo, fingerprint } = options;
  const { origin, pathname } = sanitizePageUrl(pageUrl);

  const cleanHelp = sanitizeMarkdown(finding.help);
  const cleanPath = pathname;

  // Title: [Accessibility] {finding help/title} — {pathname}
  // Title limit on GitHub is 256 chars.
  const prefix = "[Accessibility] ";
  const suffix = ` — ${cleanPath}`;
  const maxHelpLen = Math.max(10, 256 - prefix.length - suffix.length);

  const truncatedHelp =
    cleanHelp.length > maxHelpLen
      ? cleanHelp.slice(0, maxHelpLen - 1) + "…"
      : cleanHelp;

  const title = `${prefix}${truncatedHelp}${suffix}`;

  const cleanRuleId = sanitizeMarkdown(finding.ruleId);
  const cleanImpact = sanitizeMarkdown(finding.impact);
  const cleanStatus = sanitizeMarkdown(finding.status);
  const cleanSummary = sanitizeMarkdown(finding.failureSummary);
  const cleanEvidence = sanitizeMarkdown(finding.evidence);
  const cleanTags = finding.tags
    .map((t) => `\`${sanitizeMarkdown(t)}\``)
    .join(", ");
  const fullPageUrl = `${origin}${pathname}`;

  const body = [
    `### Accessibility Finding: \`${cleanRuleId}\``,
    "",
    `**Impact:** \`${cleanImpact}\` | **Status:** \`${cleanStatus}\``,
    "",
    `**Rule Help:** ${cleanHelp}`,
    `**Help URL:** ${finding.helpUrl}`,
    `**WCAG / Tags:** ${cleanTags}`,
    "",
    `**Page:** ${fullPageUrl}`,
    "",
    "**Element Snippet:**",
    "```html",
    cleanEvidence,
    "```",
    "",
    "**Failure Summary:**",
    cleanSummary,
    "",
    "---",
    `*Scanner: ${sanitizeMarkdown(scannerInfo.name)} ${sanitizeMarkdown(scannerInfo.version)}*`,
    "*Note: Automated accessibility scan results require human verification.*",
    `<!-- a11y-scan:finding:${fingerprint} -->`,
  ].join("\n");

  return { title, body };
}

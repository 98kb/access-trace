import { describe, expect, it } from "vitest";
import type { FindingV1 } from "../../src/contracts";
import {
  buildGitHubIssuePayload,
  sanitizeMarkdown,
} from "../../src/github/payload";

describe("GitHub Issue Payload Generator", () => {
  const sampleFinding: FindingV1 = {
    findingId: "f-123",
    ruleId: "image-alt",
    status: "violation",
    impact: "critical",
    tags: ["cat.text-alternatives", "wcag2a", "wcag111"],
    help: "Images must have alternate text",
    helpUrl: "https://dequeuniversity.com/rules/axe/4.13/image-alt",
    failureSummary:
      "Fix any of the following:\n  Element does not have an alt attribute",
    evidence: '<img src="logo.png" id="logo">',
    nodeRef: "node-1",
    locator: {
      segments: [{ type: "css", selector: "#logo" }],
    },
  };

  it("builds title with rule help and sanitized pathname", () => {
    const payload = buildGitHubIssuePayload({
      finding: sampleFinding,
      pageUrl: "https://admin:pass@example.com/checkout/step2?promo=123#top",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      fingerprint: "abc123fingerprint",
    });

    expect(payload.title).toBe(
      "[Accessibility] Images must have alternate text — /checkout/step2",
    );
  });

  it("truncates long title deterministically while keeping rule identity", () => {
    const longHelpFinding: FindingV1 = {
      ...sampleFinding,
      help: "A".repeat(300),
    };
    const payload = buildGitHubIssuePayload({
      finding: longHelpFinding,
      pageUrl: "https://example.com/very/long/path",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      fingerprint: "abc123fingerprint",
    });

    expect(payload.title.length).toBeLessThanOrEqual(256);
    expect(payload.title).toContain("[Accessibility]");
    expect(payload.title).toContain("— /very/long/path");
  });

  it("sanitizes hostile Markdown/page strings to prevent breakouts, mentions, and issue references", () => {
    const hostileText =
      "Hello @octocat #123 [ ] checkbox ``` ``` <script>alert(1)</script>";
    const sanitized = sanitizeMarkdown(hostileText);

    expect(sanitized).not.toContain("@octocat");
    expect(sanitized).not.toContain("#123");
    expect(sanitized).not.toContain("[ ]");
    expect(sanitized).not.toContain("<script>");
  });

  it("includes all required deterministic evidence fields and fingerprint marker", () => {
    const payload = buildGitHubIssuePayload({
      finding: sampleFinding,
      pageUrl: "https://example.com/home?query=123#hash",
      scannerInfo: { name: "axe-core", version: "4.13.0" },
      fingerprint: "fp-998877",
    });

    expect(payload.body).toContain("`image-alt`");
    expect(payload.body).toContain("`critical`");
    expect(payload.body).toContain(
      "https://dequeuniversity.com/rules/axe/4.13/image-alt",
    );
    expect(payload.body).toContain("https://example.com/home");
    expect(payload.body).not.toContain("query=123");
    expect(payload.body).not.toContain("#hash");
    expect(payload.body).toContain("axe-core 4.13.0");
    expect(payload.body).toContain("<!-- a11y-scan:finding:fp-998877 -->");
    expect(payload.body).toContain(
      "*Note: Automated accessibility scan results require human verification.*",
    );
  });
});

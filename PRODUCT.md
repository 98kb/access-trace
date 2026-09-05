# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Manifest V3 Chrome extension using WXT, React, TypeScript, and axe-core.

## Users

Developers inspecting the accessibility of the page currently rendered in Chrome.

## Product Purpose

Provide an explicit, deterministic loop from a local automated scan to a visible finding and its matching live element.

## Positioning

The inspector keeps scanning, findings, and element location local and useful without AI. A clean automated scan is never presented as proof of WCAG compliance. Optional advisory explanations can be sent only after explicit confirmation to an allowlisted Ollama-compatible loopback process.

## Operating Context

The primary interface is Chrome's native side panel beside the inspected page. Users scan, filter, select, show or hide overlays, and rescan after page changes.

## Capabilities and Constraints

Run axe-core only after user action, with minimum permissions and no host-wide access. Findings are scoped to a tab and session, and survive service-worker suspension through session storage. Reachable child frames and open shadow roots are scanned and attributed to the frame that owns them; frames Chrome will not grant and closed shadow roots are reported as uninspected rather than ignored. Navigation and meaningful mutation mark results stale instead of triggering a hidden rescan. Optional AI is per-finding, local-loopback-only, bounded, previewed before sending, and advisory; it never changes deterministic findings. No telemetry, remote assets, hosted APIs, automated remediation, crawling, model downloads, or automatic AI calls.

## Brand Commitments

“Accessibility Inspector” is a centralized temporary display name. The voice is restrained, direct, and developer-focused.

## Evidence on Hand

The implementation specifications are `docs/run-01-deterministic-vertical-slice.md`, `docs/run-02-local-ai-boundary.md`, and `docs/run-03-hardening-and-release-readiness.md`. Deterministic fixtures in `fixtures/` cover known rule IDs, a clean state, same-origin and cross-origin frames, open and closed shadow roots, long and nested-scrolling documents, a hostile global CSS reset, same-document routing, post-scan mutation, and many findings; a fake loopback provider exercises the AI boundary.

## Product Principles

- Ask before scanning.
- Report what was not scanned as plainly as what was.
- Distinguish confirmed violations from items needing review.
- Make the finding-to-element connection obvious without changing the page.
- Fail closed at extension boundaries.
- State coverage limits and never imply certification.

## Accessibility & Inclusion

The side panel must be keyboard operable, expose status changes, retain visible focus, and meet WCAG AA contrast. Severity is never communicated by color alone.

# `/implement` Prompt — Run 1: Deterministic Accessibility Vertical Slice

Copy everything below this line into a fresh agent session in the repository where the extension should be built.

---

/implement

The complete specification for this implementation ticket lives in this prompt. Treat it as one self-contained tracer-bullet ticket. The product decisions below are settled: do not reopen the plan, interview me, introduce additional product scope, or defer the implementation into another planning document.

## Goal

Build the first working vertical slice of a developer-first Chrome accessibility inspector:

> A user explicitly scans the active rendered page, sees deterministic accessibility findings in a native Chrome side panel, and can select a finding to locate and highlight the corresponding live element with an on-page overlay.

This run proves the core loop only:

`scan → normalize → list → locate → overlay → rescan`

The product must be useful without AI. It must never claim that a clean automated scan proves WCAG compliance.

## Prerequisites and repository behaviour

- Read and follow the repository's `AGENTS.md`, `CLAUDE.md`, package-manager configuration, and existing conventions before changing anything.
- Work on the current branch. Do not create or switch branches, push, publish, or open a pull request.
- If this is an empty repository, initialize the smallest maintainable application described below. If an application already exists, integrate with its existing tooling rather than replacing it.
- Use Node.js 22 and pnpm unless the repository already declares another supported package manager or Node version.
- If a prerequisite makes the ticket impossible, stop and report the exact missing prerequisite. Do not silently fake browser verification or successful tests.
- Preserve unrelated user changes.

## Locked technical decisions

- Manifest V3 Chrome extension.
- WXT, React, and TypeScript.
- `axe-core` is the only scanning engine in this run.
- Chrome native Side Panel is the primary application UI.
- Scanning starts only after an explicit user action.
- Use the minimum practical permissions. Prefer `activeTab`, `scripting`, and `sidePanel`; do not request blanket host access merely for convenience.
- All scanning and processing happens locally. Add no telemetry, analytics, external API calls, remote fonts, CDNs, or remotely hosted assets.
- Keep this as one application with internal modules. Do not create a monorepo or independently published packages before a second consumer exists.
- Use WXT and Chrome APIs at their public seams; do not create wrappers that only rename an existing API.

The extension may use a neutral temporary display name such as **Accessibility Inspector**. Keep user-facing product-name text centralized so it can be renamed later.

## Architecture and ownership

Create clear internal module boundaries for:

1. Versioned scanner contracts.
2. The Axe scanner adapter and result normalization.
3. Extension messaging between the side panel, service worker, and inspected tab/frame.
4. The side-panel application.
5. The on-page overlay controller.

The scanner and contract modules must not import React, WXT UI modules, or Chrome APIs. Chrome-specific orchestration belongs at extension entry points or adapters.

Avoid speculative abstractions. Introduce interfaces only at real seams exercised by tests or by more than one implementation.

## Versioned scan contract

Define a serializable `ScanReportV1` contract with at least:

- `schemaVersion: "1.0"`
- unique `scanId`
- scanner name and installed version
- page URL and title
- scan start timestamp and duration
- a coverage summary
- normalized findings
- scan warnings and skipped-region reasons

Represent one affected Axe node as one normalized `FindingV1`, even when Axe groups several nodes under one violation. A finding must include at least:

- stable ID within a scan, derived from the scan and occurrence rather than array position
- Axe rule ID
- status: `violation` or `needs-review`
- impact, preserving an explicit `unknown` state instead of inventing severity
- WCAG or best-practice tags
- help text and authoritative help URL
- failure summary
- serializable target locator, including room for a frame path or shadow-boundary segments
- small element evidence snippet returned by Axe
- an ephemeral `nodeRef` usable only for the current scan

Treat Axe `violations` as `violation` and Axe `incomplete` results as `needs-review`. Do not convert incomplete checks into confirmed violations. Keep `passes` and `inapplicable` out of the visible finding list, but retain aggregate counts if Axe provides them.

Make schema parsing or validation explicit at message boundaries so malformed extension messages fail closed with a useful error.

## Scan behaviour

- Clicking the toolbar action should open the native side panel for the active tab.
- The side panel must present a prominent **Scan this page** action.
- On activation, inject or activate the bundled scanner in the current tab without depending on the page's JavaScript environment.
- Run the locally bundled `axe-core` against the currently rendered document using WCAG 2.x A/AA and relevant best-practice rules supported by the installed engine.
- Return a normalized `ScanReportV1` to the side panel.
- A rescan replaces the active report for that tab and clears overlay state from the previous scan.
- Prevent concurrent duplicate scans for one tab. A repeated request should cancel, join, or reject cleanly rather than race.
- Surface unsupported pages such as `chrome://` URLs as an intentional UI state, not an unhandled exception.
- Do not automatically scan every page the user visits.

For this run, full cross-origin iframe geometry and closed-shadow-root coverage are out of scope. The report must nevertheless avoid implying those regions were scanned. Use coverage warnings when the extension cannot prove complete inspection.

## Side-panel experience

Create a restrained, modern developer-tool interface that is itself accessible. It must include:

- Page identity and scan timestamp.
- Counts for violations and needs-review findings.
- Impact filters.
- Status filter.
- Finding cards showing rule, impact, concise message, element snippet, WCAG/best-practice tags, and help link.
- Selected-finding state.
- Rescan action.
- Overlay show/hide control.
- Empty, loading, scanning, permission-denied, unsupported-page, error, and clean-scan states.

Selecting a finding must ask the inspected page to:

1. Resolve the corresponding current-scan `nodeRef` or locator.
2. Scroll the element into view without unexpectedly moving keyboard focus.
3. Emphasize the matching overlay briefly.

The side panel must be fully keyboard operable, have visible focus indicators, use semantic controls, expose status changes accessibly, and meet WCAG AA contrast. Do not encode severity through colour alone.

## Overlay behaviour

Implement one isolated on-page overlay root rather than styling target elements directly.

Requirements:

- Mount the visual layer inside an isolated Shadow DOM root owned by the content script.
- Mark the visual-only overlay root `aria-hidden="true"`; all interactive controls remain in the side panel.
- Do not alter target-element classes, inline styles, ARIA attributes, layout, event handlers, or focusability.
- Draw non-interactive rectangles and compact labels over findings.
- Use `pointer-events: none` so the inspected page remains usable.
- Use explicit pixel-based extension styles so page-level rem settings cannot resize the overlay unexpectedly.
- Recalculate geometry on scroll and resize through a scheduled `requestAnimationFrame` update rather than synchronous work per event.
- Support show all, selected emphasis, hide, and complete teardown.
- Remove every observer, listener, animation frame, and injected node when the overlay is cleared or the content context unloads.

If an element cannot be resolved after the page mutates, notify the panel that the finding is stale instead of highlighting a different element.

## State and privacy

- Keep page findings scoped by tab.
- Do not rely only on service-worker in-memory state because Manifest V3 workers can be suspended.
- If scan state is persisted, use session-scoped extension storage and remove it when the tab closes. Do not persist scanned HTML or findings into long-lived local or sync storage.
- Never log full DOM fragments or form values.
- Add no AI code, provider settings, API keys, localhost connections, or future-provider placeholders beyond the clean module seam needed by later work.

## Pre-agreed test seams

Drive TDD at these observable seams:

1. **Axe normalization seam** — raw Axe-shaped input becomes an exact `ScanReportV1` with one finding per affected node and correct violation/needs-review status.
2. **Scan orchestration seam** — an explicit scan request produces one report or one typed failure and cannot race another scan for the same tab.
3. **Extension message seam** — versioned request and response payloads parse successfully; malformed or unknown-version messages fail closed.
4. **Overlay seam** — a report plus resolvable elements produces boxes; selection, scroll/resize updates, stale targets, hide, and teardown have observable outcomes without mutating target elements.
5. **Side-panel user seam** — scanning, filtering, selecting, showing/hiding overlays, clean results, and failure states are operable through rendered user controls.

Test public behaviour. Do not assert private helper call order or reach into component internals when the behaviour is observable through a public seam.

## Test fixtures

Add local fixture pages that deliberately contain stable examples of:

- Image missing alternative text.
- Form control without an accessible label.
- Insufficient text contrast.
- Invalid or inappropriate ARIA.
- At least one Axe incomplete/manual-review case if it can be made deterministic with the installed version.
- A clean state suitable for verifying empty results.
- A long page that requires scrolling to a selected finding.

Fixtures must have explicit expected rule IDs. Do not snapshot the entire Axe response.

## Verification

Provide and run repository-standard equivalents of:

- formatting or formatting check
- lint
- TypeScript type-check
- focused unit/component tests during implementation
- full unit/component suite once at the end
- production extension build
- Playwright or equivalent Chromium extension smoke test

The browser smoke test must load the unpacked build, open a fixture, invoke the scan through a real extension boundary where practical, and prove that a known finding reaches the panel and maps to the expected page element. If the environment cannot run that test, keep the test checked in and report the environmental blocker accurately.

Also inspect the rendered side panel and overlay in a real Chromium browser before declaring success. Fix obvious clipping, unreadable states, focus problems, or overlay positioning errors discovered during inspection.

## Acceptance criteria

- [ ] The project installs and builds from documented commands.
- [ ] Clicking the extension action opens the side panel.
- [ ] No scan occurs before the user asks for one.
- [ ] A fixture scan produces correctly normalized Axe violations and needs-review findings.
- [ ] Finding cards expose useful rule, impact, element, standard, and help information.
- [ ] Selecting a finding scrolls to and visually identifies the correct element.
- [ ] Overlay visibility can be toggled and teardown leaves the page unchanged.
- [ ] Rescanning replaces stale report and overlay state.
- [ ] Unsupported and unscannable pages produce intentional UI states.
- [ ] No page data or telemetry leaves the browser.
- [ ] The side panel is keyboard operable and passes an automated accessibility scan of its own supported rendered states.
- [ ] Tests, type-check, lint, and production build pass.
- [ ] Loading the generated unpacked extension is documented.

## Explicitly out of scope

- Any LLM or AI provider.
- Ollama and WebGPU.
- Remote services or remote consent.
- Automatic remediation.
- Full-site crawling.
- Continuous background scanning.
- Source-code mapping.
- DevTools Elements integration.
- SARIF or CI integration.
- User accounts, teams, analytics, or cloud persistence.
- Claims of WCAG certification or complete accessibility coverage.
- Broad cross-origin host permissions.
- Chrome Web Store publication.

## Completion

Finish the implementation rather than merely describing it. Run the relevant `/tdd` loops at the named seams, run the final verification suite, review the resulting diff against this specification, fix material issues, and commit the completed vertical slice to the current branch with a concise conventional commit message.

In the final report, state:

- what was implemented;
- the commit SHA;
- every verification command and whether it passed;
- how to load and exercise the unpacked extension;
- any environmental test that could not be executed;
- remaining limitations that are explicitly inside or outside this ticket.


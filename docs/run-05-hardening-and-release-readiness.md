# `/implement` Prompt — Run 5: Post-Integration Hardening and Release Readiness

Copy everything below this line into a fresh agent session after Runs 1, 2, 3, and 4 have been completed and committed.

---

/implement

The complete specification for this implementation ticket lives in this prompt. Treat it as one self-contained post-integration hardening ticket over the four completed runs. Run 3 already established general MVP hardening; this run must preserve that work while regression-testing and hardening the GitHub capability introduced in Run 4. The product boundaries below are settled: do not add future product features, reopen the architecture without evidence, or turn this into a hosted service.

## Goal

Harden the existing accessibility inspector into a credible, shareable developer MVP:

> The extension behaves predictably across navigation, DOM mutation, frames, open shadow roots, long pages, service-worker suspension, provider and GitHub failure, token expiry, permission loss, and hostile page styles; accurately reports what it did and did not inspect or transmit; remains accessible itself; and produces a reviewable unpacked build and release archive.

This run is about correctness, coverage truthfulness, resilience, accessibility, privacy, performance, and packaging. It must not broaden the product into crawling, generalized collaboration, CI, or remote AI.

## Prerequisites and repository behaviour

- Read and follow `AGENTS.md`, `CLAUDE.md`, repository conventions, and the implementations from Runs 1, 2, 3, and 4.
- Work on the current branch. Do not create or switch branches, push, publish, or open a pull request.
- Verify the existing deterministic vertical slice, local-AI advisory slice, and GitHub integration slice before changing them.
- Required existing capabilities: versioned scan contracts, Axe normalization, explicit active-tab scan, side-panel findings, synchronized overlay, fixture/browser tests, versioned assistant contracts, evidence minimization, loopback-only Ollama adapter, deterministic-finding integrity, `/integrations` options route, GitHub App device authentication, exact-domain repository mappings, optional label mapping, and explicit per-finding issue creation.
- If a prerequisite is absent or materially broken, stop and report it rather than silently weakening the hardening scope or rebuilding earlier runs.
- Record the pre-run commit as the fixed comparison point for final review.
- Preserve unrelated user changes.

## Locked constraints

- Manifest V3, WXT, React, TypeScript, and `axe-core` remain in place.
- Do not replace established modules merely for aesthetic preference.
- Keep `ScanReportV1`, `FindingV1`, `AssistantRequestV1`, `AssistantResponseV1`, and the Run 4 GitHub contracts backward-compatible. If a contract must grow, add optional fields or introduce a deliberately versioned successor with tested migration; do not silently change V1 meaning.
- Scanning remains explicit and local.
- AI remains optional, per-finding, advisory, and loopback-only.
- GitHub remains the only non-loopback remote integration, is user-configured, and transmits finding data only after the per-finding issue action.
- Add no telemetry, extension-owned accounts, additional remote provider, arbitrary endpoint, broad host permission, cloud persistence outside GitHub issues explicitly created by the user, remote assets, automatic fixes, or compliance claims.
- Keep permissions minimal and explain every permission in documentation.

## Coverage model and truthful reporting

Make scan coverage a first-class, serializable part of the report rather than a vague warning string.

Represent at least:

- top document discovered and scanned state;
- child-frame counts by scanned, skipped, and failed;
- open-shadow-root coverage when the engine can establish it;
- skipped-region reason codes such as unsupported URL, missing permission, inaccessible cross-origin frame, detached frame, execution failure, timeout, and unsupported closed shadow root;
- scan cancellation or partial completion;
- coverage warnings suitable for user display.

The summary must clearly distinguish:

- **No findings detected in scanned content** from
- **No accessibility defects exist**.

Never display the second claim.

The clean state must state what was scanned and surface skipped or failed regions without requiring the user to inspect logs.

## Frames and shadow DOM

Harden locator, scan aggregation, messaging, and overlay behaviour for the page regions available under the extension's current permissions.

Requirements:

- Preserve frame identity in normalized findings using serializable frame metadata rather than relying on array order.
- Scan same-origin or otherwise permitted child frames and aggregate their results without duplicating rule occurrences.
- If Chrome permissions prevent access to a cross-origin frame, report it as skipped; do not request blanket host access or pretend it was scanned.
- Support Axe target paths that cross open shadow boundaries.
- Resolve nested locator segments deliberately; never fall back to a similar element when exact resolution fails.
- Render overlay geometry within the owning frame context so nested-frame coordinates remain correct.
- Route selection to the frame that owns the `nodeRef` and acknowledge success, stale target, inaccessible frame, or missing content context explicitly.
- Treat closed shadow roots as uninspectable unless an existing supported API proves otherwise; report the limitation.

Avoid invasive monkey-patching of page APIs solely to observe closed roots or navigation.

## Navigation, mutation, and stale state

- Detect full navigation, tab replacement, and same-document/SPA URL changes through supported extension or browser signals.
- Mark the current scan and its advisories stale when navigation changes the inspected state.
- Clear stale overlays promptly.
- On significant DOM mutation, do not run continuous background accessibility scans. Mark affected results stale or invite an explicit rescan using a debounced, low-cost signal.
- A stale finding must never highlight a different element that happens to match an old selector.
- Rescanning creates a new scan identity, new node references, and a fresh overlay.
- Clear scan and advisory state when the tab closes.
- Restore a coherent panel state after Manifest V3 service-worker suspension or restart using session-scoped state rather than assumptions about memory lifetime.

## Overlay resilience and performance

Harden the overlay against hostile or unusual pages:

- extreme page CSS resets;
- transformed and nested scrolling containers;
- sticky and fixed elements;
- zoom and device-pixel-ratio changes;
- long documents;
- many findings on one element;
- many findings in one viewport;
- element detachment between measurement and paint;
- resize and layout shifts;
- side-panel opening changing viewport geometry.

Requirements:

- Keep extension styles isolated and pixel-stable.
- Batch measurements and writes through animation frames to avoid layout thrashing.
- Do not observe the entire DOM more deeply than necessary.
- Avoid rendering hundreds of permanent text labels simultaneously. Use a bounded strategy such as outlines plus labels for selected/hover-relevant findings.
- Coalesce scroll, resize, and observer events.
- Tear down every observer and listener deterministically.
- Ensure overlay work does not trap pointer events, keyboard events, focus, or page scrolling.
- Add measurable performance budgets for fixture scans and overlay updates. Choose realistic thresholds from a baseline in the test environment and document them; do not invent universal browser guarantees.

## Scan and AI lifecycle resilience

- Support explicit cancellation for in-progress scans and AI requests where their APIs permit it.
- Give scans and assistant requests finite timeouts with distinct typed outcomes.
- Ignore or reject late responses belonging to stale scan/request IDs.
- Prevent double-clicks from producing duplicate scans or AI generations.
- If the Ollama process disappears mid-request, leave the deterministic report intact and show a recoverable advisory error.
- If optional localhost permission is revoked, downgrade to the disabled/permission-needed state without breaking scanning.
- Do not automatically retry scans or AI generation in the background.

## GitHub integration lifecycle resilience

Harden the explicit GitHub path without weakening its Run 4 privacy contract:

- Restore coherent non-sensitive connection and mapping state after Manifest V3 worker suspension without exposing credentials to the side panel, options page, or content script.
- Serialize refresh-token rotation so concurrent repository, label, and create requests cannot reuse the same one-time refresh token.
- Refresh shortly before access-token expiry, retry at most once after an eligible `401`, and require reconnection after revoked, invalid, or expired refresh credentials.
- Treat optional GitHub host-permission removal as a disconnected/permission-needed state; deterministic scanning and local AI must continue to work.
- Cancel device polling on user cancellation, options-page disposal, permission removal, or worker lifecycle change. Respect GitHub's polling interval and `slow_down` response under a fake clock.
- Handle app uninstall, installation suspension, SAML/organization restriction, repository access removal, disabled Issues, renamed/transferred/deleted repository, deleted/renamed label, rate limiting, and malformed API responses with typed user-safe states.
- Revalidate a mapping before issue creation when cached access may be stale. A missing label must not conceal a successfully created issue.
- Collapse duplicate clicks and preserve the successful issue link across worker restart. Bound persisted fingerprint records and prune them without retaining issue-body evidence.
- Never automatically retry an issue-creation `POST` after an ambiguous timeout, connection reset, or worker interruption. State that the issue may exist and link safely to the mapped repository's Issues page.
- Late auth, refresh, discovery, or create responses must not overwrite newer connection, mapping, tab, scan, or operation state.

## Side-panel accessibility and product polish

Audit and improve the extension's own interface across every meaningful state:

- Keyboard-only operation from opening the panel through scanning, filtering, selecting a finding, toggling overlay, opening help, configuring local AI, previewing evidence, generating, cancelling, dismissing an advisory, opening Integration settings, connecting/disconnecting GitHub, editing a mapping, and creating/viewing an issue.
- Logical focus order and intentional focus restoration.
- Visible focus indicators.
- Semantic headings, landmarks, lists, buttons, links, form labels, groups, and status messages.
- Screen-reader announcement for scan completion, errors, filter-result counts, stale state, AI progress, cancellation/completion, GitHub connection progress, mapping errors, issue creation, and ambiguous outcomes without excessive live-region noise.
- WCAG AA contrast in default, hover, selected, focus, disabled, error, and severity states.
- No colour-only communication.
- Text resizing, narrow side-panel widths, long rule names, long element snippets, and long generated guidance without clipping or horizontal page-level scrolling.
- Reduced-motion support for pulses or transitions.

Run Axe against the extension UI's supported side-panel and `/integrations` states, but also add targeted keyboard and focus assertions for behaviour Axe cannot prove.

## Security and privacy hardening

Review the complete extension boundary and enforce:

- No `dangerouslySetInnerHTML`, unsanitized HTML sinks, `eval`, dynamic remote scripts, or remotely hosted executable code.
- Strict extension-page Content Security Policy compatible with Manifest V3.
- External help links use safe navigation behaviour and cannot control the opener.
- Page strings render only as text.
- Extension messages are runtime-validated, versioned, scoped to expected senders/contexts where practical, and reject unknown operations.
- Full DOM fragments, form values, generated advisories, and scan evidence never enter long-lived or sync storage.
- Logs avoid page contents and secrets and are disabled or appropriately minimal in production.
- Ollama endpoints remain validated loopback-only and reject unsafe redirects.
- GitHub credentials remain background-owned, local-only, absent from UI/content-script messages, and are atomically rotated or deleted on unrecoverable authorization failure.
- GitHub requests use only fixed HTTPS login/API hosts, reject unsafe redirects, validate response shapes, and never place credentials in URLs or logs.
- Issue bodies contain only the Run 4 allowlisted deterministic fields; hostile page-derived Markdown cannot create mentions, references, task syntax, HTML execution, or fenced-block breakouts.
- Finding data reaches GitHub only after a valid exact-domain mapping and the user's explicit per-finding create action. Repository/label discovery must not carry page evidence.
- No GitHub credential, page evidence, issue body, or advisory enters sync storage. Persisted duplicate records contain only a fingerprint, repository/issue identity, safe URL, and bounded timestamp.
- No network request occurs during ordinary deterministic scanning.
- No telemetry or analytics dependency appears in the production bundle.

Add a concise `PRIVACY.md` describing, in user-facing language:

- what the extension reads;
- when it scans;
- what remains in the browser;
- what can be sent to a configured local process;
- what GitHub connection metadata and credentials remain locally persisted;
- the exact fields sent to GitHub only when the user creates an issue;
- how disconnect, token expiry/revocation, mapping retention, and duplicate records behave;
- what is never collected;
- current limitations;
- that automated scanning is not accessibility certification.

Add a focused `SECURITY.md` explaining how to report a vulnerability and the local-provider, GitHub credential/API, extension-context, and page-content trust boundaries. Do not invent contact details; use a repository issue-reporting route or an explicit placeholder marked for the maintainer if none exists.

## Fixture and browser-test matrix

Expand local fixtures and end-to-end coverage for:

- ordinary document with known findings;
- clean scanned document;
- long scrolling document;
- nested scroll container;
- sticky/fixed target;
- hostile global CSS reset and nonstandard root font size;
- SPA/same-document route change;
- element removed or replaced after scan;
- accessible same-origin iframe;
- inaccessible or permission-blocked frame represented truthfully;
- open shadow root with a known finding;
- many findings and several findings on one element;
- tab close during scan;
- stale or late scan response;
- service-worker restart or equivalent restored-state seam where test tooling permits;
- local-provider timeout, cancellation, disappearance, invalid output, and revoked permission through fakes;
- GitHub device authorization pending/slow-down/cancel/deny/expire/malformed states through fakes;
- access-token refresh races, rotation, `401`, revoked authorization, and optional-host-permission removal through fakes;
- repository/label pagination, missing installation, removed repository, disabled Issues, and deleted label through fakes;
- mapped, unmapped, disconnected, successful, missing-label, definite-failure, and ambiguous issue-create states;
- repeated finding action and worker-restart duplicate protection without a live GitHub request.

Use explicit behavioural assertions. Do not snapshot entire pages, entire Axe payloads, generated build directories, or nondeterministic overlay coordinates.

## Pre-agreed test seams

Drive TDD at these observable seams:

1. **Coverage seam** — discovered/scanned/skipped/failed regions become exact typed coverage, and clean-state language remains truthful under partial coverage.
2. **Nested locator seam** — frame and open-shadow paths resolve only the exact target and fail stale when any segment changes.
3. **Frame messaging seam** — selection reaches the owning frame and returns an explicit success or typed failure.
4. **Staleness seam** — navigation and meaningful mutation invalidate old reports, node references, overlays, and advisories without starting a hidden scan.
5. **Lifecycle seam** — worker restart, tab close, cancellation, timeout, duplicate action, and late response leave coherent state.
6. **Overlay seam** — hostile CSS, long pages, nested scrolling, layout shifts, many findings, and teardown preserve correct non-interactive highlighting within documented performance budgets.
7. **Extension-accessibility seam** — keyboard paths, focus movement/restoration, live announcements, contrast, reduced motion, and narrow-width rendering have observable tests.
8. **GitHub lifecycle seam** — device authorization, token rotation, permission/revocation, discovery, mapping revalidation, rate limiting, definite failure, and ambiguous create outcomes remain typed and coherent across worker suspension.
9. **GitHub issue seam** — exact-domain validation and a current deterministic finding produce one minimal sanitized issue; duplicate actions reuse a known success and never blindly replay an ambiguous `POST`.
10. **Privacy/security seam** — ordinary scanning performs no network access; GitHub transmits only on explicit integration/create actions; forbidden data does not persist; messages, AI payloads, and GitHub payloads fail closed; production bundle contains no remote executable or telemetry path.

Test public behaviour and contract boundaries. Avoid brittle tests against private component structure or exact pixel coordinates where relative geometric assertions prove the behaviour.

## Documentation and packaging

Update the README with:

- product promise and honest limitations;
- prerequisites;
- install, develop, test, build, and package commands;
- loading the unpacked extension;
- manual verification walkthrough using fixtures;
- configuring optional local Ollama inference;
- configuring the development GitHub App, connecting, mapping an exact domain/repository/label, filing/viewing an issue, and disconnecting;
- permission explanations;
- architecture overview and contract locations;
- troubleshooting unsupported pages, local permission, missing model, stale findings, expired/revoked GitHub access, missing installations/repositories, SSO restrictions, rate limits, ambiguous issue creation, and unavailable labels;
- a future-scope section clearly marked as unimplemented.

Produce a reproducible release archive from the production build, excluding source maps, development fixtures, secrets, local configuration, and unrelated repository files unless WXT's store package intentionally requires an item. Document the command and resulting path. Do not publish it to the Chrome Web Store.

Verify the built manifest, permissions, bundle contents, package size, and absence of remote code. Do not commit generated build output or release archives unless the repository explicitly tracks release artifacts.

## Final verification

Run the repository-standard equivalents of:

- formatting or formatting check
- lint
- TypeScript type-check
- focused tests during each TDD slice
- full unit/component suite once at the end
- complete extension end-to-end suite
- extension UI accessibility tests
- production build
- production package/archive command
- manifest and bundle inspection

Exercise the built extension manually in Chromium across representative fixtures. Inspect side-panel states, `/integrations`, overlay rendering, and—with a development GitHub App and throwaway repository when available—the connection/mapping/create/view/disconnect path rather than relying solely on console output. If the environment blocks any browser or live-GitHub scenario, keep the automated/manual procedure in the repository and report the exact blocker without claiming it passed.

## Acceptance criteria

- [ ] Scan coverage is typed, visible, and honest about skipped or failed regions.
- [ ] Accessible child frames aggregate without duplicate or misattributed findings.
- [ ] Inaccessible frames and closed shadow roots are reported rather than silently ignored.
- [ ] Open-shadow and frame locators resolve exact elements or fail stale.
- [ ] Navigation and meaningful mutation invalidate old overlay/advisory state without automatic background scanning.
- [ ] Service-worker suspension/restart does not corrupt active tab state.
- [ ] Duplicate actions, cancellation, timeouts, tab closure, and late responses are handled coherently.
- [ ] Overlay behaviour survives the fixture matrix without mutating or blocking the inspected page.
- [ ] Documented performance budgets pass in the test environment.
- [ ] The side panel is keyboard operable, focus-correct, contrast-compliant, responsive to narrow widths/text resizing, and appropriately announced by screen readers.
- [ ] Deterministic scanning performs no network requests.
- [ ] AI remains optional, loopback-only, bounded, advisory, and explicit.
- [ ] GitHub remains optional, exact-domain-mapped, narrowly permissioned, and explicit per finding.
- [ ] Device auth, refresh rotation, revocation, optional-permission loss, repository/label changes, rate limits, and worker suspension leave coherent recoverable states.
- [ ] Known duplicate finding actions open the recorded issue; ambiguous create outcomes are not automatically replayed.
- [ ] GitHub issue payloads remain minimal, sanitized, deterministic, and free of AI output and sensitive URL/page data.
- [ ] No forbidden page data persists to long-lived or sync storage.
- [ ] Production manifest and bundle use minimal permissions, keep GitHub origins optional, and contain no secret/private key/token, remote executable code, or telemetry.
- [ ] README, `PRIVACY.md`, and `SECURITY.md` accurately describe implemented behaviour.
- [ ] A reproducible unpacked build and release archive are generated successfully.
- [ ] Formatting, lint, types, all tests, browser tests, accessibility tests, build, and package checks pass or have an accurately reported environmental blocker.

## Explicitly out of scope

- Hosted or consented remote AI.
- WebGPU or bundled browser models.
- Whole-site crawling or authenticated multi-route flows.
- Screen-reader simulation or accessibility certification.
- Source-code mapping or automatic code patches.
- SARIF, CLI, CI/CD, or pull-request integration.
- Team accounts, collaboration, suppressions shared through a backend, or audit history.
- Firefox, Safari, or Edge store releases.
- Telemetry, analytics, billing, or cloud persistence.
- Chrome Web Store submission or publication.

## Completion

Finish the hardening implementation rather than producing only an audit or plan. Run the relevant `/tdd` loops at the named seams, run the entire final verification suite, inspect the built extension, review the complete diff against this specification from the recorded fixed point, fix material findings, and commit the hardened MVP to the current branch with a concise conventional commit message.

In the final report, state:

- what was hardened;
- the commit SHA;
- every verification command and whether it passed;
- the tested fixture/browser matrix;
- observed performance measurements and documented budgets;
- production build and release-archive paths;
- the final extension permissions and why each is necessary;
- any browser or environmental check that could not be executed;
- remaining known limitations, explicitly distinguishing MVP limitations from defects.

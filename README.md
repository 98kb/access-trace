# Accessibility Inspector

A local, deterministic Chrome accessibility inspector built with WXT, React,
TypeScript, and `axe-core`.

## What it promises

- You choose when to scan. Nothing is inspected until you press the button.
- It runs `axe-core` against the page you are actually looking at, including the
  child frames and open shadow roots Chrome lets it reach.
- Every finding maps back to a live element, highlighted in the frame that owns
  it, without changing the page.
- It tells you what it scanned and what it could not, in the panel, every time.
- Everything stays on the device. An optional advisory can be sent to a local
  process you configure, per finding, after you review exactly what would go.

## Honest limitations

- **Automated checks are not certification.** A scan with no findings means no
  findings were detected in the scanned content by the rules that ran. It is not
  proof that a page is accessible.
- **Cross-origin frames may be unreachable.** When Chrome denies access, the
  frame is reported as skipped. The extension does not request broad host access
  to get around it.
- **Closed shadow roots are invisible.** No browser API exposes them to page
  scripts, so their contents are neither scanned nor counted. Every report says
  so.
- **`axe-core`'s own `frame-tested` rule is disabled.** Each frame is scanned
  separately with `iframes: false`, and the Coverage section reports which
  frames were actually reached. Leaving the rule on would emit a "still has to
  be tested" warning for frames the extension did scan.
- **One tab, one session.** Findings are scoped to a tab and cleared when the
  tab closes, the page navigates, or the browser session ends.
- **No crawling, no CI, no history, no remote AI.** See
  [Future scope](#future-scope-not-implemented).

## Prerequisites

- Node.js 22 or newer
- pnpm 10
- Playwright Chromium (`pnpm exec playwright install chromium`) for browser tests
- Python 3 (used to serve `fixtures/` during browser tests)
- Optional: an Ollama-compatible process on loopback, with a model already
  installed, for the AI advisory

## Commands

```sh
pnpm install          # install dependencies (runs wxt prepare)
pnpm dev              # development build with hot reload
pnpm format           # formatting check (pnpm format:write to fix)
pnpm lint             # ESLint
pnpm typecheck        # tsc --noEmit
pnpm test             # unit, component, and accessibility tests (Vitest)
pnpm test:smoke       # test build + full Playwright extension suite
pnpm build            # production build to .output/chrome-mv3
pnpm package          # release archive to .output/*-chrome.zip
pnpm verify:build     # inspect the built manifest, bundle, and archive
```

`pnpm build` writes the unpacked extension to `.output/chrome-mv3`.
`pnpm package` writes `.output/accessibility-inspector-<version>-chrome.zip`
from that same build. The archive is reproducible: deleting `.output` and
rebuilding produces a byte-identical zip (verified with `sha256sum`). Neither
the build directory nor the archive is committed. `pnpm verify:build`
re-reads the build and fails if permissions widen, source maps or dev fixtures
appear, a first-party bundle gains dynamic code evaluation, an unexpected remote
URL appears, or a telemetry vendor is linked in.

## Load the unpacked extension

1. Run `pnpm build`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select `.output/chrome-mv3`.
4. Open a normal HTTP(S) page and click the extension toolbar action.
5. In the native side panel, choose **Scan this page**, then select a finding to
   locate its element.

## Manual verification walkthrough

Serve the fixtures and work through them with the unpacked extension:

```sh
python3 -m http.server 4173 --directory fixtures
```

| Fixture           | What to confirm                                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `violations.html` | Known rule IDs appear; selecting a finding scrolls to and outlines the element without changing it.                                                                   |
| `clean.html`      | The clean state says **No findings detected in scanned content** and states what was scanned. It never claims the page has no defects.                                |
| `frames.html`     | Coverage reads "1 of 2 child frames"; the cross-origin frame is listed as skipped; the frame finding is labelled with its frame URL and highlights inside that frame. |
| `shadow.html`     | The finding inside the open shadow root is found and highlighted. Nothing from the closed root is claimed.                                                            |
| `long.html`       | Selecting the bottom finding scrolls to it and the outline lands on the element.                                                                                      |
| `containers.html` | Outlines track sticky, fixed, transformed, and nested-scroll targets while you scroll.                                                                                |
| `hostile.html`    | The overlay survives a global `all: unset` reset and a 7px root font size, and the page stays clickable and scrollable.                                               |
| `dense.html`      | Many outlines render, but only the selected finding shows a text label.                                                                                               |
| `spa.html`        | Pressing **Go to /details** marks the findings stale and clears the overlay without starting a scan.                                                                  |
| `mutation.html`   | Pressing **Replace the target** then selecting the finding refuses to highlight the look-alike replacement.                                                           |

Inspect the side panel and the page, not just the console.

## Optional local AI advisory

The deterministic scanner works without AI or Ollama. To explain one confirmed
finding with an Ollama-compatible process running on your device:

1. Start the local provider and make sure the model is already installed. The
   extension never downloads models.
2. Open **Local AI**, enable it, choose the loopback host and port, enter the
   exact model name, and set a finite timeout.
3. Approve Chrome's narrowly scoped loopback permission, then choose **Test
   connection**.
4. Scan a page and choose **Explain with local AI** on a violation. Review the
   evidence disclosure, then choose **Send displayed evidence**.

Only these bounded categories can be sent: the Axe rule ID, source, status,
impact, WCAG/best-practice tags, scanner help and failure summary; the live
element's normalized tag name, known semantic role and accessible name,
allowlisted non-sensitive attributes, short visible text, and contrast-related
computed styles for the `color-contrast` rule. The disclosure always states that
screenshots are excluded. Form values, hidden input data, page HTML, scripts,
storage, cookies, request data, history, unrelated page text, and secret-looking
attributes are excluded.

Advisories are validated, rendered as text, kept separate from Axe findings, and
never written to sync storage. "Local" means the evidence goes to the configured
process on your device; it does not mean that process is risk-free.

## Optional GitHub issue creation

Create well-formed GitHub issues directly from deterministic accessibility findings in the side panel:

1. Register a GitHub App with **Metadata: read** and **Issues: read and write** permissions. Enable **Device Flow** and **Expiring user-to-server tokens**.
2. Configure `VITE_GITHUB_APP_CLIENT_ID` in `.env` (using `.env.example` as a template) and run `pnpm build`.
3. Open the options page at `/integrations` (or click **Add issue on GitHub** on a finding card to navigate there).
4. Grant the optional host permission for `https://github.com/*` and `https://api.github.com/*`.
5. Connect your GitHub App via device flow user code.
6. Map an exact domain (e.g. `example.com` or `localhost:3000`) to one accessible GitHub repository and an optional repository label.
7. Click **Add issue on GitHub** on any finding card in the side panel to create a sanitized issue.
8. On success, the action turns into **View GitHub issue** and links directly to the created issue.

### Exact data sent in a GitHub issue

- Finding rule ID, impact, status, help text, help URL, and WCAG tags
- Page origin and sanitized pathname (query strings, hashes, and credentials removed)
- Sanitized element snippet and failure summary
- Scanner name and version (`axe-core x.y.z`)
- Deterministic finding fingerprint marker (`<!-- a11y-scan:finding:{fingerprint} -->`)

No screenshots, full DOM, form values, cookies, headers, local storage, query parameters, or AI output are ever sent to GitHub.

## Permissions

| Permission                                                              | Why it is needed                                                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                                                             | Grants temporary access to the tab you are inspecting, only after you invoke the extension. This is what avoids a broad host permission.            |
| `scripting`                                                             | Injects the scanner into the inspected tab's frames when you press Scan.                                                                            |
| `sidePanel`                                                             | Opens the native side panel used as the whole interface.                                                                                            |
| `storage`                                                               | Session storage for the current tab's scan; local storage for local AI and GitHub integration configuration only.                                   |
| `http://127.0.0.1/*`, `http://localhost/*`, `http://[::1]/*` (optional) | Requested only when you enable local AI, so the background worker can reach the loopback provider you configured. Not present in a default install. |
| `https://github.com/*`, `https://api.github.com/*` (optional)           | Requested only when you connect GitHub in Integrations, so the background worker can perform device auth and post issues.                           |

There are no host permissions in a default installation. `pnpm verify:build` asserts this.

## Architecture

| Concern                                                                  | Location                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Scan and finding contracts (`ScanReportV1`, `FindingV1`, coverage types) | `src/contracts.ts`                                               |
| Coverage model, warnings, and clean-state language                       | `src/coverage.ts`                                                |
| Axe normalization into versioned findings                                | `src/normalize.ts`                                               |
| Per-frame result aggregation and dedupe                                  | `src/aggregate.ts`                                               |
| Frame injection, scan fan-out, selection routing                         | `src/frame-scan.ts`                                              |
| Exact locator resolution across frames and open shadow roots             | `src/locator.ts`                                                 |
| Scan lifecycle: dedupe, cancellation, timeout, late results              | `src/orchestrator.ts`                                            |
| Session-scoped tab state that survives worker suspension                 | `src/tab-state.ts`                                               |
| Page overlay                                                             | `src/overlay.ts`                                                 |
| Documented performance budgets                                           | `src/performance-budgets.ts`                                     |
| Assistant contracts, evidence minimization, loopback provider            | `src/assistant-contracts.ts`, `src/evidence.ts`, `src/ollama.ts` |
| Message contract and runtime validation                                  | `src/messages.ts`                                                |
| Background worker, injected scanner, side panel                          | `entrypoints/`                                                   |

`ScanReportV1`, `FindingV1`, `AssistantRequestV1`, and `AssistantResponseV1`
remain backward compatible. Coverage detail, frame identity, and staleness were
added as optional fields, so a report produced before this release still
validates.

## Performance budgets

`src/performance-budgets.ts` holds the numbers the tests assert:

| Budget                              | Value   | Measured where                                                            |
| ----------------------------------- | ------- | ------------------------------------------------------------------------- |
| Overlay first render, 300 findings  | 500 ms  | jsdom, alongside the rest of the Vitest suite (observed 159–303 ms)       |
| Overlay reposition on scroll/resize | 150 ms  | jsdom, same run (observed 25–42 ms)                                       |
| Deterministic scan of a fixture     | 8000 ms | headless Chromium via Playwright (observed ~0.5 s for `dense.html`)       |
| Findings drawn at once              | 400     | Bounded by the overlay itself; further findings are reported as truncated |

These are calibrated to this repository's test environment. They are not
guarantees about any particular browser, page, or device.

## Troubleshooting

- **"This page is not supported."** `chrome://`, the Web Store, and other
  restricted schemes cannot be scanned by any extension. Try an ordinary
  HTTP(S) or `file://` page.
- **"Page access was denied."** Chrome did not grant the tab. Click the toolbar
  action on the tab you want to inspect, then scan again.
- **A frame is listed as skipped.** It is cross-origin and Chrome will not let
  the extension in. That is reported rather than worked around.
- **"Permission needed for the loopback provider."** Enable local AI and accept
  Chrome's permission prompt; it is requested only at that moment.
- **"The configured model is not installed."** Install the model in your local
  provider first. The extension never downloads models.
- **"These findings are out of date."** The page navigated or a scanned element
  was replaced. Rescan; the extension will not silently highlight a different
  element that happens to match the old selector.
- **The scan timed out or was cancelled.** Both are reported as their own state
  with a retry. Nothing is retried automatically.
- **"Session expired. Please reconnect to GitHub."** Refresh token expired or access was revoked. Reconnect via Integrations options.
- **"Missing repository access or installation."** Verify the GitHub App is installed on the organization/account with access to the target repository.
- **"SAML / Organization restriction."** If your organization requires SAML SSO, grant SAML authorization for the app session.
- **"GitHub API rate limit exceeded."** Wait for the rate limit window to reset before creating further issues or discovering repositories.
- **"Issue creation outcome ambiguous."** A network timeout or connection reset occurred during issue creation. Check your mapped repository's Issues tab to verify whether the issue was created before retrying.
- **"Configured label missing."** The mapped label was not found in the repository. The issue was created successfully without that label.

## Future scope (not implemented)

None of the following exist in this release, and none are planned as part of it:
hosted or consented remote AI, WebGPU or bundled browser models, whole-site
crawling, authenticated multi-route flows, screen-reader simulation,
accessibility certification, source mapping or automatic code patches, SARIF,
a CLI, CI/CD or pull-request integration, team accounts, shared suppressions,
audit history, Firefox/Safari/Edge releases, telemetry, billing, or cloud
persistence.

## Privacy and security

See [PRIVACY.md](./PRIVACY.md) and [SECURITY.md](./SECURITY.md).

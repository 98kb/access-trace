# `/implement` Prompt — Run 4: GitHub Integration

Copy everything below this line into a fresh agent session after Runs 1, 2, and 3 have been completed and committed.

---

/implement

The complete specification for this implementation ticket lives in this prompt. Treat it as one self-contained vertical slice over the completed three-run accessibility-extension MVP. The product and privacy decisions below are settled; implement them without adding a hosted backend, broad OAuth scopes, generalized integrations, or unrelated collaboration features.

## Goal

Add an explicit, user-configured GitHub issue workflow:

> A user can open the extension options page at `/integrations`, connect a narrowly permissioned GitHub App, map an exact website domain to one accessible repository and an optional existing repository label, then create a well-formed GitHub issue directly from a deterministic finding in the side panel.

GitHub is the first intentional off-device product integration. Ordinary scanning and local AI behaviour must remain unchanged. No page or finding data may be sent to GitHub until the user has configured a mapping and activates **Add issue on GitHub** for that finding.

## Prerequisites and repository behaviour

- Read and follow `AGENTS.md`, `CLAUDE.md`, repository conventions, and the implementations from Runs 1, 2, and 3.
- Work on the current branch. Do not create or switch branches, push, publish, register a production GitHub App, or open a pull request.
- Verify the completed three-run MVP—including its deterministic scanner, optional local-AI boundary, and existing hardening—before changing it.
- Required existing capabilities: versioned scan/finding contracts, side-panel finding cards, service-worker/background messaging, explicit active-tab scans, synchronized overlay, fixture/browser tests, optional loopback-only AI contracts, and the resilience/privacy work already established by Run 3.
- If a prerequisite is absent or materially broken, stop and report it rather than rebuilding earlier runs or weakening this ticket.
- Record the pre-run commit as the fixed comparison point for final review.
- Preserve unrelated user changes.

## Locked product decisions

- Add a WXT options-page entrypoint with a small route shell. The only implemented route is `/integrations`; do not invent other settings sections.
- Use GitHub.com only in this run. GitHub Enterprise Server and arbitrary API hosts are out of scope.
- Authenticate through a GitHub App using OAuth device flow. The extension is a public client: use the public GitHub App client ID and never ship, request, persist, or document a client secret or private key.
- Configure the GitHub App with only repository **Metadata: read** and **Issues: read and write** permissions. Do not request broad OAuth `repo` scope.
- Keep user-to-server token expiration enabled. Persist and rotate the access/refresh token pair returned by device flow so a user normally remains connected across extension restarts. If refresh expires or authorization is revoked, require reconnection.
- Put GitHub login/API origins in `optional_host_permissions` and request them from the Connect GitHub user gesture. Do not broaden existing page host access.
- Store mappings and credentials only in `chrome.storage.local`, never sync storage. Treat Chrome local storage as local persistence, not as a hardware-backed keychain; document that boundary honestly.
- The background/service worker owns credentials and all authenticated GitHub calls. Never send a token to the content script, inspected page, side panel, options UI, logs, error reporting, query strings, or assistant provider.
- A domain has exactly one repository mapping and zero or one label in v1.
- The label is selected from existing labels in that mapped repository. Allow **No label**. Do not create, rename, or delete repository labels.
- After a valid mapping exists, the finding action is one-click issue creation. Do not add a modal or a second confirmation. The click itself is explicit consent to send the disclosed issue fields.
- Do not automatically file issues, batch findings, create pull requests, post comments, synchronize issue status, upload screenshots, or add AI advisory text.

## GitHub App setup and developer configuration

Read the current official GitHub documentation while implementing and pin the REST API version header to the repository's chosen current version. Implement the documented protocol rather than depending on an unreviewed auth SDK.

Support build-time public configuration for at least:

- GitHub App client ID;
- GitHub App installation URL or app slug, if needed for the install step.

Use the repository's WXT environment convention and provide a checked-in `.env.example` with placeholders. A client ID is public configuration; it is not a secret. Fail closed when it is missing: the Integrations page must explain that the build has not configured GitHub rather than attempting requests with an empty value.

Update the README with concise GitHub App registration instructions:

- enable device flow;
- enable expiring user-to-server tokens;
- request Metadata read and Issues read/write only;
- allow installation on selected repositories;
- configure the public client ID/build variable;
- never place a client secret or private key in the extension;
- explain how to load the unpacked build and test with a throwaway repository.

Do not create real credentials or require real credentials for the automated test suite.

## Versioned contracts

Introduce runtime-validated, serializable contracts with exact names adjusted only to established repository naming conventions. Keep secrets out of UI-facing contracts.

### `GitHubConnectionViewV1`

Non-sensitive connection state exposed to the options page and side panel:

- `schemaVersion: "1.0"`;
- discriminated state: `not-configured`, `disconnected`, `connecting`, `connected`, `expired`, or `error`;
- connected GitHub user ID, login, display name, and avatar URL when available;
- token expiry timestamp when available, but no token values;
- a stable typed error code and user-safe message where relevant.

### `GitHubCredentialV1`

Background-internal persisted credential record:

- `schemaVersion: "1.0"`;
- access token, access-token expiry, refresh token, refresh-token expiry, token type, GitHub user ID, and last-updated timestamp;
- runtime validation and migration/fail-closed handling;
- never export this type from a UI-facing barrel or include it in a runtime response.

### `DomainRepositoryMappingV1`

- `schemaVersion: "1.0"`;
- canonical `domainKey`;
- GitHub installation ID;
- repository numeric ID, owner, name, `fullName`, and HTML URL;
- optional label numeric ID, name, and colour;
- created/updated timestamps.

The canonical domain key is the exact lower-cased URL host. It excludes scheme, path, query, and fragment; includes a non-default port; keeps `www` distinct; and performs no wildcard, parent-domain, or subdomain inheritance. Treat `localhost:3000` and `localhost:4000` as different keys. Reject unsupported/special URLs using the same explicit URL support rules as scanning.

### Runtime requests and results

Define versioned request/result messages for:

- starting, observing, and cancelling device authorization;
- reading non-sensitive connection state;
- disconnecting;
- listing installations/repositories available to both the app and user;
- listing labels for a selected repository;
- listing, saving, and removing domain mappings;
- creating an issue from a finding;
- opening the integrations route for the current domain.

The side-panel create request should contain identifiers such as tab ID, scan ID, finding ID, and a client-generated operation ID—not a token or an arbitrary issue body. The background must validate the current tab URL, mapping, current scan, and finding, then build the sanitized payload itself. Unknown contract versions, stale scans, missing mappings, mismatched domains, and unavailable repositories must fail closed with typed outcomes.

## Authentication state machine

Implement GitHub App device flow in the background:

1. Request optional GitHub origin permission from the options-page Connect GitHub user gesture.
2. `POST https://github.com/login/device/code` with the public client ID and request JSON responses.
3. Return only the verification URI, user code, expiry, and polling state to the options UI; keep the device code background-owned.
4. Show the user code with a copy action and an **Open GitHub** action to the fixed verification URI.
5. Poll `POST https://github.com/login/oauth/access_token` no faster than GitHub's returned interval.
6. Treat `authorization_pending` as non-terminal, add five seconds after `slow_down`, and handle cancellation, denial, expiry, invalid client/device code, device-flow-disabled, network failure, and malformed responses explicitly.
7. On success, validate the token using `GET /user`, persist the rotated credential record, and expose only the non-sensitive connection view.
8. Discover accessible app installations and repositories using GitHub's user-installation endpoints. If no repository is available, explain that the GitHub App must be installed or granted repository access and provide the configured install action.

Refresh an expiring user token before an authenticated call when it is near expiry, using the refresh-token grant documented for tokens originally created by device flow. Serialize refresh so concurrent requests cannot reuse a one-time refresh token. Persist the newly rotated access and refresh tokens atomically. On `401`, perform at most one controlled refresh/retry when eligible; otherwise clear unusable credentials and move to `expired`/reconnect state. Never loop retries.

On Disconnect, cancel active auth/API work, delete the credential record, and clear non-sensitive cached identity/repository/label data. Retain domain mappings as inert local configuration so reconnecting can restore them if access still exists; allow users to remove mappings independently.

## Options page at `/integrations`

Build an accessible options-page shell whose application route is `/integrations`. Hash routing such as `options.html#/integrations` is acceptable when required by the packaged-extension entrypoint; direct options-page navigation and an in-extension **Open integration settings** action must still land on that route. With only one route, keep navigation minimal and label the page **Integrations**.

The GitHub integration UI must cover:

- not configured in this build;
- optional host permission not granted;
- disconnected;
- device authorization in progress, including code, copy/open actions, expiry, cancel, and restart;
- connected identity;
- no GitHub App installation or no accessible repository;
- expired/revoked credentials;
- recoverable API/rate-limit/network error;
- disconnect action.

Below the connection card, show domain mappings:

- list existing mappings with domain, `owner/repo`, optional label, Edit, and Remove;
- add/edit form with an exact-domain input, accessible repository selector, label selector, Save, and Cancel;
- accept an optional prefilled domain passed through extension-owned state when opened from the side panel; do not put page data or tokens in the URL;
- load labels only after a repository is selected;
- make **No label** the default;
- validate uniqueness by canonical domain key and update intentionally rather than silently duplicating;
- if a stored repository or label is no longer accessible, show it as unavailable and require a valid replacement before saving edits.

Repository and label selectors must be keyboard operable and usable with long organization/repository names. Avoid building a custom combobox unless the repository already has an accessible one.

## Finding-card action

Add an icon-only action to every deterministic finding item in the side panel.

- Accessible name and tooltip copy: **Add issue on GitHub**.
- Use an existing local icon system or a small bundled inline SVG with `aria-hidden="true"`; do not load remote icon assets.
- Do not hide the action merely because configuration is absent. In disconnected/unmapped states, activating it opens `/integrations` with the current exact domain prefilled and a concise explanation of what must be configured.
- When authenticated and mapped, one activation creates the issue directly.
- Disable only while that finding's create operation is in progress and expose a useful busy/status announcement.
- Prevent rapid repeated activation from submitting duplicate requests.
- On success, change the action for that finding to **View GitHub issue** and open the returned issue HTML URL safely on activation.
- On a definite failure, keep an explicit retry path and a concise typed message.
- On an ambiguous network outcome after submission, do not retry automatically. Warn that the issue may have been created and offer a safe link to the mapped repository's Issues page.

Do not change finding selection or overlay synchronization when the action is used. Stop event propagation where needed so creating/viewing an issue does not select a different finding unexpectedly.

## Deterministic issue payload

Build issue content in one pure, well-tested module. Do not accept arbitrary Markdown from the UI.

Title format:

`[Accessibility] {finding help/title} — {pathname}`

Keep within GitHub limits and truncate deterministically without removing the rule identity.

Body should contain only the minimum useful reproducible evidence:

- accessibility rule ID and impact;
- Axe help text and stable help URL;
- applicable WCAG tags exposed by the deterministic engine;
- page origin and pathname with username/password, query, and fragment removed;
- a short text-escaped/sanitized element snippet already permitted by the finding contract;
- failure summary/check text;
- scan engine/source and version;
- a short note that automated results require human review;
- a hidden deterministic marker such as `<!-- a11y-scan:finding:{fingerprint} -->`.

Do not include screenshots, the full DOM, form values, cookies, headers, local storage, query strings, URL fragments, AI prompts/responses, unrelated findings, or surrounding page text. Treat all page-derived strings as untrusted Markdown: prevent accidental mentions, issue references, task-list injection, fenced-block breakouts, and HTML execution while preserving legibility.

Send `POST /repos/{owner}/{repo}/issues` with the mapped label name only when configured. GitHub may silently omit a label when the authenticated user lacks sufficient repository permission. Inspect the returned issue: if the configured label is absent, still treat creation as successful but report **Issue created without the configured label** and update mapping UI state if revalidation shows the label is unavailable.

## Duplicate control and operation lifecycle

Compute a deterministic finding fingerprint from stable, normalized fields such as repository ID, domain key, sanitized pathname, rule ID, and normalized exact locator. Do not include scan ID or volatile timestamps. Hash the canonical form before persistence.

- Include the fingerprint marker in the issue body.
- Persist a small local success record keyed by fingerprint with issue number, HTML URL, repository ID, and timestamp; do not persist the raw element snippet or page evidence.
- A later click for a known successful fingerprint opens the existing issue instead of creating another.
- Use a per-finding operation ID and in-memory/in-session in-flight registry to collapse duplicate clicks.
- Do not search all repository issues before every create in this MVP.
- Do not automatically retry `POST` after a timeout, connection reset, worker suspension, or other outcome where GitHub may have accepted the request.
- Expire or bound success records with a documented policy so local storage cannot grow without limit.

## Privacy and security boundary

Update `PRIVACY.md` and relevant UI copy to distinguish three paths:

1. deterministic scans remain on-device and make no network request;
2. optional AI remains explicit and loopback-only under the existing contract;
3. GitHub receives data only after connection, domain/repository mapping, and the user's per-finding issue action.

Before Save on a domain mapping, disclose the exact issue fields that may be sent. Do not imply GitHub is local. Link to the project's privacy text without fetching remote content.

Enforce:

- fixed HTTPS GitHub hosts and endpoints; no user-controlled API base URL or redirect following to another origin;
- standard GitHub API headers and runtime validation of every response;
- request timeouts and cancellation where supported;
- redacted errors and logs;
- no token interpolation into URLs;
- no token, user code, device code, page evidence, or issue body in analytics or persistent debug logs;
- no GitHub data in `chrome.storage.sync`;
- no GitHub capability or credential access in content scripts;
- no remote executable code;
- message sender/context validation and exhaustive operation allowlists.

## Test-driven implementation seams

Use fakes for GitHub transport, clocks, storage, browser permissions, and tab/scan state. Automated tests must never contact GitHub or require credentials.

Drive TDD at these observable seams:

1. **Domain seam** — URL-to-domain canonicalization is exact, lower-cased, port-aware, and rejects unsupported URLs; mapping lookup never leaks across `www`, subdomains, or localhost ports.
2. **Device-flow seam** — permission request, code display, interval polling, `slow_down`, success, cancel, denial, expiry, malformed response, and device-flow-disabled states are deterministic under a fake clock.
3. **Credential seam** — credentials remain background-internal, rotate atomically, serialize refresh, clear on unrecoverable auth failure, and never appear in messages/log snapshots.
4. **Discovery seam** — only installations/repositories available to both app and user appear; missing install/access and pagination are represented truthfully.
5. **Mapping/label seam** — add, edit, remove, uniqueness, inaccessible repository, deleted/renamed label, No label, and persistence behave exactly.
6. **Payload seam** — issue title/body contain the allowed deterministic fields, strip URL secrets/query/fragment, neutralize hostile Markdown/page strings, exclude AI and sensitive page data, and apply an optional valid label.
7. **Create seam** — background validates tab/domain/scan/finding, posts once, handles success/missing returned label/typed failure/ambiguous outcome, and never blindly retries.
8. **Duplicate seam** — repeated clicks, late responses, worker lifecycle seams, and a later scan with the same stable finding do not create known duplicates.
9. **Side-panel seam** — icon action has the exact accessible name/tooltip, opens configuration when needed, announces progress/result, becomes View on success, and does not disturb selection/overlay state.
10. **Privacy seam** — ordinary scan and AI paths are unchanged; GitHub network calls occur only during explicit connection/configuration/create actions; forbidden values never cross or persist at the wrong boundary.

Add focused component/browser coverage for the options route, auth states, mapping form, finding action, and success/failure interaction. Assert public behaviour and contracts rather than private component structure or live GitHub markup.

## Documentation

Update README and privacy/security documentation with:

- enabling and configuring the GitHub App for development;
- the exact permissions and optional host origins;
- connecting, installing, mapping a domain, choosing a label, creating an issue, and disconnecting;
- token storage/expiration/revocation behaviour;
- the exact data sent in an issue;
- label permission caveat;
- duplicate-control and ambiguous-outcome behaviour;
- troubleshooting missing repositories, SSO restrictions, revoked access, expired authorization, rate limits, and deleted labels;
- current limitations and future scope clearly marked as unimplemented.

## Explicitly out of scope

- Hosted auth/token broker or any project backend.
- OAuth App `repo` scope, personal access token paste, GitHub private keys, or installation-token generation.
- GitHub Enterprise Server or configurable API hosts.
- Multiple repositories per domain, wildcard domain rules, path-based routing, or organization-wide defaults.
- Creating/managing labels, assignees, milestones, projects, issue templates, comments, pull requests, or attachments.
- Bulk/automatic issue creation, bidirectional sync, issue closing, webhooks, polling issue state, or cross-device sync.
- Adding AI guidance or AI-authored remediation to the issue.
- General integration framework or providers other than GitHub.

## Final verification

Run the repository-standard equivalents of:

- formatting or formatting check;
- lint;
- TypeScript type-check;
- focused tests during each TDD slice;
- full unit/component suite;
- extension browser/end-to-end suite;
- production build and manifest inspection.

Manually exercise the unpacked extension with a development GitHub App and throwaway repository if credentials and browser interaction are available. Test connect, cancel, reconnect, installation discovery, domain mapping, label selection, issue creation, View action, disconnect, expired/revoked access, and an unmapped domain. Delete any throwaway issue if appropriate. If the environment blocks live GitHub verification, keep deterministic fakes and a precise manual procedure in the repository and report the blocker without claiming the live path passed.

Inspect the production manifest and bundle to confirm that GitHub origins are optional, no client secret/private key/token is embedded, no remote executable code was added, and deterministic scans still perform no network request.

## Acceptance criteria

- [ ] The WXT options page opens directly at `/integrations` and contains no invented settings sections.
- [ ] A user can connect via GitHub App device flow without any client secret or private key in the extension.
- [ ] Auth polling, cancellation, expiry, refresh rotation, revocation, and reconnect states are explicit and tested.
- [ ] Only narrowly accessible installations/repositories are offered.
- [ ] An exact canonical domain maps to one repository and an optional existing label.
- [ ] Domain matching does not inherit across `www`, subdomains, schemes, paths, or ports.
- [ ] The finding action has tooltip/accessibility text **Add issue on GitHub** and opens configuration when connection or mapping is missing.
- [ ] With a valid mapping, one click creates one sanitized deterministic issue and returns a safe View action.
- [ ] The issue excludes AI output, URL query/fragment, full DOM, form values, screenshots, and unrelated page data.
- [ ] Missing label permission/deleted labels do not hide a successful issue and are reported truthfully.
- [ ] Duplicate clicks and known repeat findings do not create duplicate issues; ambiguous POST outcomes are never automatically retried.
- [ ] Tokens remain background-owned, local-only, redacted, rotated atomically, and cleared when unusable or disconnected.
- [ ] GitHub receives no finding data until the user activates the per-finding action.
- [ ] Ordinary deterministic scanning remains local and optional AI remains loopback-only.
- [ ] README, `.env.example`, `PRIVACY.md`, and security documentation match the implemented integration.
- [ ] Formatting, lint, types, tests, browser tests, production build, and manifest/bundle inspections pass or have an accurately reported environmental blocker.

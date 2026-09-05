# Accessibility Inspector

A local, deterministic Chrome accessibility inspector built with WXT, React, TypeScript, and axe-core.

## Requirements

- Node.js 22 or newer
- pnpm 10
- Playwright Chromium (`pnpm exec playwright install chromium`) for the smoke test

## Develop and verify

```sh
pnpm install
pnpm dev
```

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:smoke
```

The smoke build grants access only to `http://127.0.0.1/*` so Chromium can exercise the real injection boundary without a manual toolbar click. Production builds do not include that host permission.

## Load the unpacked extension

1. Run `pnpm build`.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select `.output/chrome-mv3`.
4. Open a normal HTTP(S) page and click the extension toolbar action.
5. In the native side panel, choose **Scan this page**, then select a finding to locate its element.

For deliberate examples, serve `public/fixtures` over HTTP (for example, `python3 -m http.server 4173 --directory public/fixtures`) and open `http://127.0.0.1:4173/violations.html`.

The scanner runs only after explicit user action. It sends no page data off-device, and a clean automated scan does not prove WCAG compliance.

## Optional local AI advisory

The deterministic scanner works without AI or Ollama. To explain one confirmed
finding with an Ollama-compatible process running on your device:

1. Start the local provider and make sure the model is already installed (for
   example, a model named `example-model:latest`). The extension never downloads
   models.
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
computed styles for the `color-contrast` rule. The disclosure always states
that screenshots are excluded. Form values, hidden input data, page HTML,
scripts, storage, cookies, request data, history, unrelated page text, and
secret-looking attributes are excluded.

Advisories are validated, rendered as text, kept separate from Axe findings,
and not stored in sync storage. “Local” means the evidence goes to the configured
process on your device; it does not mean that process is risk-free.

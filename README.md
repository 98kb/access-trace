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

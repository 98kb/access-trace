# Privacy

Accessibility Inspector is a local Chrome extension. It has no accounts, no
servers, and no analytics. This document describes what actually happens when
you use it.

## What the extension reads

When you start a scan, the extension runs `axe-core` against the page you are
looking at: the top document and every child frame Chrome lets it reach. From
that run it keeps, for each finding:

- the rule identifier, severity, WCAG/best-practice tags, and the scanner's own
  help text and failure summary;
- a CSS/frame/shadow path to the element;
- a bounded HTML snippet of the element, with `value` attributes and
  `<textarea>` contents replaced by `[redacted]`;
- which frame the finding belongs to, and that frame's URL;
- the page URL and title.

## When it scans

Only when you choose **Scan this page** or **Rescan**. There is no background
scanning, no scanning on page load, no scanning on DOM changes, and no
automatic retry. When the page navigates or a scanned element is replaced, the
extension marks the existing results stale and asks you to rescan; it does not
rescan on its own.

## What stays in the browser

Scan reports, evidence previews, and page URLs live in Chrome's **session**
storage, scoped to the tab. They are removed when the tab closes, when the page
navigates, and when the browser session ends. They are never written to `sync`
storage and never leave the device.

The only value kept in long-lived local storage is your local AI configuration:
whether the feature is enabled, the loopback host, the port, the model name, and
the timeout. No page content is stored there.

## The three privacy boundaries

1. **Deterministic scans remain on-device:** Standard scanning makes no network request whatsoever. Page content stays entirely inside Chrome session storage.
2. **Optional local AI remains explicit and loopback-only:** Evidence is sent only after explicit confirmation per finding to the configured loopback process on your device.
3. **GitHub Integration requires user setup and per-finding action:** Data is sent to GitHub only after you connect a GitHub App, map an exact domain to a repository, and explicitly activate **Add issue on GitHub** for a specific finding.

## What can be sent to GitHub

When you activate **Add issue on GitHub** for a finding on a mapped domain, the extension sends only:

- Finding rule ID, impact, status, help text, help URL, and WCAG tags
- Page origin and sanitized pathname (query parameters, URL fragments, username, and password removed)
- Text-escaped element snippet and failure summary
- Scanner engine name and version (`axe-core x.y.z`)
- Hidden deterministic finding fingerprint marker (`<!-- a11y-scan:finding:{fingerprint} -->`)

No screenshots, full DOM, form values, cookies, headers, local storage, query parameters, or AI advisory text are ever sent to GitHub. Authentication tokens are stored strictly in `chrome.storage.local` in the background service worker and are never sent to content scripts, inspected pages, side panels, options UI, or persistent debug logs.

## What is never collected

- No telemetry, analytics, crash reporting, or usage metrics.
- No accounts, identifiers, or cookies.
- No screenshots.
- No form values, hidden input values, `<textarea>` contents, or
  secret-looking attribute values.
- No page HTML beyond the bounded, redacted element snippet.
- No storage, cookies, request data, or browsing history.
- No page data at all during an ordinary deterministic scan: that path makes no
  network request whatsoever.

## Current limitations

- Cross-origin frames that Chrome will not let the extension into are reported
  as skipped. Their contents are not scanned and not read.
- Closed shadow roots cannot be detected by page scripts, so anything inside one
  is neither scanned nor reported as present.
- Coverage is reported per scan. Read the **Coverage** section in the panel
  before treating a clean result as meaningful.

## Automated scanning is not certification

A scan with no findings means no findings were detected in the content that was
scanned by the rules that ran. It is not proof that the page is accessible, and
it is not a WCAG conformance claim. Manual testing with people and assistive
technology remains necessary.

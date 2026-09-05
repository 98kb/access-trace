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

## What can be sent to a configured local process

Nothing is sent anywhere unless you enable local AI, grant Chrome's loopback
permission, choose **Explain with local AI** on a single violation, review the
displayed evidence, and then choose **Send displayed evidence**.

Only what the preview shows is sent, to the loopback address you configured:

- the rule identifier, source, status, severity, tags, help text, and failure
  summary of that one finding;
- the element's tag name, semantic role, accessible name, allowlisted
  non-sensitive attributes, short visible text, and, for `color-contrast` only,
  the relevant computed colours and font metrics.

The request goes to `http://127.0.0.1`, `http://localhost`, or `http://[::1]` on
the port you set. Other hosts are rejected before a request is made, and
redirects are refused. "Local" means the process runs on your machine; it does
not mean that process is risk-free.

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

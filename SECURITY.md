# Security

## Reporting a vulnerability

Please report suspected vulnerabilities by opening an issue in this
repository's issue tracker. If the repository has no public issue tracker
configured, contact the maintainer through the channel listed in the
repository's project metadata.

> **Maintainer TODO:** replace this section with a private disclosure address
> before publishing the extension anywhere. No contact address is invented here.

Please include the extension version, Chrome version, the page or fixture that
reproduces the problem, and what you observed. Do not include page content that
you are not free to share.

## Trust boundaries

### Page content is untrusted

Everything read from an inspected page — element HTML, attributes, text, frame
URLs, rule output — is treated as untrusted data:

- it is rendered as text only; there is no `dangerouslySetInnerHTML`, no
  `innerHTML` assignment, and no HTML sink in extension pages;
- extension pages run under a Content Security Policy that pins `script-src` to
  `'self'` and forbids objects, base URI changes, and form submission;
- the bundle contains no remotely loaded script, no dynamic import of a remote
  URL, and no analytics dependency; `pnpm verify:build` asserts this against the
  built output;
- when page-derived evidence is sent to a local model, it is wrapped in explicit
  untrusted-evidence delimiters and the system instruction forbids treating it
  as instructions. Model output is schema-validated and rendered as text.

### The local AI provider is untrusted

The optional provider is an ordinary HTTP server on your machine:

- the host must be one of `127.0.0.1`, `localhost`, or `[::1]`; anything else is
  rejected before a request is made;
- Chrome's loopback host permission is optional and requested only when you
  enable the feature;
- redirects are refused rather than followed;
- every request has a finite timeout and can be cancelled;
- responses are parsed and validated against a fixed schema, and a response that
  fails validation is reported as an error rather than displayed;
- an advisory never modifies a deterministic finding, its severity, or its
  standards references.

### Extension messages are validated

Every message crossing the panel/background/scanner boundary is versioned and
runtime-validated. Unknown message types, unknown schema versions, and
unexpected fields are rejected. The background worker accepts panel operations
only from this extension's own pages, and accepts staleness reports only from an
injected scanner running in a tab. Frame results that answer for a superseded
scan are discarded.

### Storage

Page-derived data (scan reports, evidence previews) is written only to Chrome
session storage, keyed by tab, and cleared on tab close, navigation, and session
end. Nothing page-derived is written to `local` or `sync` storage. See
[PRIVACY.md](./PRIVACY.md).

## Known accepted risks

- `axe-core` bundles its own template engine, which uses `new Function` on
  strings it ships with. This is bundled, local, reviewable code, not remote
  code. `pnpm verify:build` reports it explicitly rather than hiding it, and
  fails if dynamic evaluation appears in any first-party bundle.
- A cross-origin frame the extension cannot enter is reported as skipped. The
  extension does not request broad host access to work around this.

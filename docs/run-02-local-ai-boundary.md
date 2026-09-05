# `/implement` Prompt — Run 2: Local AI Advisory Boundary

Copy everything below this line into a fresh agent session after Run 1 has been completed and committed.

---

/implement

The complete specification for this implementation ticket lives in this prompt. Treat it as one self-contained tracer-bullet ticket. The product and privacy decisions below are settled: do not reopen the plan, interview me, introduce a remote provider, or redesign the deterministic scanner.

## Goal

Add an optional, explicitly invoked local-AI advisory capability to the existing Chrome accessibility inspector:

> From one confirmed deterministic finding, a user can preview the bounded evidence, ask a locally running Ollama-compatible model for an explanation and remediation guidance, and receive a validated advisory without changing the scanner's finding or sending unrelated page content.

The deterministic Axe result remains the source of truth. AI explains evidence; it does not become a scanner, compliance authority, or autonomous decision-maker.

## Prerequisites and repository behaviour

- Read and follow `AGENTS.md`, `CLAUDE.md`, repository conventions, and the implementation from Run 1.
- Work on the current branch. Do not create or switch branches, push, publish, or open a pull request.
- Verify that the Run 1 vertical slice exists and passes before changing it: versioned `ScanReportV1`/`FindingV1`, Axe scan, side-panel findings, synchronized overlay, fixture coverage, and a production extension build.
- If those prerequisites are absent or materially broken, stop and report the mismatch. Do not silently rebuild Run 1 or weaken its tests.
- Preserve unrelated user changes.
- Use the repository's existing package manager and commands.

## Locked product and privacy decisions

- AI is optional and user-invoked per finding.
- The extension remains fully functional with AI disabled or unavailable.
- Ollama-compatible localhost inference is the only concrete provider in this run.
- Add no hosted provider, OpenAI integration, Hugging Face inference endpoint, telemetry, account system, API-key storage, or arbitrary custom remote URL.
- The local provider endpoint must be restricted to loopback hosts. Do not accept LAN IPs, public hosts, redirects to non-loopback hosts, or page-provided endpoints.
- Do not send an entire document, raw page HTML, screenshot, form state, hidden content, scripts, stylesheets, cookies, storage, request data, or browser history to the model.
- The model's response is advisory metadata attached to a finding. It must never change `violation` to pass, convert `needs-review` into a confirmed violation, suppress findings, or claim compliance.
- No AI call may start automatically after a scan, selection, navigation, or extension startup.

## Stable, versioned assistant contract

Create a provider-neutral `AssistantRequestV1` and `AssistantResponseV1`. Keep them in the same contract layer as the scan contract without importing Chrome, React, Ollama, or transport-specific types.

`AssistantRequestV1` must include at least:

- `schemaVersion: "1.0"`
- `operation: "explain-finding"`
- a bounded subset of the selected deterministic finding: rule ID, source, status, impact, WCAG/best-practice tags, scanner help, and failure summary
- `ElementEvidenceV1`
- an explicit disclosure descriptor stating that execution is local and whether any screenshot is included; screenshots must always be false in this version
- preferred response language if the application already has a locale seam; otherwise keep English only

`ElementEvidenceV1` must be structured data, not an arbitrary HTML dump. Include only fields the implementation can justify, such as:

- normalized tag name
- semantic role, when known
- computed accessible name, when known
- a small allowlisted attribute map
- short visible-text excerpt
- short nearby-text excerpt only when needed to understand the scanner evidence
- relevant computed style values only for rules that depend on them

Define hard limits for every string, collection, and total serialized request size. Exclude or redact at minimum:

- form-control values and user-entered text;
- `value`, `checked`, `selected`, and similar mutable state;
- hidden-input data;
- cookies, local/session storage, URLs containing credentials, and request headers;
- event-handler attributes and script content;
- attributes whose names or values resemble tokens, secrets, authorization, sessions, passwords, keys, or personal data;
- unrelated ancestors, siblings, and page text.

`AssistantResponseV1` must include at least:

- `schemaVersion: "1.0"`
- concise summary
- evidence-grounded rationale
- one or more remediation options
- missing evidence or manual checks still required
- bounded confidence value
- explicit advisory status

Do not let the provider invent authoritative WCAG mappings or help URLs. Standard references displayed by the product must come from the deterministic scanner contract.

Validate requests before dispatch and responses before display with the repository's existing validation approach, or add a focused schema library if none exists. Unknown versions, extra unsafe payload fields, oversized inputs, malformed model output, and unsupported operations must fail closed.

## Provider seam

Introduce a narrow `AssistantProvider` seam with observable operations equivalent to:

- identify provider and capabilities;
- check availability;
- execute one typed request with cancellation and timeout support.

Do not leak Ollama wire types through this interface.

Implement an `OllamaAssistantProvider` that:

- defaults to a loopback endpoint such as `http://127.0.0.1:11434`;
- allows only a tightly validated loopback hostname and port configuration;
- uses an Ollama chat/generation endpoint capable of structured JSON output;
- sends a system instruction that treats all page-derived evidence as untrusted quoted data, never as instructions;
- asks for output conforming to the response schema;
- validates the actual response independently of what was requested;
- supports `AbortSignal` cancellation and a finite configurable timeout;
- reports unavailable server, missing model, rejected permission, timeout, cancellation, HTTP failure, invalid JSON, and invalid-schema output as distinct typed failures;
- never follows a redirect to a non-loopback destination;
- never retries generation invisibly.

The model name must be user-configurable. Do not silently download a model or hardcode the previously discussed Hugging Face accessibility model. Provide a neutral example model string only in documentation, not as an unchangeable runtime assumption.

Use optional host permission for loopback access if Chrome requires it. Request permission only when the user enables or tests the local provider, and explain why it is needed. Do not add `<all_urls>`.

## Evidence builder and prompt-injection boundary

Build `ElementEvidenceV1` from the current selected finding and live element through a dedicated evidence-builder seam.

Requirements:

- Re-resolve the current-scan `nodeRef`; do not accept element evidence supplied by the inspected page's own JavaScript.
- Apply allowlisting and redaction before data reaches the provider.
- Bound the serialized request before dispatch.
- Treat all strings derived from the page as hostile data, including text that resembles system prompts, JSON, Markdown, or tool instructions.
- Clearly delimit evidence in the provider prompt.
- The provider has no tools, browser actions, extension commands, or write access.
- Render the returned explanation as plain text or safe UI components. Never use unsanitized HTML or `dangerouslySetInnerHTML`.

## User experience

Extend the side panel without disrupting the Run 1 scan workflow.

Add:

- A local-AI settings section with enable/disable state, loopback endpoint/port, model name, timeout, and **Test connection**.
- Clear states for disabled, permission needed, checking, available, unavailable, and invalid configuration.
- An **Explain with local AI** action on eligible findings.
- A compact evidence-preview disclosure before the first request and whenever the evidence categories change.
- Progress and cancellation while generating.
- A clearly labelled **AI advisory** result, separate from the deterministic finding.
- Summary, rationale, remediation options, confidence, and manual checks from the validated response.
- Retry only through an explicit user action.
- A way to dismiss the advisory without changing the underlying finding.

Do not imply that localhost means risk-free. State accurately that the extension sends the displayed evidence to the configured process on the user's device.

Store provider settings in extension local storage. Never store page evidence or generated advisories in sync storage. Prefer tab/session-scoped storage for current advisories and clear them when the associated scan becomes stale or the tab closes.

## Pre-agreed test seams

Drive TDD at these observable seams:

1. **Evidence-builder seam** — a selected live element and finding become an exactly bounded, allowlisted, redacted `ElementEvidenceV1`.
2. **Contract seam** — safe V1 requests and responses parse; oversized, malformed, unknown-version, and unexpected-operation payloads fail closed.
3. **Provider seam** — a fake transport proves request mapping, structured-response parsing, loopback enforcement, redirect rejection, timeouts, cancellation, and typed errors without requiring a real Ollama installation.
4. **Prompt-injection seam** — hostile element text remains quoted evidence and cannot alter the requested operation, schema, system instruction, or displayed rendering.
5. **User seam** — enabling the provider, requesting optional permission, testing connection, previewing evidence, generating, cancelling, handling failure, and displaying a valid advisory are operable through rendered controls.
6. **Deterministic-integrity seam** — generating, failing, dismissing, or replacing an advisory never mutates the original finding status, evidence, impact, rule, or scan totals.

Test public behaviour rather than private helper implementation. Use a fake provider or fake HTTP transport for automated tests. A developer's missing Ollama process must not make the normal test suite fail.

## Security and regression fixtures

Add fixtures or test cases containing:

- Element text saying “ignore previous instructions.”
- Element text containing JSON shaped like an assistant response.
- Secret-looking and authorization-looking attributes.
- Password and hidden inputs with values.
- Very large text and attribute payloads.
- Malformed, truncated, extra-field, and wrong-version model responses.
- Slow and never-resolving provider responses.
- Loopback endpoints that redirect to public or LAN addresses.

Prove through assertions that unsafe fields do not enter the assistant request and unvalidated model output does not render as trusted advice.

## Verification

Run the repository-standard equivalents of:

- formatting or formatting check
- lint
- TypeScript type-check
- focused tests during each TDD slice
- complete unit/component suite once at the end
- production extension build
- existing Run 1 browser smoke test
- new browser/component flow using a fake local provider

If a real local Ollama process is available, perform one optional manual smoke test against it and document the model used. The implementation and test result must not depend on Ollama being installed.

Inspect the rendered settings, disclosure, loading, error, cancellation, and advisory states. Verify keyboard operation, focus management, status announcements, readable wrapping of code/text, and WCAG AA contrast.

## Acceptance criteria

- [ ] The extension remains fully usable with AI disabled and without Ollama installed.
- [ ] The assistant contracts are provider-neutral, versioned, bounded, and runtime-validated.
- [ ] Only one selected finding's minimized evidence can enter an AI request.
- [ ] Page-derived prompt-injection text cannot alter system instructions, operation, schema, or UI rendering.
- [ ] Only validated loopback endpoints are accepted by the local provider.
- [ ] Local host permission is requested only through an intentional provider action.
- [ ] The user can inspect the evidence disclosure before generation.
- [ ] AI generation begins only after an explicit click.
- [ ] Cancellation, timeout, invalid output, missing model, and unavailable provider have distinct usable states.
- [ ] A valid response renders as a visibly separate AI advisory.
- [ ] No advisory path mutates deterministic scan evidence or status.
- [ ] No page evidence or advisory enters sync storage.
- [ ] No hosted provider, arbitrary remote endpoint, API-key flow, telemetry, or automatic model download is introduced.
- [ ] Existing Run 1 tests continue to pass.
- [ ] New tests, type-check, lint, production build, and browser flow pass.

## Explicitly out of scope

- Hosted or remote AI providers.
- Consent for sending data off-device.
- WebLLM, Transformers.js, WebGPU, or bundled model weights.
- AI-generated independent findings.
- AI adjudication of Axe incomplete checks.
- Screenshots or visual-model input.
- Automatic fixes or live DOM mutation.
- Provider tools, function calling, browsing, or source-code access.
- Model benchmarking or choosing a canonical model.
- Chrome Web Store publication.

## Completion

Finish the implementation rather than merely describing it. Run the relevant `/tdd` loops at the named seams, run the final verification suite, review the resulting diff against this specification, fix material issues, and commit the completed local-AI slice to the current branch with a concise conventional commit message.

In the final report, state:

- what was implemented;
- the commit SHA;
- every verification command and whether it passed;
- how to configure and test a local Ollama provider;
- whether an actual Ollama smoke test was performed and with which model;
- the exact evidence categories that can reach the provider;
- any environmental verification that could not be executed;
- remaining limitations that are explicitly inside or outside this ticket.

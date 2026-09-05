import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AssistantRequestV1,
  AssistantResponseV1,
} from "../../src/assistant-contracts";
import type {
  FindingImpact,
  FindingStatus,
  ScanReportV1,
} from "../../src/contracts";
import { SCHEMA_VERSION } from "../../src/contracts";
import type {
  ExtensionRequest,
  ExtensionResponse,
  AssistantFailure,
  ScanFailure,
} from "../../src/messages";
import {
  DEFAULT_ASSISTANT_SETTINGS,
  type AssistantSettingsV1,
} from "../../src/ollama";
import { PRODUCT_NAME } from "../../src/product";
import "./style.css";

type Props = {
  send: (request: ExtensionRequest) => Promise<ExtensionResponse>;
  requestPermission?: (settings: AssistantSettingsV1) => Promise<boolean>;
};

type Phase = "loading" | "idle" | "scanning" | "ready" | "error";
type StatusFilter = "all" | FindingStatus;
type ImpactFilter = "all" | FindingImpact;
type ConnectionPhase =
  | "disabled"
  | "not-tested"
  | "permission-needed"
  | "checking"
  | "available"
  | "unavailable"
  | "invalid-configuration";
type GenerationPhase = "idle" | "previewing" | "preview" | "generating";

const errorTitles: Record<ScanFailure["code"], string> = {
  "unsupported-page": "This page is not supported",
  "permission-denied": "Page access was denied",
  "stale-finding": "The selected finding is stale",
  "invalid-message": "The extension returned invalid data",
  "scan-failed": "The scan could not be completed",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function App({
  send,
  requestPermission = async () => true,
}: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [report, setReport] = useState<ScanReportV1>();
  const [error, setError] = useState<ScanFailure>();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [impact, setImpact] = useState<ImpactFilter>("all");
  const [selected, setSelected] = useState<string>();
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [notice, setNotice] = useState("Loading saved scan state");
  const [assistantSettings, setAssistantSettings] = useState(
    DEFAULT_ASSISTANT_SETTINGS,
  );
  const [connection, setConnection] = useState<ConnectionPhase>("disabled");
  const [generation, setGeneration] = useState<GenerationPhase>("idle");
  const [assistantError, setAssistantError] = useState<AssistantFailure>();
  const [preview, setPreview] = useState<{
    findingId: string;
    request: AssistantRequestV1;
  }>();
  const [advisory, setAdvisory] = useState<{
    findingId: string;
    response: AssistantResponseV1;
  }>();
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const advisoryHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void send({ schemaVersion: SCHEMA_VERSION, type: "get-state" })
      .then((response) => {
        if (!response.ok) throw response.error;
        if (response.type !== "state-result")
          throw new Error("Unexpected state response.");
        if (response.report) {
          setReport(response.report);
          setPhase("ready");
          setNotice("Saved scan restored");
        } else {
          setPhase("idle");
          setNotice("Ready to scan");
        }
      })
      .catch(() => {
        setPhase("idle");
        setNotice("Ready to scan");
      });
  }, [send]);

  useEffect(() => {
    void send({ schemaVersion: SCHEMA_VERSION, type: "assistant-settings-get" })
      .then((response) => {
        if (!response.ok || response.type !== "assistant-settings-result")
          return;
        setAssistantSettings(response.settings);
        setConnection(
          !response.settings.enabled
            ? "disabled"
            : response.permissionGranted
              ? "not-tested"
              : "permission-needed",
        );
      })
      .catch(() => undefined);
  }, [send]);

  useEffect(() => {
    if (generation === "preview") previewHeading.current?.focus();
  }, [generation]);

  useEffect(() => {
    if (advisory) advisoryHeading.current?.focus();
  }, [advisory]);

  const assistantFailure = (failure: AssistantFailure) => {
    setAssistantError(failure);
    if (failure.code === "permission-denied")
      setConnection("permission-needed");
    else if (
      failure.code === "invalid-configuration" ||
      failure.code === "missing-model"
    )
      setConnection("invalid-configuration");
    else if (
      failure.code === "unavailable-server" ||
      failure.code === "redirect-rejected" ||
      failure.code === "http-failure"
    )
      setConnection("unavailable");
    setNotice(failure.message);
  };

  const saveAssistantSettings = async (
    settings: AssistantSettingsV1,
    requestAccess = false,
  ) => {
    setAssistantSettings(settings);
    setAssistantError(undefined);
    let permissionGranted = true;
    if (settings.enabled && requestAccess) {
      try {
        permissionGranted = await requestPermission(settings);
      } catch {
        permissionGranted = false;
      }
    }
    let response: ExtensionResponse;
    try {
      response = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-settings-set",
        settings,
      });
    } catch (caught) {
      assistantFailure({
        code: "unavailable-server",
        message: errorMessage(caught, "Local AI settings could not be saved."),
      });
      return false;
    }
    if (response.type !== "assistant-settings-result") {
      assistantFailure({
        code: "invalid-schema",
        message: "The extension returned an unexpected settings response.",
      });
      return false;
    }
    if (!response.ok) {
      assistantFailure(response.error);
      return false;
    }
    if (!permissionGranted) {
      assistantFailure({
        code: "permission-denied",
        message:
          "Chrome permission for the configured loopback provider was denied.",
      });
      return false;
    }
    setConnection(
      !response.settings.enabled
        ? "disabled"
        : response.permissionGranted
          ? "not-tested"
          : "permission-needed",
    );
    setNotice(
      response.settings.enabled
        ? "Local AI settings saved"
        : "Local AI disabled",
    );
    return true;
  };

  const testAssistant = async () => {
    setConnection("checking");
    setAssistantError(undefined);
    if (!(await saveAssistantSettings(assistantSettings, true))) return;
    setConnection("checking");
    let response: ExtensionResponse;
    try {
      response = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-test",
      });
    } catch (caught) {
      assistantFailure({
        code: "unavailable-server",
        message: errorMessage(
          caught,
          "The local provider could not be reached.",
        ),
      });
      return;
    }
    if (response.type !== "assistant-test-result") {
      assistantFailure({
        code: "invalid-schema",
        message: "The extension returned an unexpected connection response.",
      });
      return;
    }
    if (!response.ok) {
      assistantFailure(response.error);
      return;
    }
    setConnection("available");
    setNotice("Local provider available");
  };

  const previewEvidence = async (findingId: string) => {
    setGeneration("previewing");
    setAssistantError(undefined);
    setAdvisory(undefined);
    setNotice("Preparing bounded evidence preview");
    const response = await send({
      schemaVersion: SCHEMA_VERSION,
      type: "assistant-preview",
      findingId,
    }).catch(
      (caught): ExtensionResponse => ({
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-preview-result",
        ok: false,
        error: {
          code: "unavailable-server",
          message: errorMessage(caught, "Evidence could not be prepared."),
        },
      }),
    );
    if (response.type !== "assistant-preview-result" || !response.ok) {
      assistantFailure(
        response.type === "assistant-preview-result"
          ? response.error
          : {
              code: "invalid-schema",
              message:
                "The extension returned an unexpected evidence response.",
            },
      );
      setGeneration("idle");
      return;
    }
    setPreview({ findingId, request: response.request });
    setGeneration("preview");
    setNotice("Evidence preview ready");
  };

  const generateAdvisory = async (findingId: string) => {
    setGeneration("generating");
    setAssistantError(undefined);
    setNotice("Generating local AI advisory");
    const response = await send({
      schemaVersion: SCHEMA_VERSION,
      type: "assistant-generate",
      findingId,
    }).catch(
      (caught): ExtensionResponse => ({
        schemaVersion: SCHEMA_VERSION,
        type: "assistant-result",
        ok: false,
        error: {
          code: "unavailable-server",
          message: errorMessage(
            caught,
            "The local provider could not respond.",
          ),
        },
      }),
    );
    setGeneration("preview");
    if (response.type !== "assistant-result" || !response.ok) {
      assistantFailure(
        response.type === "assistant-result"
          ? response.error
          : {
              code: "invalid-schema",
              message:
                "The extension returned an unexpected advisory response.",
            },
      );
      return;
    }
    setAdvisory({ findingId, response: response.response });
    setNotice("AI advisory ready");
  };

  const cancelAdvisory = async () => {
    setNotice("Cancelling local AI generation");
    await send({
      schemaVersion: SCHEMA_VERSION,
      type: "assistant-cancel",
    }).catch(() => undefined);
  };

  const scan = async () => {
    if (generation === "generating") await cancelAdvisory();
    setPhase("scanning");
    setError(undefined);
    setCommandError(undefined);
    setNotice("Scanning the rendered page");
    let response: ExtensionResponse;
    try {
      response = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "scan-request",
      });
    } catch (caught) {
      const failure: ScanFailure = {
        code: "scan-failed",
        message: errorMessage(caught, "The extension could not start a scan."),
      };
      setError(failure);
      setPhase("error");
      setNotice(errorTitles[failure.code]);
      return;
    }
    if (response.type !== "scan-result") {
      setError({
        code: "invalid-message",
        message: "The extension returned an unexpected response.",
      });
      setPhase("error");
      return;
    }
    if (!response.ok) {
      setError(response.error);
      setPhase("error");
      setNotice(errorTitles[response.error.code]);
      return;
    }
    setReport(response.report);
    setStatus("all");
    setImpact("all");
    setSelected(undefined);
    setPreview(undefined);
    setAdvisory(undefined);
    setAssistantError(undefined);
    setGeneration("idle");
    setOverlayVisible(false);
    setPhase("ready");
    setNotice(`Scan complete: ${response.report.findings.length} findings`);
  };

  const command = async (
    request: Extract<ExtensionRequest, { type: "overlay-command" }>,
  ) => {
    let response: ExtensionResponse;
    try {
      response = await send(request);
    } catch (caught) {
      const message = errorMessage(
        caught,
        "The extension could not update the page overlay.",
      );
      setNotice(message);
      setCommandError(message);
      return false;
    }
    if (response.type !== "command-result") {
      const message = "The extension returned an unexpected response.";
      setNotice(message);
      setCommandError(message);
      return false;
    }
    if (!response.ok) {
      setNotice(response.error.message);
      setCommandError(response.error.message);
      return false;
    }
    setCommandError(undefined);
    return true;
  };

  const selectFinding = async (findingId: string) => {
    const worked = await command({
      schemaVersion: SCHEMA_VERSION,
      type: "overlay-command",
      command: "select",
      findingId,
    });
    if (worked) {
      setSelected(findingId);
      setOverlayVisible(true);
      setNotice("Finding selected on the page");
    }
  };

  const toggleOverlay = async () => {
    const next = !overlayVisible;
    const worked = await command({
      schemaVersion: SCHEMA_VERSION,
      type: "overlay-command",
      command: next ? "show-all" : "hide",
    });
    if (worked) {
      setOverlayVisible(next);
      setNotice(next ? "Overlay shown" : "Overlay hidden");
    }
  };

  const filtered = useMemo(
    () =>
      report?.findings.filter(
        (finding) =>
          (status === "all" || finding.status === status) &&
          (impact === "all" || finding.impact === impact),
      ) ?? [],
    [report, status, impact],
  );
  const violations =
    report?.findings.filter((finding) => finding.status === "violation")
      .length ?? 0;
  const reviews =
    report?.findings.filter((finding) => finding.status === "needs-review")
      .length ?? 0;

  return (
    <main className="shell">
      <header className="masthead">
        <div className="brand-mark" aria-hidden="true">
          A11Y
        </div>
        <div>
          <h1>{PRODUCT_NAME}</h1>
          <p>Local deterministic scan</p>
        </div>
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {notice}
      </p>

      <LocalAiSettings
        settings={assistantSettings}
        connection={connection}
        onChange={setAssistantSettings}
        onSave={saveAssistantSettings}
        onTest={testAssistant}
      />

      {assistantError && !preview && (
        <p className="assistant-global-error" role="alert">
          <strong>{assistantError.code}</strong> {assistantError.message}
        </p>
      )}

      {phase === "loading" && (
        <StatePanel
          title="Loading inspector"
          body="Restoring this tab’s session scan."
          busy
        />
      )}

      {phase === "idle" && (
        <section className="launch" aria-labelledby="launch-title">
          <div className="crosshair" aria-hidden="true">
            <span />
          </div>
          <h2 id="launch-title">Inspect the page in view</h2>
          <p>
            Run axe-core against the rendered document. Nothing is scanned until
            you choose to start.
          </p>
          <button className="primary" type="button" onClick={() => void scan()}>
            Scan this page
          </button>
          <p className="privacy">
            Scan stays in Chrome · Local AI is separate and optional
          </p>
        </section>
      )}

      {phase === "scanning" && (
        <StatePanel
          title="Scanning the rendered page"
          body="Checking WCAG 2.x A/AA and relevant best-practice rules."
          busy
        />
      )}

      {phase === "error" && error && (
        <StatePanel title={errorTitles[error.code]} body={error.message}>
          <button className="primary" type="button" onClick={() => void scan()}>
            Try again
          </button>
        </StatePanel>
      )}

      {phase === "ready" && report && (
        <>
          <section className="page-summary" aria-label="Scanned page">
            <div className="page-copy">
              <h2>{report.page.title || "Untitled page"}</h2>
              <a
                href={report.page.url}
                target="_blank"
                rel="noreferrer"
                title={report.page.url}
              >
                {report.page.url}
              </a>
              <p>
                <span>Scanned</span>{" "}
                <time dateTime={report.startedAt}>
                  {new Date(report.startedAt).toLocaleString()}
                </time>
                <span aria-hidden="true">·</span>
                <span>{report.durationMs} ms</span>
              </p>
            </div>
            <button
              className="secondary"
              type="button"
              onClick={() => void scan()}
            >
              Rescan
            </button>
          </section>

          <section className="counts" aria-label="Finding counts">
            <p>
              <strong>{violations}</strong>{" "}
              {violations === 1 ? "violation" : "violations"}
            </p>
            <p>
              <strong>{reviews}</strong> needs review
            </p>
          </section>

          {report.warnings.length > 0 && (
            <aside className="warning">
              <strong>Coverage note</strong>
              {report.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </aside>
          )}

          {report.findings.length === 0 ? (
            <section className="clean-state">
              <h2>No automated findings</h2>
              <p>
                Nothing was flagged by this axe-core run. This does not prove
                WCAG compliance; manual testing is still required.
              </p>
            </section>
          ) : (
            <>
              <section className="toolbar" aria-label="Finding controls">
                <label>
                  Status
                  <select
                    aria-label="Status"
                    value={status}
                    onChange={(event) =>
                      setStatus(event.target.value as StatusFilter)
                    }
                  >
                    <option value="all">All statuses</option>
                    <option value="violation">Violations</option>
                    <option value="needs-review">Needs review</option>
                  </select>
                </label>
                <label>
                  Impact
                  <select
                    aria-label="Impact"
                    value={impact}
                    onChange={(event) =>
                      setImpact(event.target.value as ImpactFilter)
                    }
                  >
                    <option value="all">All impacts</option>
                    <option value="critical">Critical</option>
                    <option value="serious">Serious</option>
                    <option value="moderate">Moderate</option>
                    <option value="minor">Minor</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <button
                  className="overlay-toggle"
                  type="button"
                  aria-pressed={overlayVisible}
                  onClick={() => void toggleOverlay()}
                >
                  {overlayVisible ? "Hide overlay" : "Show overlay"}
                </button>
                {commandError && (
                  <div className="command-error" role="alert">
                    <span>{commandError}</span>
                    <button type="button" onClick={() => void scan()}>
                      Rescan page
                    </button>
                  </div>
                )}
              </section>

              <section className="results" aria-label="Accessibility findings">
                <div className="results-heading">
                  <h2>Findings</h2>
                  <span>{filtered.length} shown</span>
                </div>
                {filtered.length === 0 && (
                  <p className="filter-empty">
                    No findings match these filters.
                  </p>
                )}
                {filtered.map((finding) => (
                  <article
                    className="finding"
                    data-selected={selected === finding.findingId}
                    key={finding.findingId}
                  >
                    <button
                      type="button"
                      className="finding-select"
                      aria-pressed={selected === finding.findingId}
                      onClick={() => void selectFinding(finding.findingId)}
                    >
                      <span className="finding-topline">
                        <strong>{finding.ruleId}</strong>
                        <span className={`impact impact-${finding.impact}`}>
                          {finding.impact}
                        </span>
                      </span>
                      <span className="status-label">
                        {finding.status === "violation"
                          ? "Violation"
                          : "Needs review"}
                      </span>
                      <span className="message">{finding.failureSummary}</span>
                      <code>{finding.evidence}</code>
                    </button>
                    <footer>
                      <ul aria-label="Standards">
                        {finding.tags.map((tag) => (
                          <li key={tag}>{tag}</li>
                        ))}
                      </ul>
                      <a
                        href={finding.helpUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Rule help
                        <span className="sr-only"> for {finding.ruleId}</span>
                      </a>
                    </footer>
                    {finding.status === "violation" && (
                      <div className="assistant-actions">
                        <button
                          className="secondary"
                          type="button"
                          disabled={
                            !assistantSettings.enabled ||
                            generation === "previewing" ||
                            generation === "generating"
                          }
                          aria-label={`Explain ${finding.ruleId} with local AI`}
                          onClick={() =>
                            void previewEvidence(finding.findingId)
                          }
                        >
                          {generation === "previewing" &&
                          preview?.findingId !== finding.findingId
                            ? "Preparing evidence…"
                            : "Explain with local AI"}
                        </button>
                        {!assistantSettings.enabled && (
                          <span>
                            Enable local AI above to preview evidence.
                          </span>
                        )}
                      </div>
                    )}
                    {preview?.findingId === finding.findingId && (
                      <section
                        className="evidence-preview"
                        aria-busy={generation === "generating"}
                      >
                        <h3 ref={previewHeading} tabIndex={-1}>
                          Evidence preview
                        </h3>
                        <p>
                          The extension will send only this displayed evidence
                          to the configured process on your device. Localhost is
                          not risk-free. No screenshot is included.
                        </p>
                        <p className="evidence-categories">
                          <strong>Categories:</strong>{" "}
                          {preview.request.disclosure.evidenceCategories.join(
                            ", ",
                          )}
                        </p>
                        <pre>
                          {JSON.stringify(
                            {
                              finding: preview.request.finding,
                              evidence: preview.request.evidence,
                            },
                            null,
                            2,
                          )}
                        </pre>
                        {assistantError && (
                          <p className="assistant-error" role="alert">
                            <strong>{assistantError.code}</strong>{" "}
                            {assistantError.message}
                          </p>
                        )}
                        {generation === "generating" ? (
                          <button
                            className="secondary"
                            type="button"
                            onClick={() => void cancelAdvisory()}
                          >
                            Cancel generation
                          </button>
                        ) : assistantError ? (
                          <button
                            className="primary"
                            type="button"
                            onClick={() =>
                              void generateAdvisory(finding.findingId)
                            }
                          >
                            Retry advisory
                          </button>
                        ) : (
                          <button
                            className="primary"
                            type="button"
                            onClick={() =>
                              void generateAdvisory(finding.findingId)
                            }
                          >
                            Send displayed evidence
                          </button>
                        )}
                      </section>
                    )}
                    {advisory?.findingId === finding.findingId && (
                      <AssistantAdvisory
                        advisory={advisory.response}
                        headingRef={advisoryHeading}
                        onDismiss={() => {
                          setAdvisory(undefined);
                          setPreview(undefined);
                          setAssistantError(undefined);
                          setGeneration("idle");
                          setNotice("AI advisory dismissed");
                        }}
                      />
                    )}
                  </article>
                ))}
              </section>
            </>
          )}

          <footer className="disclaimer">
            Automated checks cover only part of accessibility. Review “needs
            review” items and test with people and assistive technology.
          </footer>
        </>
      )}
    </main>
  );
}

const connectionLabels: Record<ConnectionPhase, string> = {
  disabled: "Local AI is disabled",
  "not-tested": "Local AI is enabled; connection not tested",
  "permission-needed": "Permission needed for the loopback provider",
  checking: "Checking local provider",
  available: "Local provider available",
  unavailable: "Local provider unavailable",
  "invalid-configuration": "Invalid local AI configuration",
};

function LocalAiSettings({
  settings,
  connection,
  onChange,
  onSave,
  onTest,
}: {
  settings: AssistantSettingsV1;
  connection: ConnectionPhase;
  onChange: (settings: AssistantSettingsV1) => void;
  onSave: (
    settings: AssistantSettingsV1,
    requestAccess?: boolean,
  ) => Promise<boolean>;
  onTest: () => Promise<void>;
}) {
  return (
    <details className="assistant-settings">
      <summary>
        <strong>Local AI</strong>
        <span>{connectionLabels[connection]}</span>
      </summary>
      <div className="assistant-settings-body">
        <label className="assistant-enable">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => {
              const next = { ...settings, enabled: event.target.checked };
              onChange(next);
              void onSave(next, next.enabled);
            }}
          />
          Enable local AI
        </label>
        <p>
          Optional and per finding. The displayed evidence is sent only after
          confirmation to the configured process on this device.
        </p>
        <div className="assistant-fields">
          <label>
            Loopback host
            <select
              value={settings.host}
              disabled={!settings.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  host: event.target.value as AssistantSettingsV1["host"],
                })
              }
            >
              <option value="127.0.0.1">127.0.0.1</option>
              <option value="localhost">localhost</option>
              <option value="[::1]">::1</option>
            </select>
          </label>
          <label>
            Port
            <input
              aria-label="Port"
              type="number"
              min="1"
              max="65535"
              value={settings.port}
              disabled={!settings.enabled}
              onChange={(event) =>
                onChange({ ...settings, port: Number(event.target.value) })
              }
            />
          </label>
          <label className="wide-field">
            Model name
            <input
              aria-label="Model name"
              value={settings.model}
              maxLength={200}
              disabled={!settings.enabled}
              onChange={(event) =>
                onChange({ ...settings, model: event.target.value })
              }
            />
          </label>
          <label className="wide-field">
            Timeout (milliseconds)
            <input
              aria-label="Timeout (milliseconds)"
              type="number"
              min="1000"
              max="120000"
              step="1000"
              value={settings.timeoutMs}
              disabled={!settings.enabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  timeoutMs: Number(event.target.value),
                })
              }
            />
          </label>
        </div>
        <div className="settings-actions">
          <button
            className="secondary"
            type="button"
            disabled={!settings.enabled || connection === "checking"}
            onClick={() => void onSave(settings)}
          >
            Save settings
          </button>
          <button
            className="secondary"
            type="button"
            disabled={!settings.enabled || connection === "checking"}
            onClick={() => void onTest()}
          >
            {connection === "checking" ? "Checking…" : "Test connection"}
          </button>
        </div>
      </div>
    </details>
  );
}

function AssistantAdvisory({
  advisory,
  headingRef,
  onDismiss,
}: {
  advisory: AssistantResponseV1;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onDismiss: () => void;
}) {
  return (
    <section className="assistant-advisory">
      <header>
        <h3 ref={headingRef} tabIndex={-1}>
          AI advisory
        </h3>
        <span>{Math.round(advisory.confidence * 100)}% confidence</span>
      </header>
      <p className="advisory-note">
        Guidance only. The deterministic finding and standard references remain
        unchanged.
      </p>
      <h4>Summary</h4>
      <p>{advisory.summary}</p>
      <h4>Rationale</h4>
      <p>{advisory.rationale}</p>
      <h4>Remediation options</h4>
      <ul>
        {advisory.remediationOptions.map((option) => (
          <li key={option}>{option}</li>
        ))}
      </ul>
      <h4>Manual checks</h4>
      {advisory.manualChecks.length ? (
        <ul>
          {advisory.manualChecks.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      ) : (
        <p>None reported by the model.</p>
      )}
      <button className="secondary" type="button" onClick={onDismiss}>
        Dismiss advisory
      </button>
    </section>
  );
}

function StatePanel({
  title,
  body,
  busy = false,
  children,
}: {
  title: string;
  body: string;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className="state-panel" aria-busy={busy}>
      <div className={busy ? "scan-pulse" : "state-glyph"} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{body}</p>
      {children}
    </section>
  );
}

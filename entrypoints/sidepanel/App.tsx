import { useEffect, useMemo, useState } from "react";

import type {
  FindingImpact,
  FindingStatus,
  ScanReportV1,
} from "../../src/contracts";
import { SCHEMA_VERSION } from "../../src/contracts";
import type {
  ExtensionRequest,
  ExtensionResponse,
  ScanFailure,
} from "../../src/messages";
import { PRODUCT_NAME } from "../../src/product";
import "./style.css";

type Props = {
  send: (request: ExtensionRequest) => Promise<ExtensionResponse>;
};

type Phase = "loading" | "idle" | "scanning" | "ready" | "error";
type StatusFilter = "all" | FindingStatus;
type ImpactFilter = "all" | FindingImpact;

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

export default function App({ send }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [report, setReport] = useState<ScanReportV1>();
  const [error, setError] = useState<ScanFailure>();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [impact, setImpact] = useState<ImpactFilter>("all");
  const [selected, setSelected] = useState<string>();
  const [overlayVisible, setOverlayVisible] = useState(false);
  const [commandError, setCommandError] = useState<string>();
  const [notice, setNotice] = useState("Loading saved scan state");

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

  const scan = async () => {
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
    if (!response.ok) {
      setError(response.error);
      setPhase("error");
      setNotice(errorTitles[response.error.code]);
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
    setReport(response.report);
    setStatus("all");
    setImpact("all");
    setSelected(undefined);
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
          <p className="privacy">Runs locally · No page data leaves Chrome</p>
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

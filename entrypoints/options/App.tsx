import { useEffect, useState, useRef } from "react";
import { SCHEMA_VERSION } from "../../src/contracts";
import type {
  DeviceFlowCodeResponse,
  DomainRepositoryMappingV1,
  GitHubConnectionViewV1,
  GitHubLabelV1,
  GitHubRepositoryV1,
} from "../../src/github/contracts";
import type { ExtensionRequest, ExtensionResponse } from "../../src/messages";
import "./style.css";

type Props = {
  send: (request: ExtensionRequest) => Promise<ExtensionResponse>;
  requestPermission?: () => Promise<boolean>;
  initialPrefillDomain?: string;
};

export default function OptionsApp({
  send,
  requestPermission = async () => {
    if (typeof chrome !== "undefined" && chrome.permissions) {
      return chrome.permissions.request({
        origins: ["https://github.com/*", "https://api.github.com/*"],
      });
    }
    return true;
  },
  initialPrefillDomain,
}: Props) {
  const [connection, setConnection] = useState<GitHubConnectionViewV1>({
    schemaVersion: "1.0",
    state: "disconnected",
    user: null,
    expiresAt: null,
    error: null,
  });
  const [permissionGranted, setPermissionGranted] = useState(true);
  const [deviceFlow, setDeviceFlow] = useState<DeviceFlowCodeResponse | null>(
    null,
  );
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const [mappings, setMappings] = useState<DomainRepositoryMappingV1[]>([]);
  const [repositories, setRepositories] = useState<GitHubRepositoryV1[]>([]);
  const [labels, setLabels] = useState<GitHubLabelV1[]>([]);

  const [showForm, setShowForm] = useState(false);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [formDomain, setFormDomain] = useState(initialPrefillDomain ?? "");
  const [formRepoId, setFormRepoId] = useState<string>("");
  const [formLabelName, setFormLabelName] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("Integrations settings ready.");

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const loadConnectionState = async () => {
    try {
      const res = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-get-state",
      });
      if (res.type === "github-state-result" && res.ok) {
        setConnection(res.connection);
        setPermissionGranted(res.permissionGranted);
      }
    } catch {
      // ignore error
    }
  };

  const loadMappings = async () => {
    try {
      const res = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-get-mappings",
      });
      if (res.type === "github-mappings-result" && res.ok) {
        setMappings(res.mappings);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void loadConnectionState();
    void loadMappings();

    if (
      !initialPrefillDomain &&
      typeof chrome !== "undefined" &&
      chrome.storage?.local
    ) {
      chrome.storage.local.get("github-prefill-domain").then((data) => {
        if (typeof data["github-prefill-domain"] === "string") {
          setFormDomain(data["github-prefill-domain"]);
          setShowForm(true);
          void chrome.storage.local.remove("github-prefill-domain");
        }
      });
    } else if (initialPrefillDomain) {
      setShowForm(true);
    }
  }, []);

  // Poll for repositories when connected
  useEffect(() => {
    if (connection.state === "connected" && permissionGranted) {
      void (async () => {
        try {
          const res = await send({
            schemaVersion: SCHEMA_VERSION,
            type: "github-list-repositories",
          });
          if (res.type === "github-repositories-result" && res.ok) {
            setRepositories(res.repositories);
          }
        } catch {
          // ignore
        }
      })();
    }
  }, [connection.state, permissionGranted]);

  // Load labels when repository changes in form
  useEffect(() => {
    if (!formRepoId || connection.state !== "connected") {
      setLabels([]);
      return;
    }
    const repo = repositories.find((r) => String(r.id) === formRepoId);
    if (!repo) return;

    void (async () => {
      try {
        const res = await send({
          schemaVersion: SCHEMA_VERSION,
          type: "github-list-labels",
          owner: repo.owner,
          repo: repo.name,
        });
        if (res.type === "github-labels-result" && res.ok) {
          setLabels(res.labels);
        }
      } catch {
        setLabels([]);
      }
    })();
  }, [formRepoId, connection.state, repositories]);

  // Device flow polling
  useEffect(() => {
    if (!deviceFlow || connection.state !== "connecting") {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    const poll = async () => {
      try {
        const res = await send({
          schemaVersion: SCHEMA_VERSION,
          type: "github-poll-device-flow",
        });
        if (res.type === "github-device-flow-poll-result" && res.ok) {
          if (res.result.status === "success") {
            setDeviceFlow(null);
            setNotice("Successfully connected to GitHub!");
            void loadConnectionState();
          } else if (
            res.result.status === "denied" ||
            res.result.status === "expired" ||
            res.result.status === "error"
          ) {
            setDeviceFlow(null);
            setNotice(
              res.result.error?.message ?? "Device flow failed or expired.",
            );
            void loadConnectionState();
          }
        }
      } catch {
        // ignore error step
      }
    };

    const intervalMs = (deviceFlow.interval || 5) * 1000;
    pollTimerRef.current = setInterval(() => void poll(), intervalMs);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [deviceFlow, connection.state]);

  const handleGrantPermission = async () => {
    try {
      const granted = await requestPermission();
      setPermissionGranted(granted);
      if (granted) {
        setNotice("GitHub permission granted.");
        void loadConnectionState();
      } else {
        setNotice("GitHub permission denied.");
      }
    } catch {
      setNotice("Failed to request permission.");
    }
  };

  const handleStartConnect = async () => {
    if (!permissionGranted) {
      await handleGrantPermission();
    }
    try {
      setNotice("Starting device flow authorization...");
      const res = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-start-device-flow",
      });
      if (res.type === "github-device-flow-start-result" && res.ok) {
        setDeviceFlow(res.flow);
        setConnection((prev) => ({ ...prev, state: "connecting" }));
        setNotice("Device code generated. Enter the code on GitHub.");
      } else if (!res.ok) {
        setNotice(res.error.message);
      }
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "Failed to start device flow.",
      );
    }
  };

  const handleCancelConnect = async () => {
    try {
      await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-cancel-device-flow",
      });
      setDeviceFlow(null);
      setNotice("Device authorization cancelled.");
      void loadConnectionState();
    } catch {
      // ignore
    }
  };

  const handleDisconnect = async () => {
    try {
      await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-disconnect",
      });
      setNotice("Disconnected from GitHub.");
      void loadConnectionState();
    } catch {
      // ignore
    }
  };

  const handleCopyCode = async () => {
    if (!deviceFlow?.userCode) return;
    try {
      await navigator.clipboard.writeText(deviceFlow.userCode);
      setCopyNotice("Copied to clipboard!");
      setTimeout(() => setCopyNotice(null), 3000);
    } catch {
      setCopyNotice("Copy failed.");
    }
  };

  const handleOpenForm = (existing?: DomainRepositoryMappingV1) => {
    if (existing) {
      setEditingDomain(existing.domainKey);
      setFormDomain(existing.domainKey);
      setFormRepoId(String(existing.repository.id));
      setFormLabelName(existing.label?.name ?? "");
    } else {
      setEditingDomain(null);
      setFormDomain(initialPrefillDomain ?? "");
      setFormRepoId("");
      setFormLabelName("");
    }
    setFormError(null);
    setShowForm(true);
  };

  const handleSaveMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanDomain = formDomain.trim();
    if (!cleanDomain) {
      setFormError("Domain key is required.");
      return;
    }

    if (!formRepoId) {
      setFormError("Please select a GitHub repository.");
      return;
    }

    const selectedRepo = repositories.find((r) => String(r.id) === formRepoId);
    if (!selectedRepo) {
      setFormError("Selected repository is no longer available.");
      return;
    }

    const selectedLabel = labels.find((l) => l.name === formLabelName) ?? null;

    const newMapping: DomainRepositoryMappingV1 = {
      schemaVersion: "1.0",
      domainKey: cleanDomain.toLowerCase(),
      installationId: selectedRepo.installationId,
      repository: {
        id: selectedRepo.id,
        owner: selectedRepo.owner,
        name: selectedRepo.name,
        fullName: selectedRepo.fullName,
        htmlUrl: selectedRepo.htmlUrl,
      },
      label: selectedLabel
        ? {
            id: selectedLabel.id,
            name: selectedLabel.name,
            color: selectedLabel.color,
          }
        : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const res = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-save-mapping",
        mapping: newMapping,
      });
      if (res.type === "github-mappings-result" && res.ok) {
        setMappings(res.mappings);
        setShowForm(false);
        setNotice(`Mapping saved for domain ${cleanDomain}`);
      } else if (!res.ok) {
        setFormError(res.error.message);
      }
    } catch (caught) {
      setFormError(
        caught instanceof Error
          ? caught.message
          : "Failed to save domain mapping.",
      );
    }
  };

  const handleDeleteMapping = async (domainKey: string) => {
    try {
      const res = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-delete-mapping",
        domainKey,
      });
      if (res.type === "github-mappings-result" && res.ok) {
        setMappings(res.mappings);
        setNotice(`Removed mapping for domain ${domainKey}`);
      }
    } catch {
      // ignore
    }
  };

  return (
    <div className="options-shell">
      <header className="options-header">
        <h1>Integrations</h1>
        <p className="subtitle">
          Configure GitHub App integration for issue creation
        </p>
      </header>

      <p className="sr-only" role="status" aria-live="polite">
        {notice}
      </p>

      {/* GitHub App Connection Card */}
      <section className="card connection-card" aria-label="GitHub Connection">
        <h2>GitHub Account Connection</h2>

        {connection.state === "not-configured" && (
          <div className="status-banner banner-warning">
            <strong>Not Configured</strong>
            <p>
              GitHub App client ID is not configured in this build. Set{" "}
              <code>VITE_GITHUB_APP_CLIENT_ID</code> in <code>.env</code> and
              rebuild the extension to enable GitHub integration.
            </p>
          </div>
        )}

        {!permissionGranted && connection.state !== "not-configured" && (
          <div className="status-banner banner-warning">
            <strong>Host Permission Needed</strong>
            <p>
              The extension requires Chrome origin permission for{" "}
              <code>https://github.com/*</code> and{" "}
              <code>https://api.github.com/*</code> to authenticate and manage
              issues.
            </p>
            <button
              className="button primary"
              type="button"
              onClick={() => void handleGrantPermission()}
            >
              Grant GitHub Host Permission
            </button>
          </div>
        )}

        {connection.state === "disconnected" && permissionGranted && (
          <div className="connection-body">
            <p>Connect a GitHub account via GitHub App device flow.</p>
            <button
              className="button primary"
              type="button"
              onClick={() => void handleStartConnect()}
            >
              Connect GitHub
            </button>
          </div>
        )}

        {connection.state === "connecting" && deviceFlow && (
          <div className="connection-body connecting-box">
            <p>
              First, open GitHub and enter the authorization user code displayed
              below:
            </p>
            <div className="code-display">
              <strong className="user-code">{deviceFlow.userCode}</strong>
              <button
                className="button secondary"
                type="button"
                onClick={() => void handleCopyCode()}
              >
                Copy Code
              </button>
              {copyNotice && <span className="copy-notice">{copyNotice}</span>}
            </div>

            <div className="connecting-actions">
              <a
                className="button primary"
                href={deviceFlow.verificationUri}
                target="_blank"
                rel="noreferrer"
              >
                Open GitHub Verification Page
              </a>
              <button
                className="button secondary"
                type="button"
                onClick={() => void handleCancelConnect()}
              >
                Cancel Authorization
              </button>
            </div>
            <p className="poll-status">
              Waiting for user authorization on GitHub…
            </p>
          </div>
        )}

        {connection.state === "connected" && connection.user && (
          <div className="connection-body connected-box">
            <div className="user-profile">
              {connection.user.avatarUrl && (
                <img
                  className="user-avatar"
                  src={connection.user.avatarUrl}
                  alt=""
                  aria-hidden="true"
                />
              )}
              <div>
                <strong>{connection.user.name || connection.user.login}</strong>
                <span className="user-login">@{connection.user.login}</span>
              </div>
            </div>
            <button
              className="button secondary"
              type="button"
              onClick={() => void handleDisconnect()}
            >
              Disconnect
            </button>
          </div>
        )}

        {connection.state === "expired" && (
          <div className="status-banner banner-warning">
            <strong>Authorization Expired</strong>
            <p>
              Your GitHub authorization has expired or was revoked. Please
              reconnect to restore issue creation.
            </p>
            <button
              className="button primary"
              type="button"
              onClick={() => void handleStartConnect()}
            >
              Reconnect GitHub
            </button>
          </div>
        )}
      </section>

      {/* Domain Mappings Section */}
      <section className="card mappings-card" aria-label="Domain Mappings">
        <div className="mappings-header">
          <h2>Domain to Repository Mappings</h2>
          {connection.state === "connected" && !showForm && (
            <button
              className="button primary"
              type="button"
              onClick={() => handleOpenForm()}
            >
              Add Domain Mapping
            </button>
          )}
        </div>

        {connection.state !== "connected" ? (
          <p className="hint">
            Connect your GitHub account above to create and manage domain
            mappings.
          </p>
        ) : (
          <>
            {showForm && (
              <form
                className="mapping-form"
                onSubmit={(e) => void handleSaveMapping(e)}
              >
                <h3>
                  {editingDomain ? "Edit Domain Mapping" : "Add Domain Mapping"}
                </h3>

                {formError && (
                  <div className="form-error" role="alert">
                    {formError}
                  </div>
                )}

                <div className="form-field">
                  <label htmlFor="domain-input">Exact domain</label>
                  <input
                    id="domain-input"
                    type="text"
                    required
                    placeholder="e.g. example.com or localhost:3000"
                    value={formDomain}
                    disabled={editingDomain !== null}
                    onChange={(e) => setFormDomain(e.target.value)}
                  />
                  <p className="field-hint">
                    Canonical lower-cased domain host. Exact match only (no
                    parent-domain or subdomain inheritance).
                  </p>
                </div>

                <div className="form-field">
                  <label htmlFor="repo-select">GitHub repository</label>
                  <select
                    id="repo-select"
                    required
                    value={formRepoId}
                    onChange={(e) => setFormRepoId(e.target.value)}
                  >
                    <option value="">Select an accessible repository...</option>
                    {repositories.map((repo) => (
                      <option key={repo.id} value={String(repo.id)}>
                        {repo.fullName}
                      </option>
                    ))}
                  </select>
                  {repositories.length === 0 && (
                    <p className="field-hint warning">
                      No accessible repositories found. Ensure the GitHub App is
                      installed or granted repository access.
                    </p>
                  )}
                </div>

                <div className="form-field">
                  <label htmlFor="label-select">
                    Repository label (optional)
                  </label>
                  <select
                    id="label-select"
                    value={formLabelName}
                    onChange={(e) => setFormLabelName(e.target.value)}
                  >
                    <option value="">No label</option>
                    {labels.map((lbl) => (
                      <option key={lbl.id} value={lbl.name}>
                        {lbl.name}
                      </option>
                    ))}
                  </select>
                  <p className="field-hint">
                    Applies an existing repository label to created issues.
                  </p>
                </div>

                <div className="disclosure-box">
                  <h4>Data disclosure</h4>
                  <p>
                    Saving this mapping permits sending deterministic finding
                    data to GitHub when you activate "Add issue on GitHub":
                  </p>
                  <ul>
                    <li>
                      Finding rule ID, impact, status, help text, help URL, and
                      WCAG tags
                    </li>
                    <li>
                      Page origin and sanitized pathname (no query string or
                      fragment)
                    </li>
                    <li>Escaped element snippet and failure summary</li>
                    <li>Inspector scanner name and version</li>
                  </ul>
                  <p>
                    No screenshots, full DOM, form values, cookies, headers, or
                    query parameters will be sent.
                  </p>
                </div>

                <div className="form-actions">
                  <button className="button primary" type="submit">
                    Save mapping
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setShowForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="mappings-list">
              {mappings.length === 0 ? (
                <p className="empty-mappings">No domain mappings configured.</p>
              ) : (
                <table className="mappings-table">
                  <thead>
                    <tr>
                      <th>Domain</th>
                      <th>Repository</th>
                      <th>Label</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mappings.map((m) => (
                      <tr key={m.domainKey}>
                        <td>
                          <code>{m.domainKey}</code>
                        </td>
                        <td>
                          <a
                            href={m.repository.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {m.repository.fullName}
                          </a>
                        </td>
                        <td>
                          {m.label ? (
                            <span
                              className="label-badge"
                              style={{ backgroundColor: `#${m.label.color}` }}
                            >
                              {m.label.name}
                            </span>
                          ) : (
                            <em>No label</em>
                          )}
                        </td>
                        <td>
                          <button
                            className="button secondary small"
                            type="button"
                            onClick={() => handleOpenForm(m)}
                          >
                            Edit
                          </button>
                          <button
                            className="button danger small"
                            type="button"
                            onClick={() =>
                              void handleDeleteMapping(m.domainKey)
                            }
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

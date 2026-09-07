import { useEffect, useState, useRef } from "react";
import { SCHEMA_VERSION } from "../../src/contracts";
import { resolveGitHubInstallationUrl } from "../../src/github/config";
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
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [loadingLabels, setLoadingLabels] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [formDomain, setFormDomain] = useState(initialPrefillDomain ?? "");
  const [formRepoId, setFormRepoId] = useState<string>("");
  const [isManualRepo, setIsManualRepo] = useState(false);
  const [manualRepo, setManualRepo] = useState("");
  const [formLabelName, setFormLabelName] = useState<string>("");
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("Integrations settings ready.");
  const [showConnectConfirm, setShowConnectConfirm] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingReposRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const connectButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!showConnectConfirm) return;

    confirmButtonRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowConnectConfirm(false);
        connectButtonRef.current?.focus();
        return;
      }

      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showConnectConfirm]);

  const loadRepositories = async () => {
    if (connection.state !== "connected" || !permissionGranted) return;
    if (loadingReposRef.current) return;
    loadingReposRef.current = true;
    setLoadingRepos(true);
    setRepoError(null);
    try {
      const res = await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-list-repositories",
      });
      if (res.type === "github-repositories-result") {
        if (res.ok) {
          setRepositories(res.repositories);
        } else {
          setRepoError(res.error.message);
          setNotice(`Failed to load repositories: ${res.error.message}`);
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to load repositories.";
      setRepoError(msg);
      setNotice(msg);
    } finally {
      loadingReposRef.current = false;
      setLoadingRepos(false);
    }
  };

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
          const domain = data["github-prefill-domain"];
          setFormDomain(domain);
          setShowForm(true);
          setNotice(
            `Configure GitHub repository mapping for ${domain} to enable issue creation.`,
          );
          void chrome.storage.local.remove("github-prefill-domain");
        }
      });
    } else if (initialPrefillDomain) {
      setFormDomain(initialPrefillDomain);
      setShowForm(true);
      setNotice(
        `Configure GitHub repository mapping for ${initialPrefillDomain} to enable issue creation.`,
      );
    }
  }, []);

  // Fetch repositories when connected
  useEffect(() => {
    if (connection.state === "connected" && permissionGranted) {
      void loadRepositories();
    }
  }, [connection.state, permissionGranted]);

  // Auto-refresh on window focus / document visibility change
  useEffect(() => {
    const handleRefresh = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState === "hidden"
      ) {
        return;
      }
      if (connection.state === "connected" && permissionGranted) {
        void loadRepositories();
      }
    };

    window.addEventListener("focus", handleRefresh);
    document.addEventListener("visibilitychange", handleRefresh);

    return () => {
      window.removeEventListener("focus", handleRefresh);
      document.removeEventListener("visibilitychange", handleRefresh);
    };
  }, [connection.state, permissionGranted]);

  // Load labels when repository changes in form
  useEffect(() => {
    if (connection.state !== "connected") {
      setLabels([]);
      setLabelError(null);
      return;
    }

    let owner = "";
    let repoName = "";

    if (isManualRepo) {
      const parts = manualRepo.trim().split("/");
      if (parts.length === 2 && parts[0]?.trim() && parts[1]?.trim()) {
        owner = parts[0].trim();
        repoName = parts[1].trim();
      }
    } else if (formRepoId) {
      const repo = repositories.find((r) => String(r.id) === formRepoId);
      if (repo) {
        owner = repo.owner;
        repoName = repo.name;
      }
    }

    if (!owner || !repoName) {
      setLabels([]);
      setLabelError(null);
      return;
    }

    void (async () => {
      setLoadingLabels(true);
      setLabelError(null);
      try {
        const res = await send({
          schemaVersion: SCHEMA_VERSION,
          type: "github-list-labels",
          owner,
          repo: repoName,
        });
        if (res.type === "github-labels-result") {
          if (res.ok) {
            setLabels(res.labels);
          } else {
            setLabelError(res.error.message);
            setLabels([]);
          }
        }
      } catch (err) {
        setLabelError(
          err instanceof Error ? err.message : "Failed to load labels.",
        );
        setLabels([]);
      } finally {
        setLoadingLabels(false);
      }
    })();
  }, [formRepoId, isManualRepo, manualRepo, connection.state, repositories]);

  // Device flow polling
  useEffect(() => {
    if (!deviceFlow || connection.state !== "connecting") {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }

    let isSubscribed = true;
    let inFlight = false;

    const scheduleNext = (delayMs: number) => {
      if (!isSubscribed) return;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      pollTimerRef.current = setTimeout(() => {
        void poll();
      }, delayMs);
    };

    const poll = async () => {
      if (!isSubscribed || inFlight) return;
      inFlight = true;
      try {
        const res = await send({
          schemaVersion: SCHEMA_VERSION,
          type: "github-poll-device-flow",
        });
        if (!isSubscribed) return;

        if (res.type === "github-device-flow-poll-result") {
          if (res.ok) {
            if (res.result.status === "success") {
              if (pollTimerRef.current) {
                clearTimeout(pollTimerRef.current);
                pollTimerRef.current = null;
              }
              setDeviceFlow(null);
              setNotice(
                formDomain
                  ? `Successfully connected to GitHub! Select a repository to map domain ${formDomain}.`
                  : "Successfully connected to GitHub!",
              );
              void loadConnectionState();
              return;
            }
            if (res.result.status === "pending") {
              const nextDelayMs =
                (res.result.nextIntervalSec ?? deviceFlow.interval ?? 5) * 1000;
              scheduleNext(nextDelayMs);
              return;
            }
            // terminal failure: denied, expired, error
            if (pollTimerRef.current) {
              clearTimeout(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setDeviceFlow(null);
            setNotice(
              res.result.error?.message ?? "Device flow failed or expired.",
            );
            void loadConnectionState();
            return;
          } else {
            // Background error response
            if (pollTimerRef.current) {
              clearTimeout(pollTimerRef.current);
              pollTimerRef.current = null;
            }
            setDeviceFlow(null);
            setNotice(res.error?.message ?? "Device authorization failed.");
            void loadConnectionState();
            return;
          }
        } else {
          // Unexpected response type
          if (pollTimerRef.current) {
            clearTimeout(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          setDeviceFlow(null);
          setNotice("Unexpected response during device authorization.");
          void loadConnectionState();
          return;
        }
      } catch (err) {
        if (!isSubscribed) return;
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        setDeviceFlow(null);
        setNotice(
          err instanceof Error
            ? err.message
            : "Device authorization polling failed.",
        );
        void loadConnectionState();
      } finally {
        inFlight = false;
      }
    };

    const initialDelayMs = (deviceFlow.interval || 5) * 1000;
    scheduleNext(initialDelayMs);

    return () => {
      isSubscribed = false;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [deviceFlow, connection.state]);

  const handleGrantPermission = async (): Promise<boolean> => {
    try {
      const granted = await requestPermission();
      setPermissionGranted(granted);
      if (granted) {
        setNotice("GitHub permission granted.");
        void loadConnectionState();
      } else {
        setNotice("GitHub permission denied.");
      }
      return granted;
    } catch {
      setNotice("Failed to request permission.");
      return false;
    }
  };

  const handleStartConnect = async () => {
    let currentPermission = permissionGranted;
    if (!currentPermission) {
      currentPermission = await handleGrantPermission();
      if (!currentPermission) return;
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
      } else if (res.type === "github-device-flow-start-result" && !res.ok) {
        setNotice(res.error.message);
      } else {
        setNotice("Failed to start device flow.");
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

  const handleCloseConnectConfirm = () => {
    setShowConnectConfirm(false);
    connectButtonRef.current?.focus();
  };

  const handleConfirmConnect = () => {
    setShowConnectConfirm(false);
    void handleStartConnect();
  };

  const handleDisconnect = async () => {
    try {
      await send({
        schemaVersion: SCHEMA_VERSION,
        type: "github-disconnect",
      });
      setNotice("Disconnected from GitHub.");
      setConnection((prev) => ({
        ...prev,
        state: "disconnected",
        user: null,
        expiresAt: null,
        error: null,
      }));
      setRepositories([]);
      setRepoError(null);
      setLabels([]);
      setLabelError(null);
      setDeviceFlow(null);
      setShowConnectConfirm(false);
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
      setManualRepo(existing.repository.fullName);
      const inList = repositories.some(
        (r) => String(r.id) === String(existing.repository.id),
      );
      setIsManualRepo(!inList);
      setFormLabelName(existing.label?.name ?? "");
    } else {
      setEditingDomain(null);
      setFormDomain(initialPrefillDomain ?? "");
      setFormRepoId("");
      setManualRepo("");
      setIsManualRepo(false);
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

    let repoToSave: GitHubRepositoryV1 | null = null;

    if (isManualRepo) {
      const cleanManual = manualRepo.trim();
      if (!cleanManual) {
        setFormError("Please enter a GitHub repository (owner/repo).");
        return;
      }
      const parts = cleanManual.split("/");
      if (parts.length !== 2 || !parts[0]?.trim() || !parts[1]?.trim()) {
        setFormError(
          "Repository must be in owner/repo format (e.g. acme/web-app).",
        );
        return;
      }
      const owner = parts[0].trim();
      const name = parts[1].trim();
      const matched = repositories.find(
        (r) => r.fullName.toLowerCase() === cleanManual.toLowerCase(),
      );
      if (matched) {
        repoToSave = matched;
      } else {
        const ownerInstallation =
          repositories.find(
            (r) => r.owner.toLowerCase() === owner.toLowerCase(),
          )?.installationId ?? 0;
        repoToSave = {
          id: 0,
          owner,
          name,
          fullName: `${owner}/${name}`,
          htmlUrl: `https://github.com/${owner}/${name}`,
          installationId: ownerInstallation,
        };
      }
    } else {
      if (!formRepoId) {
        setFormError("Please select a GitHub repository.");
        return;
      }
      const selectedRepo = repositories.find(
        (r) => String(r.id) === formRepoId,
      );
      if (!selectedRepo) {
        setFormError("Selected repository is no longer available.");
        return;
      }
      repoToSave = selectedRepo;
    }

    const selectedLabel = labels.find((l) => l.name === formLabelName) ?? null;

    const newMapping: DomainRepositoryMappingV1 = {
      schemaVersion: "1.0",
      domainKey: cleanDomain.toLowerCase(),
      installationId: repoToSave.installationId,
      repository: {
        id: repoToSave.id,
        owner: repoToSave.owner,
        name: repoToSave.name,
        fullName: repoToSave.fullName,
        htmlUrl: repoToSave.htmlUrl,
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

      {notice && (
        <div
          className="status-banner banner-info"
          role="status"
          aria-live="polite"
        >
          {notice}
        </div>
      )}

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

        {(connection.state === "disconnected" ||
          connection.state === "error") &&
          permissionGranted && (
            <div className="connection-body onboarding-container">
              {connection.error && (
                <div className="status-banner banner-warning" role="alert">
                  <strong>Connection Error</strong>
                  <p className="error-text">{connection.error.message}</p>
                  <div className="error-actions">
                    <button
                      className="button secondary"
                      type="button"
                      onClick={() => void handleDisconnect()}
                    >
                      Disconnect GitHub
                    </button>
                  </div>
                </div>
              )}

              <div className="onboarding-steps">
                <div className="onboarding-step">
                  <div className="step-header">
                    <span className="step-number">Step 1</span>
                    <h3>Install GitHub App</h3>
                  </div>
                  <p className="step-desc">
                    Repository access must be granted on GitHub before connecting.
                    Install the GitHub App on your personal account or organization
                    to choose which repositories can report issues.
                  </p>
                  <a
                    className="button primary"
                    href={resolveGitHubInstallationUrl(
                      connection.installationUrl,
                    )}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Install GitHub App
                  </a>
                </div>

                <div className="onboarding-step">
                  <div className="step-header">
                    <span className="step-number">Step 2</span>
                    <h3>Connect GitHub Account</h3>
                  </div>
                  <p className="step-desc">
                    Already installed? Connect GitHub to authorize Access Trace.
                  </p>
                  <button
                    ref={connectButtonRef}
                    className="button secondary"
                    type="button"
                    onClick={() => setShowConnectConfirm(true)}
                  >
                    Connect GitHub
                  </button>
                </div>
              </div>
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
            <div className="connected-actions">
              <a
                className="button secondary"
                href={resolveGitHubInstallationUrl(connection.installationUrl)}
                target="_blank"
                rel="noreferrer"
              >
                Install GitHub App
              </a>
              <button
                className="button secondary"
                type="button"
                onClick={() => void loadRepositories()}
                disabled={loadingRepos}
              >
                {loadingRepos ? "Refreshing..." : "Refresh Repositories"}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void handleDisconnect()}
              >
                Disconnect GitHub
              </button>
            </div>
          </div>
        )}

        {connection.state === "expired" && (
          <div className="status-banner banner-warning">
            <strong>Authorization Expired</strong>
            <p>
              Your GitHub authorization has expired or was revoked. Please
              reconnect to restore issue creation.
            </p>
            <div className="expired-actions">
              <button
                className="button primary"
                type="button"
                onClick={() => setShowConnectConfirm(true)}
              >
                Reconnect GitHub
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => void handleDisconnect()}
              >
                Disconnect GitHub
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 1-Click GitHub App Install Action Card */}
      {connection.state === "connected" &&
        repositories.length === 0 &&
        !loadingRepos && (
          <section
            className="card install-action-card"
            aria-label="Connect Repositories on GitHub"
          >
            <div className="install-action-body">
              <div className="install-action-text">
                <h2>Connect Repositories on GitHub</h2>
                <p>
                  Connect Repositories on GitHub: Select which repositories
                  Access Trace can report accessibility bugs to.
                </p>
              </div>
              <div className="install-action-buttons">
                <a
                  className="button primary"
                  href={resolveGitHubInstallationUrl(
                    connection.installationUrl,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  Install GitHub App
                </a>
              </div>
            </div>
          </section>
        )}

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
          <div>
            <p className="hint">
              Connect your GitHub account above to create and manage domain
              mappings.
            </p>
            {formDomain && (
              <p className="hint">
                Target domain to map: <code>{formDomain}</code>. Connect GitHub
                above to select a repository.
              </p>
            )}
          </div>
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
                  <div className="field-header">
                    <label
                      htmlFor={
                        isManualRepo ? "repo-manual-input" : "repo-select"
                      }
                    >
                      GitHub repository
                    </label>
                    <div className="field-header-actions">
                      <button
                        className="button link-button"
                        type="button"
                        onClick={() => {
                          if (!isManualRepo) {
                            const selected = repositories.find(
                              (r) => String(r.id) === formRepoId,
                            );
                            if (selected) {
                              setManualRepo(selected.fullName);
                            }
                            setIsManualRepo(true);
                          } else {
                            const matched = repositories.find(
                              (r) =>
                                r.fullName.toLowerCase() ===
                                manualRepo.trim().toLowerCase(),
                            );
                            if (matched) {
                              setFormRepoId(String(matched.id));
                            }
                            setIsManualRepo(false);
                          }
                        }}
                      >
                        {isManualRepo
                          ? "Choose from accessible repositories"
                          : "Enter repository manually"}
                      </button>
                      {!isManualRepo && (
                        <button
                          className="button link-button"
                          type="button"
                          onClick={() => void loadRepositories()}
                          disabled={loadingRepos}
                        >
                          {loadingRepos ? "Loading..." : "Refresh"}
                        </button>
                      )}
                    </div>
                  </div>

                  {isManualRepo ? (
                    <>
                      <input
                        id="repo-manual-input"
                        type="text"
                        required
                        placeholder="owner/repo (e.g. acme/web-app)"
                        value={manualRepo}
                        onChange={(e) => setManualRepo(e.target.value)}
                      />
                      <p className="field-hint">
                        Enter GitHub repository in <code>owner/repo</code>{" "}
                        format for manual or custom configuration.
                      </p>
                    </>
                  ) : (
                    <>
                      <select
                        id="repo-select"
                        required
                        value={formRepoId}
                        onChange={(e) => setFormRepoId(e.target.value)}
                        disabled={loadingRepos}
                      >
                        <option value="">
                          {loadingRepos
                            ? "Loading accessible repositories..."
                            : repositories.length === 0
                              ? "No accessible repositories found"
                              : "Select an accessible repository..."}
                        </option>
                        {repositories.map((repo) => (
                          <option key={repo.id} value={String(repo.id)}>
                            {repo.fullName}
                          </option>
                        ))}
                      </select>
                      {repoError && (
                        <p className="field-hint error">{repoError}</p>
                      )}
                      {repositories.length === 0 && !loadingRepos && (
                        <div className="callout-box warning">
                          <p>
                            <strong>No accessible repositories found.</strong>
                          </p>
                          <p>
                            In GitHub, your GitHub App must be{" "}
                            <strong>installed</strong> on your personal account
                            or organization with access granted to the
                            repository where you want to create issues.
                          </p>
                          <div className="callout-actions">
                            <a
                              className="button primary"
                              href={resolveGitHubInstallationUrl(
                                connection.installationUrl,
                              )}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Install GitHub App
                            </a>
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => void loadRepositories()}
                            >
                              Refresh Repositories
                            </button>
                            <button
                              className="button secondary"
                              type="button"
                              onClick={() => setIsManualRepo(true)}
                            >
                              Enter Repository Manually
                            </button>
                          </div>
                        </div>
                      )}
                    </>
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
                    disabled={(!formRepoId && !manualRepo) || loadingLabels}
                  >
                    <option value="">
                      {loadingLabels
                        ? "Loading repository labels..."
                        : !formRepoId && !manualRepo
                          ? "Select or enter a repository first"
                          : "No label"}
                    </option>
                    {labels.map((lbl) => (
                      <option key={lbl.id} value={lbl.name}>
                        {lbl.name}
                      </option>
                    ))}
                  </select>
                  {labelError && (
                    <p className="field-hint error">{labelError}</p>
                  )}
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

      {showConnectConfirm && (
        <div
          className="modal-backdrop"
          onClick={handleCloseConnectConfirm}
          data-testid="modal-backdrop"
        >
          <div
            ref={dialogRef}
            className="modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-install-dialog-title"
            aria-describedby="confirm-install-dialog-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-install-dialog-title">
              Install GitHub App Before Connecting
            </h3>
            <p id="confirm-install-dialog-desc">
              You must install the GitHub App on your personal account or organization
              with repository access before authorizing. Authorizing before
              installation causes GitHub to reject requests with a 401 Unauthorized error.
            </p>
            <div className="modal-actions">
              <a
                className="button secondary"
                href={resolveGitHubInstallationUrl(connection.installationUrl)}
                target="_blank"
                rel="noreferrer"
              >
                Install GitHub App
              </a>
              <button
                ref={confirmButtonRef}
                className="button primary"
                type="button"
                onClick={handleConfirmConnect}
              >
                I have installed it, Continue to Connect
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={handleCloseConnectConfirm}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

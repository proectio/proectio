import { Fragment, useEffect, useMemo, useState } from "react";
import type { InstallationInventory, RepositoryDetails, RepositoryGovernance } from "./github";
import { formatExactTime, formatRelativeTime, getDetectedTimeZone, listTimeZones } from "./time";

type SessionResponse = { authenticated: boolean };
type InventoryResponse = { installations: InstallationInventory[] } | { error: string };
type DetailsResponse = { details: RepositoryDetails } | { error: string };
type SecretInventory = {
  githubNames: string[];
  cloudflareNames: string[];
  comparison: Array<{
    name: string;
    presence: "github-only" | "cloudflare-only" | "both" | "missing";
    expected: Array<"github" | "cloudflare">;
    actual: Array<"github" | "cloudflare">;
    verdict: "expected" | "missing" | "unexpected" | "misplaced" | "unmanaged";
  }>;
  cloudflare: { configured: boolean; worker?: string; dashboardUrl?: string; appUrl?: string };
};
type SecretInventoryResponse = SecretInventory | { error: string };
type GovernanceEvaluation = {
  configured: boolean;
  healthy: boolean;
  findings: Array<{
    id: string;
    message: string;
    expected: string;
    actual: string;
  }>;
  expected?: {
    protected?: boolean;
    requiredPullRequestReviews?: boolean;
    minimumApprovals?: number;
    requiredStatusChecks?: string[];
    enforceAdmins?: boolean;
  };
};
type RepositoryGovernanceWithEvaluation = RepositoryGovernance & { evaluation: GovernanceEvaluation };
type GovernanceResponse = { governance: RepositoryGovernanceWithEvaluation } | { error: string };
type CloudflareRuntime = {
  configured: boolean;
  worker?: string;
  deployments?: Array<{
    id: string;
    createdOn: string;
    source?: string;
    strategy?: string;
    versions: Array<{ versionId: string; percentage: number }>;
  }>;
  bindings?: Array<{ name: string; type: string }>;
};
type CloudflareRuntimeResponse = { runtime: CloudflareRuntime } | { error: string };
type Filter = "all" | "public" | "private" | "archived";
type ChatGptReferenceMode = "url" | "name";


type UiIconName =
  | "key"
  | "workflow"
  | "shield"
  | "cloud"
  | "rocket"
  | "plug"
  | "placement"
  | "refresh"
  | "text"
  | "lock"
  | "package"
  | "settings";

function UiIcon({ name, size = 14 }: { name: UiIconName; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "key") {
    return <svg {...common}><circle cx="7.5" cy="15.5" r="3.5" /><path d="m10 13 8-8 2 2-2 2 1.5 1.5-2 2L16 11l-4 4" /></svg>;
  }
  if (name === "workflow") {
    return <svg {...common}><rect x="3" y="4" width="6" height="6" rx="1.5" /><rect x="15" y="14" width="6" height="6" rx="1.5" /><path d="M9 7h3a3 3 0 0 1 3 3v4" /><path d="m12 12 3 3 3-3" /></svg>;
  }
  if (name === "shield") {
    return <svg {...common}><path d="M12 3 5 6v5c0 4.6 2.9 8.1 7 10 4.1-1.9 7-5.4 7-10V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  }
  if (name === "cloud") {
    return <svg {...common}><path d="M17.5 19H7a4 4 0 0 1-.8-7.9A6 6 0 0 1 17.7 9a5 5 0 0 1-.2 10Z" /></svg>;
  }
  if (name === "rocket") {
    return <svg {...common}><path d="M14 5c2.5-2.5 5-2 5-2s.5 2.5-2 5l-5 5-4-4 6-4Z" /><path d="m9 10-4 1-2 3 5 1" /><path d="m14 15-1 4-3 2-1-5" /><circle cx="15.5" cy="6.5" r="1.2" /></svg>;
  }
  if (name === "plug") {
    return <svg {...common}><path d="M8 3v6M16 3v6" /><path d="M6 9h12v2a6 6 0 0 1-6 6v4" /><path d="M9 21h6" /></svg>;
  }
  if (name === "placement") {
    return <svg {...common}><path d="M4 6h7" /><path d="m8 3 3 3-3 3" /><path d="M20 18h-7" /><path d="m16 15-3 3 3 3" /><path d="M11 6c5 0 5 12 9 12" /><path d="M13 18c-5 0-5-12-9-12" /></svg>;
  }
  if (name === "text") {
    return <svg {...common}><path d="M6 4h12" /><path d="M6 9h12" /><path d="M6 14h8" /><path d="M6 19h10" /></svg>;
  }
  if (name === "lock") {
    return <svg {...common}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 1 1 8 0v3" /></svg>;
  }
  if (name === "package") {
    return <svg {...common}><path d="M12 3 4.5 7 12 11l7.5-4L12 3Z" /><path d="M4.5 7v10L12 21l7.5-4V7" /><path d="M12 11v10" /></svg>;
  }
  if (name === "settings") {
    return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.3 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z" /></svg>;
  }
  return <svg {...common}><path d="M20 6v5h-5" /><path d="M19 11a7 7 0 1 0 1 5" /></svg>;
}

function bindingTypeLabel(type: string): string {
  switch (type) {
    case "assets":
      return "Assets";
    case "plain_text":
      return "Plain text";
    case "secret_text":
      return "Secret text";
    default:
      return type;
  }
}

function bindingTypeIcon(type: string): UiIconName {
  switch (type) {
    case "assets":
      return "package";
    case "plain_text":
      return "text";
    case "secret_text":
      return "lock";
    default:
      return "plug";
  }
}

function chatGptRepositoryUrl(fullName: string, mode: ChatGptReferenceMode): string {
  const prompt = mode === "url" ? `https://github.com/${fullName}` : fullName;
  const url = new URL("https://chatgpt.com/");
  url.searchParams.set("prompt", prompt);
  return url.toString();
}

function secretCount(details: RepositoryDetails | undefined): number | null {
  if (!details) return null;
  return details.secrets.length + details.environments.reduce((sum, environment) => sum + environment.secrets.length, 0);
}

function providerLabel(provider: "github" | "cloudflare"): string {
  return provider === "github" ? "GitHub" : "Cloudflare";
}

function providerList(providers: Array<"github" | "cloudflare">): string {
  return providers.map(providerLabel).join(" + ");
}

function placementDescription(item: SecretInventory["comparison"][number]): string {
  const expected = providerList(item.expected);
  const actual = providerList(item.actual);

  switch (item.verdict) {
    case "expected":
      return expected || actual || "Configured provider";
    case "missing":
      return `Missing from ${expected || "expected provider"}`;
    case "unexpected":
      return `Unexpected in ${actual || "observed provider"}`;
    case "misplaced":
      return `Expected ${expected || "elsewhere"}, found in ${actual || "another provider"}`;
    case "unmanaged":
      return `Observed in ${actual || "provider"}, not in policy`;
  }
}

function RelativeTime({
  value,
  now,
  timeZone,
}: {
  value: string | null;
  now: number;
  timeZone: string;
}) {
  if (!value) return <span>Never</span>;

  return (
    <span className="relative-time" tabIndex={0}>
      {formatRelativeTime(value, now)}
      <span className="time-tooltip" role="tooltip">
        <strong>Local · {timeZone}</strong>
        <span>{formatExactTime(value, timeZone)}</span>
        <strong>UTC</strong>
        <span>{formatExactTime(value, "UTC")}</span>
      </span>
    </span>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [installations, setInstallations] = useState<InstallationInventory[]>([]);
  const [details, setDetails] = useState<Record<string, RepositoryDetails>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [secretInventory, setSecretInventory] = useState<Record<string, SecretInventory>>({});
  const [inventoryLoading, setInventoryLoading] = useState<Record<string, boolean>>({});
  const [governance, setGovernance] = useState<Record<string, RepositoryGovernanceWithEvaluation>>({});
  const [governanceLoading, setGovernanceLoading] = useState<Record<string, boolean>>({});
  const [cloudflareRuntime, setCloudflareRuntime] = useState<Record<string, CloudflareRuntime>>({});
  const [cloudflareRuntimeLoading, setCloudflareRuntimeLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const detectedTimeZone = useMemo(() => getDetectedTimeZone(), []);
  const timeZones = useMemo(() => listTimeZones(), []);
  const [timeZonePreference, setTimeZonePreference] = useState(() => localStorage.getItem("proectio-time-zone") || "auto");
  const [chatGptReferenceMode, setChatGptReferenceMode] = useState<ChatGptReferenceMode>(() =>
    localStorage.getItem("proectio-chatgpt-reference") === "name" ? "name" : "url"
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedTimeZone = timeZonePreference === "auto" ? detectedTimeZone : timeZonePreference;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("proectio-time-zone", timeZonePreference);
  }, [timeZonePreference]);

  useEffect(() => {
    localStorage.setItem("proectio-chatgpt-reference", chatGptReferenceMode);
  }, [chatGptReferenceMode]);

  useEffect(() => {
    fetch("/api/session")
      .then((response) => response.json() as Promise<SessionResponse>)
      .then((session) => setAuthenticated(session.authenticated))
      .catch(() => setAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    setLoading(true);
    fetch("/api/inventory")
      .then(async (response) => {
        const body = (await response.json()) as InventoryResponse;
        if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "Inventory request failed");
        setInstallations(body.installations);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Inventory request failed"))
      .finally(() => setLoading(false));
  }, [authenticated]);

  const repositories = useMemo(() => {
    return installations
      .flatMap((installation) => installation.repositories.map((repository) => ({ installation, repository })))
      .filter(({ repository }) => {
        if (filter === "public" && repository.private) return false;
        if (filter === "private" && !repository.private) return false;
        if (filter === "archived" && !repository.archived) return false;
        return repository.full_name.toLowerCase().includes(query.toLowerCase());
      });
  }, [installations, filter, query]);

  async function loadDetails(installationId: number, fullName: string, force = false) {
    if (!force && (details[fullName] || detailLoading[fullName])) return;
    setDetailLoading((current) => ({ ...current, [fullName]: true }));
    try {
      const params = new URLSearchParams({ installationId: String(installationId), repo: fullName });
      const response = await fetch(`/api/repository-details?${params}`);
      const body = (await response.json()) as DetailsResponse;
      if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "Details request failed");
      setDetails((current) => ({ ...current, [fullName]: body.details }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Details request failed");
    } finally {
      setDetailLoading((current) => ({ ...current, [fullName]: false }));
    }
  }

  async function loadSecretInventory(installationId: number, fullName: string, force = false) {
    if (!force && (secretInventory[fullName] || inventoryLoading[fullName])) return;
    setInventoryLoading((current) => ({ ...current, [fullName]: true }));
    try {
      const params = new URLSearchParams({ installationId: String(installationId), repo: fullName });
      const response = await fetch(`/api/secret-inventory?${params}`);
      const body = (await response.json()) as SecretInventoryResponse;
      if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "Secret inventory request failed");
      setSecretInventory((current) => ({ ...current, [fullName]: body }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Secret inventory request failed");
    } finally {
      setInventoryLoading((current) => ({ ...current, [fullName]: false }));
    }
  }

  async function loadGovernance(installationId: number, fullName: string, defaultBranch: string, force = false) {
    if (!force && (governance[fullName] || governanceLoading[fullName])) return;
    setGovernanceLoading((current) => ({ ...current, [fullName]: true }));
    try {
      const params = new URLSearchParams({
        installationId: String(installationId),
        repo: fullName,
        defaultBranch,
      });
      const response = await fetch(`/api/repository-governance?${params}`);
      const body = (await response.json()) as GovernanceResponse;
      if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "Governance request failed");
      setGovernance((current) => ({ ...current, [fullName]: body.governance }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Governance request failed");
    } finally {
      setGovernanceLoading((current) => ({ ...current, [fullName]: false }));
    }
  }

  async function loadCloudflareRuntime(fullName: string, force = false) {
    if (!force && (cloudflareRuntime[fullName] || cloudflareRuntimeLoading[fullName])) return;
    setCloudflareRuntimeLoading((current) => ({ ...current, [fullName]: true }));
    try {
      const params = new URLSearchParams({ repo: fullName });
      const response = await fetch(`/api/cloudflare-runtime?${params}`);
      const body = (await response.json()) as CloudflareRuntimeResponse;
      if (!response.ok || "error" in body) throw new Error("error" in body ? body.error : "Cloudflare runtime request failed");
      setCloudflareRuntime((current) => ({ ...current, [fullName]: body.runtime }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Cloudflare runtime request failed");
    } finally {
      setCloudflareRuntimeLoading((current) => ({ ...current, [fullName]: false }));
    }
  }

  async function refreshRepository(installationId: number, fullName: string, defaultBranch: string) {
    setError(null);
    await Promise.all([
      loadDetails(installationId, fullName, true),
      loadSecretInventory(installationId, fullName, true),
      loadGovernance(installationId, fullName, defaultBranch, true),
      loadCloudflareRuntime(fullName, true),
    ]);
  }

  useEffect(() => {
    for (const { installation, repository } of repositories) {
      void loadDetails(installation.installationId, repository.full_name);
      void loadSecretInventory(installation.installationId, repository.full_name);
      void loadGovernance(installation.installationId, repository.full_name, repository.default_branch);
      void loadCloudflareRuntime(repository.full_name);
    }
  }, [repositories]);

  if (authenticated === null) return <main className="shell"><p>Loading Proectio…</p></main>;

  if (!authenticated) {
    return (
      <main className="shell auth-shell">
        <div className="auth-card">
          <p className="eyebrow">Personal GitHub inventory</p>
          <h1>Proectio</h1>
          <p>One read-only view of repositories, visibility, recent activity, environments, and secret names.</p>
          <a className="button" href="/auth/github">Sign in with GitHub</a>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">GitHub control panel</p>
          <h1>Proectio</h1>
        </div>
        <div className="header-actions">
          <label className="timezone-control">
            <span>Time zone</span>
            <select value={timeZonePreference} onChange={(event) => setTimeZonePreference(event.target.value)}>
              <option value="auto">Auto · {detectedTimeZone}</option>
              <option value="UTC">UTC</option>
              {timeZones.filter((zone) => zone !== "UTC").map((zone) => (
                <option key={zone} value={zone}>{zone}</option>
              ))}
            </select>
          </label>
          <div className="settings-control">
            <button
              className="secondary settings-trigger"
              type="button"
              aria-expanded={settingsOpen}
              aria-controls="proectio-settings"
              onClick={() => setSettingsOpen((open) => !open)}
            >
              <UiIcon name="settings" size={14} />
              Settings
            </button>
            {settingsOpen && (
              <section className="settings-popover" id="proectio-settings" aria-label="Settings">
                <div className="settings-popover-header">
                  <strong>Settings</strong>
                  <button
                    className="settings-close"
                    type="button"
                    aria-label="Close settings"
                    onClick={() => setSettingsOpen(false)}
                  >
                    ×
                  </button>
                </div>
                <div className="settings-group">
                  <div>
                    <strong>ChatGPT repository reference</strong>
                    <span>Choose the only value passed to a new ChatGPT conversation.</span>
                  </div>
                  <div className="settings-toggle" role="group" aria-label="ChatGPT repository reference">
                    <button
                      type="button"
                      className={chatGptReferenceMode === "name" ? "active" : ""}
                      aria-pressed={chatGptReferenceMode === "name"}
                      onClick={() => setChatGptReferenceMode("name")}
                    >
                      Name
                    </button>
                    <button
                      type="button"
                      className={chatGptReferenceMode === "url" ? "active" : ""}
                      aria-pressed={chatGptReferenceMode === "url"}
                      onClick={() => setChatGptReferenceMode("url")}
                    >
                      URL
                    </button>
                  </div>
                  <code className="settings-preview">
                    {chatGptReferenceMode === "url" ? "https://github.com/owner/repository" : "owner/repository"}
                  </code>
                </div>
              </section>
            )}
          </div>
          <button className="secondary" onClick={() => fetch("/auth/logout", { method: "POST" }).then(() => location.reload())}>
            Sign out
          </button>
        </div>
      </header>

      <section className="stats">
        <div><strong>{repositories.length}</strong><span>Repositories</span></div>
        <div><strong>{installations.length}</strong><span>Accounts / orgs</span></div>
        <div><strong>{Object.keys(details).length}</strong><span>Repositories inspected</span></div>
      </section>

      <section className="toolbar">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search repositories…" />
        <div className="filters">
          {(["all", "public", "private", "archived"] as Filter[]).map((value) => (
            <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value}</button>
          ))}
        </div>
      </section>

      {loading && <p>Loading GitHub inventory…</p>}
      {error && <div className="error">{error}</div>}

      {!loading && (
        <section className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Repository</th>
                <th>Owner</th>
                <th>Visibility</th>
                <th>Last push</th>
                <th>GH secrets</th>
                <th>GH environments</th>
              </tr>
            </thead>
            <tbody>
              {repositories.map(({ installation, repository }) => {
                const fullName = repository.full_name;
                const repositoryDetails = details[fullName];
                const inventory = secretInventory[fullName];
                const repositoryGovernance = governance[fullName];
                const runtime = cloudflareRuntime[fullName];
                const githubSecretCount = secretCount(repositoryDetails);
                const placementIssues = inventory?.comparison.filter((item) => item.verdict !== "expected").length ?? 0;
                const governanceIssues = repositoryGovernance?.evaluation.findings.length ?? 0;
                const refreshing = Boolean(
                  detailLoading[fullName] ||
                  inventoryLoading[fullName] ||
                  governanceLoading[fullName] ||
                  cloudflareRuntimeLoading[fullName]
                );

                return (
                  <Fragment key={repository.id}>
                    <tr className="repository-row">
                      <td>
                        <div className="repository-name-line">
                          <div className="repository-primary">
                            <strong>
                              <a
                                className="repository-title-link"
                                href={`https://github.com/${fullName}`}
                                target="_blank"
                                rel="noreferrer"
                                title="Open GitHub repository"
                              >
                                {repository.name}
                              </a>
                            </strong>
                            {repository.archived && <span className="tag">Archived</span>}
                          </div>
                          {inventory && (
                            <div className="repository-meta">
                              <span
                                className={placementIssues === 0 ? "health health-ok" : "health health-warning"}
                                title={
                                  placementIssues === 0
                                    ? "All observed secret placements match policy"
                                    : `${placementIssues} secret placement issue${placementIssues === 1 ? "" : "s"}`
                                }
                              >
                                {placementIssues === 0 ? "Secrets in sync" : `${placementIssues} secret issue${placementIssues === 1 ? "" : "s"}`}
                              </span>
                              <span className="provider-summary">
                                GitHub {inventory.githubNames.length} · Cloudflare {inventory.cloudflareNames.length}
                              </span>
                              {repositoryGovernance?.evaluation.configured && (
                                <span
                                  className={governanceIssues === 0 ? "health health-ok" : "health health-warning"}
                                  title={
                                    governanceIssues === 0
                                      ? "Repository governance matches policy"
                                      : `${governanceIssues} governance issue${governanceIssues === 1 ? "" : "s"}`
                                  }
                                >
                                  {governanceIssues === 0 ? "Governance in sync" : `Governance ${governanceIssues} issue${governanceIssues === 1 ? "" : "s"}`}
                                </span>
                              )}
                              <div className="repository-links" aria-label={`${fullName} links`}>
                                {inventory.cloudflare.dashboardUrl && (
                                  <a className="repository-link" href={inventory.cloudflare.dashboardUrl} target="_blank" rel="noreferrer" title="Open Cloudflare Worker">
                                    <img src="https://www.cloudflare.com/favicon.ico" alt="" aria-hidden="true" />
                                    Worker
                                  </a>
                                )}
                                {inventory.cloudflare.appUrl && (
                                  <a className="repository-link" href={inventory.cloudflare.appUrl} target="_blank" rel="noreferrer" title="Open Cloudflare app">
                                    <img src="https://www.cloudflare.com/favicon.ico" alt="" aria-hidden="true" />
                                    CF App
                                  </a>
                                )}
                                {installation.githubAppUrl && (
                                  <a className="repository-link" href={installation.githubAppUrl} target="_blank" rel="noreferrer" title="Open GitHub App">
                                    <img src="https://github.githubassets.com/favicons/favicon.svg" alt="" aria-hidden="true" />
                                    GH App
                                  </a>
                                )}
                                <a
                                  className="repository-link"
                                  href={chatGptRepositoryUrl(fullName, chatGptReferenceMode)}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Start a new ChatGPT conversation about this repository"
                                >
                                  <img src="https://chatgpt.com/favicon.ico" alt="" aria-hidden="true" />
                                  ChatGPT
                                </a>
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td>{installation.account.login}</td>
                      <td>{repository.visibility}</td>
                      <td>
                        <RelativeTime value={repository.pushed_at} now={now} timeZone={selectedTimeZone} />
                      </td>
                      <td>
                        {githubSecretCount ?? (detailLoading[fullName] ? <span className="spinner" aria-label="Loading GitHub secret count" /> : "—")}
                      </td>
                      <td>
                        {repositoryDetails?.environments.length ??
                          (detailLoading[fullName] ? <span className="spinner" aria-label="Loading environment count" /> : "—")}
                      </td>
                    </tr>
                    <tr className="repository-details-row">
                      <td colSpan={6}>
                        <div className="repository-details-header">
                          <div>
                            <span className="details-title section-title"><UiIcon name="key" />Secrets</span>
                            <span className="details-subtitle">Names only. Values are never revealed.</span>
                          </div>
                          <button
                            className="icon-button"
                            onClick={() => void refreshRepository(installation.installationId, fullName, repository.default_branch)}
                            disabled={refreshing}
                            aria-label={`Refresh ${fullName}`}
                            title="Refresh secrets inventory"
                          >
                            {refreshing ? <span className="spinner" aria-hidden="true" /> : <UiIcon name="refresh" size={16} />}
                          </button>
                        </div>

                        <div className="secret-panels">
                          <section className="secret-panel">
                            <div className="secret-panel-header">
                              <div>
                                <strong>GitHub</strong>
                                <span>Repository: {fullName}</span>
                              </div>
                              {inventoryLoading[fullName] && !inventory ? (
                                <span className="inline-loading"><span className="spinner" aria-hidden="true" />Loading</span>
                              ) : (
                                <span className="count-badge">{inventory?.githubNames.length ?? 0}</span>
                              )}
                            </div>
                            {inventoryLoading[fullName] && !inventory && (
                              <div className="secret-skeleton" aria-hidden="true"><span /><span /><span /></div>
                            )}
                            {inventory && (
                              <div className="secret-list">
                                {inventory.githubNames.map((name) => <code key={name}>{name}</code>)}
                                {inventory.githubNames.length === 0 && <span className="empty-state">No secrets.</span>}
                              </div>
                            )}
                          </section>

                          <section className="secret-panel">
                            <div className="secret-panel-header">
                              <div>
                                <strong>Cloudflare</strong>
                                <span>{inventory?.cloudflare.worker ? `Worker: ${inventory.cloudflare.worker}` : "Worker secrets"}</span>
                              </div>
                              {inventoryLoading[fullName] && !inventory ? (
                                <span className="inline-loading"><span className="spinner" aria-hidden="true" />Loading</span>
                              ) : (
                                <span className="count-badge">{inventory?.cloudflareNames.length ?? 0}</span>
                              )}
                            </div>
                            {inventoryLoading[fullName] && !inventory && (
                              <div className="secret-skeleton" aria-hidden="true"><span /><span /><span /></div>
                            )}
                            {inventory && !inventory.cloudflare.configured && (
                              <span className="empty-state">Cloudflare inventory is not configured.</span>
                            )}
                            {inventory?.cloudflare.configured && (
                              <div className="secret-list">
                                {inventory.cloudflareNames.map((name) => <code key={name}>{name}</code>)}
                                {inventory.cloudflareNames.length === 0 && <span className="empty-state">No secrets.</span>}
                              </div>
                            )}
                          </section>
                        </div>

                        <section className="governance-panel">
                          <div className="governance-header">
                            <div>
                              <strong className="section-title"><UiIcon name="shield" />Repository governance</strong>
                              <span>GitHub Actions and default-branch protection</span>
                            </div>
                            {governanceLoading[fullName] && !repositoryGovernance && (
                              <span className="inline-loading"><span className="spinner" aria-hidden="true" />Loading</span>
                            )}
                          </div>

                          {repositoryGovernance && (
                            <div className="governance-grid">
                              <section className="governance-card">
                                <div className="governance-card-header">
                                  <strong className="card-title"><UiIcon name="workflow" />GitHub Actions</strong>
                                  {repositoryGovernance.actions.available && (
                                    <span className="count-badge">{repositoryGovernance.actions.workflows.length}</span>
                                  )}
                                </div>
                                {!repositoryGovernance.actions.available ? (
                                  <span className="governance-unavailable">Permission unavailable. Grant Actions: read to the Proectio GitHub App.</span>
                                ) : repositoryGovernance.actions.workflows.length === 0 ? (
                                  <span className="empty-state">No workflows.</span>
                                ) : (
                                  <div className="workflow-list">
                                    {repositoryGovernance.actions.workflows.map((workflow) => (
                                      <div className="workflow-item" key={workflow.id}>
                                        <strong>{workflow.name}</strong>
                                        <span>{workflow.path}</span>
                                        <span className="workflow-state">{workflow.state}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>

                              <section className="governance-card">
                                <div className="governance-card-header">
                                  <strong className="card-title"><UiIcon name="shield" />Branch protection</strong>
                                  <div className="governance-card-meta">
                                    {repositoryGovernance.evaluation.configured && (
                                      <span className={governanceIssues === 0 ? "count-badge policy-ok" : "count-badge policy-issue"}>
                                        {governanceIssues === 0 ? "✓" : governanceIssues}
                                      </span>
                                    )}
                                    <span className="branch-name">{repository.default_branch}</span>
                                  </div>
                                </div>
                                {!repositoryGovernance.branchProtection.available ? (
                                  <div className="permission-unavailable">
                                    <span className="governance-unavailable">Permission unavailable. Grant Administration: read to the Proectio GitHub App.</span>
                                    <a
                                      className="permission-review-link"
                                      href={installation.installationUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      Review permissions
                                    </a>
                                  </div>
                                ) : repositoryGovernance.evaluation.configured && governanceIssues > 0 ? (
                                  <div className="governance-findings">
                                    {repositoryGovernance.evaluation.findings.map((finding) => (
                                      <div className="governance-finding" key={finding.id}>
                                        <span className="finding-mark">!</span>
                                        <div>
                                          <strong>{finding.message}</strong>
                                          <span>Expected: {finding.expected} · Actual: {finding.actual}</span>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                ) : repositoryGovernance.branchProtection.summary?.protected ? (
                                  <div className="protection-list">
                                    <span>✓ Protected</span>
                                    <span>{repositoryGovernance.branchProtection.summary.requiredPullRequestReviews ? "✓ Pull request reviews required" : "No required pull request reviews"}</span>
                                    <span>{repositoryGovernance.branchProtection.summary.requiredStatusChecks.length > 0
                                      ? `✓ ${repositoryGovernance.branchProtection.summary.requiredStatusChecks.length} required status check${repositoryGovernance.branchProtection.summary.requiredStatusChecks.length === 1 ? "" : "s"}`
                                      : "No required status checks"}</span>
                                    <span>{repositoryGovernance.branchProtection.summary.enforceAdmins ? "✓ Applies to admins" : "Does not enforce admins"}</span>
                                  </div>
                                ) : (
                                  <span className="governance-warning">Default branch is not protected.</span>
                                )}
                                {repositoryGovernance.evaluation.configured && repositoryGovernance.evaluation.expected && (
                                  <div className="expected-policy">
                                    <span>Expected</span>
                                    <code>protected</code>
                                    {repositoryGovernance.evaluation.expected.requiredPullRequestReviews && <code>PR reviews</code>}
                                    {(repositoryGovernance.evaluation.expected.minimumApprovals ?? 0) > 0 && (
                                      <code>{repositoryGovernance.evaluation.expected.minimumApprovals} approval</code>
                                    )}
                                    {(repositoryGovernance.evaluation.expected.requiredStatusChecks ?? []).map((check) => (
                                      <code key={check}>check: {check}</code>
                                    ))}
                                    {repositoryGovernance.evaluation.expected.enforceAdmins && <code>admins enforced</code>}
                                  </div>
                                )}
                              </section>
                            </div>
                          )}
                        </section>

                        <section className="runtime-panel">
                          <div className="runtime-header">
                            <div>
                              <strong className="section-title"><UiIcon name="cloud" />Cloudflare runtime</strong>
                              <span>Deployments and Worker bindings</span>
                            </div>
                            {cloudflareRuntimeLoading[fullName] && !runtime && (
                              <span className="inline-loading"><span className="spinner" aria-hidden="true" />Loading</span>
                            )}
                          </div>

                          {runtime && !runtime.configured && (
                            <span className="governance-unavailable">No Cloudflare Worker mapping for this repository.</span>
                          )}

                          {runtime?.configured && (
                            <div className="runtime-grid">
                              <section className="runtime-card">
                                <div className="runtime-card-header">
                                  <strong className="card-title"><UiIcon name="rocket" />Deployments</strong>
                                  <span className="count-badge">{runtime.deployments?.length ?? 0}</span>
                                </div>
                                {(runtime.deployments?.length ?? 0) === 0 ? (
                                  <span className="empty-state">No deployments.</span>
                                ) : (
                                  <div className="deployment-list">
                                    {(runtime.deployments ?? []).slice(0, 5).map((deployment) => (
                                      <div className="deployment-item" key={deployment.id}>
                                        <div>
                                          <strong>{deployment.source || "deployment"}</strong>
                                          <span>{deployment.strategy || "percentage"} · {deployment.versions.length} version{deployment.versions.length === 1 ? "" : "s"}</span>
                                        </div>
                                        <RelativeTime value={deployment.createdOn} now={now} timeZone={selectedTimeZone} />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>

                              <section className="runtime-card">
                                <div className="runtime-card-header">
                                  <strong className="card-title"><UiIcon name="plug" />Bindings</strong>
                                  <span className="count-badge">{runtime.bindings?.length ?? 0}</span>
                                </div>
                                {(runtime.bindings?.length ?? 0) === 0 ? (
                                  <span className="empty-state">No bindings.</span>
                                ) : (
                                  <div className="binding-list">
                                    {(runtime.bindings ?? []).map((binding) => (
                                      <div className="binding-item" key={binding.name}>
                                        <code>{binding.name}</code>
                                        <span
                                          className="binding-type-icon"
                                          tabIndex={0}
                                          aria-label={bindingTypeLabel(binding.type)}
                                        >
                                          <UiIcon name={bindingTypeIcon(binding.type)} size={14} />
                                          <span className="binding-type-tooltip" role="tooltip">
                                            {bindingTypeLabel(binding.type)}
                                          </span>
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </section>
                            </div>
                          )}
                        </section>

                        {inventory && (
                          <section className="placement-panel">
                            <div className="placement-header">
                              <strong className="section-title"><UiIcon name="placement" />Placement</strong>
                              <span>{placementIssues === 0 ? "All observed secrets match policy." : `${placementIssues} placement issue${placementIssues === 1 ? "" : "s"}.`}</span>
                            </div>
                            {inventory.comparison.length === 0 ? (
                              <span className="empty-state">No secrets to evaluate.</span>
                            ) : (
                              <div className={placementIssues === 0 ? "placement-list placement-list-healthy" : "placement-list"}>
                                {inventory.comparison.map((item) => (
                                  <div className="placement-item" key={item.name} data-verdict={item.verdict}>
                                    <code>{item.name}</code>
                                    <span className="placement-status">{item.verdict === "expected" ? "✓" : "!"}</span>
                                    <span>{placementDescription(item)}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </section>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

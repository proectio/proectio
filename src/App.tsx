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
type GovernanceResponse = { governance: RepositoryGovernance } | { error: string };
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
  const [governance, setGovernance] = useState<Record<string, RepositoryGovernance>>({});
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
  const selectedTimeZone = timeZonePreference === "auto" ? detectedTimeZone : timeZonePreference;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("proectio-time-zone", timeZonePreference);
  }, [timeZonePreference]);

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
                            <span className="details-title">Secrets</span>
                            <span className="details-subtitle">Names only. Values are never revealed.</span>
                          </div>
                          <button
                            className="icon-button"
                            onClick={() => void refreshRepository(installation.installationId, fullName, repository.default_branch)}
                            disabled={refreshing}
                            aria-label={`Refresh ${fullName}`}
                            title="Refresh secrets inventory"
                          >
                            {refreshing ? <span className="spinner" aria-hidden="true" /> : "↻"}
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
                              <strong>Repository governance</strong>
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
                                  <strong>GitHub Actions</strong>
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
                                  <strong>Branch protection</strong>
                                  <span className="branch-name">{repository.default_branch}</span>
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
                              </section>
                            </div>
                          )}
                        </section>

                        <section className="runtime-panel">
                          <div className="runtime-header">
                            <div>
                              <strong>Cloudflare runtime</strong>
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
                                  <strong>Deployments</strong>
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
                                  <strong>Bindings</strong>
                                  <span className="count-badge">{runtime.bindings?.length ?? 0}</span>
                                </div>
                                {(runtime.bindings?.length ?? 0) === 0 ? (
                                  <span className="empty-state">No bindings.</span>
                                ) : (
                                  <div className="binding-list">
                                    {(runtime.bindings ?? []).map((binding) => (
                                      <div className="binding-item" key={binding.name}>
                                        <code>{binding.name}</code>
                                        <span>{binding.type}</span>
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
                              <strong>Placement</strong>
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

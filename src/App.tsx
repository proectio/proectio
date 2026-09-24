import { Fragment, useEffect, useMemo, useState } from "react";
import type { InstallationInventory, RepositoryDetails } from "./github";
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
  cloudflare: { configured: boolean; worker?: string };
};
type SecretInventoryResponse = SecretInventory | { error: string };
type Filter = "all" | "public" | "private" | "archived";

function secretCount(details: RepositoryDetails | undefined): number | null {
  if (!details) return null;
  return details.secrets.length + details.environments.reduce((sum, environment) => sum + environment.secrets.length, 0);
}

function placementDescription(item: SecretInventory["comparison"][number]): string {
  const expected = item.expected.join(" + ");
  const actual = item.actual.join(" + ");

  switch (item.verdict) {
    case "expected":
      return `Expected in ${expected || actual || "configured provider"}`;
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
        <strong>UTC</strong>
        <span>{formatExactTime(value, "UTC")}</span>
        <strong>{timeZone}</strong>
        <span>{formatExactTime(value, timeZone)}</span>
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

  async function refreshRepository(installationId: number, fullName: string) {
    setError(null);
    await Promise.all([
      loadDetails(installationId, fullName, true),
      loadSecretInventory(installationId, fullName, true),
    ]);
  }

  useEffect(() => {
    for (const { installation, repository } of repositories) {
      void loadDetails(installation.installationId, repository.full_name);
      void loadSecretInventory(installation.installationId, repository.full_name);
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
                <th>GitHub secrets</th>
                <th>Environments</th>
              </tr>
            </thead>
            <tbody>
              {repositories.map(({ installation, repository }) => {
                const fullName = repository.full_name;
                const repositoryDetails = details[fullName];
                const inventory = secretInventory[fullName];
                const githubSecretCount = secretCount(repositoryDetails);
                const placementIssues = inventory?.comparison.filter((item) => item.verdict !== "expected").length ?? 0;
                const refreshing = Boolean(detailLoading[fullName] || inventoryLoading[fullName]);

                return (
                  <Fragment key={repository.id}>
                    <tr className="repository-row">
                      <td>
                        <div className="repository-name-line">
                          <strong>{repository.name}</strong>
                          {repository.archived && <span className="tag">Archived</span>}
                          {inventory && (
                            <span className={placementIssues === 0 ? "health health-ok" : "health health-warning"}>
                              {placementIssues === 0 ? "In sync" : `${placementIssues} issue${placementIssues === 1 ? "" : "s"}`}
                            </span>
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
                            onClick={() => void refreshRepository(installation.installationId, fullName)}
                            disabled={refreshing}
                            aria-label={`Refresh ${fullName}`}
                            title="Refresh repository inspection"
                          >
                            {refreshing ? <span className="spinner" aria-hidden="true" /> : "↻"}
                          </button>
                        </div>

                        <div className="secret-panels">
                          <section className="secret-panel">
                            <div className="secret-panel-header">
                              <div>
                                <strong>GitHub</strong>
                                <span>Repository and environment secrets</span>
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

                        {inventory && (
                          <section className="placement-panel">
                            <div className="placement-header">
                              <strong>Placement</strong>
                              <span>{placementIssues === 0 ? "All observed secrets match policy." : `${placementIssues} placement issue${placementIssues === 1 ? "" : "s"}.`}</span>
                            </div>
                            {inventory.comparison.length === 0 ? (
                              <span className="empty-state">No secrets to evaluate.</span>
                            ) : (
                              <div className="placement-list">
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

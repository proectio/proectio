import { useEffect, useMemo, useState } from "react";
import type { InstallationInventory, RepositoryDetails } from "./github";

type SessionResponse = { authenticated: boolean };
type InventoryResponse = { installations: InstallationInventory[] } | { error: string };
type DetailsResponse = { details: RepositoryDetails } | { error: string };
type Filter = "all" | "public" | "private" | "archived";

function formatDate(value: string | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function secretCount(details: RepositoryDetails | undefined): number | null {
  if (!details) return null;
  return details.secrets.length + details.environments.reduce((sum, environment) => sum + environment.secrets.length, 0);
}

export default function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [installations, setInstallations] = useState<InstallationInventory[]>([]);
  const [details, setDetails] = useState<Record<string, RepositoryDetails>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

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

  async function loadDetails(installationId: number, fullName: string) {
    if (details[fullName] || detailLoading[fullName]) return;
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
        <button className="secondary" onClick={() => fetch("/auth/logout", { method: "POST" }).then(() => location.reload())}>
          Sign out
        </button>
      </header>

      <section className="stats">
        <div><strong>{repositories.length}</strong><span>Repositories shown</span></div>
        <div><strong>{installations.length}</strong><span>Accounts / orgs</span></div>
        <div><strong>{Object.keys(details).length}</strong><span>Repos inspected for secrets</span></div>
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
              <tr><th>Repository</th><th>Owner</th><th>Visibility</th><th>Last push</th><th>Secrets</th><th>Environments</th></tr>
            </thead>
            <tbody>
              {repositories.map(({ installation, repository }) => {
                const repositoryDetails = details[repository.full_name];
                const count = secretCount(repositoryDetails);
                return (
                  <tr key={repository.id}>
                    <td>
                      <strong>{repository.name}</strong>
                      {repository.archived && <span className="tag">Archived</span>}
                      <details onToggle={(event) => {
                        if (event.currentTarget.open) void loadDetails(installation.installationId, repository.full_name);
                      }}>
                        <summary>{detailLoading[repository.full_name] ? "Loading secret names…" : "Secret names"}</summary>
                        {repositoryDetails && (
                          <div className="secret-list">
                            {repositoryDetails.secrets.map((secret) => <code key={secret.name}>{secret.name}</code>)}
                            {repositoryDetails.environments.flatMap((environment) =>
                              environment.secrets.map((secret) => <code key={`${environment.name}:${secret.name}`}>{environment.name}: {secret.name}</code>),
                            )}
                            {count === 0 && <span>None</span>}
                          </div>
                        )}
                      </details>
                    </td>
                    <td>{installation.account.login}</td>
                    <td>{repository.visibility}</td>
                    <td>{formatDate(repository.pushed_at)}</td>
                    <td>{count ?? "Load"}</td>
                    <td>{repositoryDetails?.environments.length ?? "Load"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

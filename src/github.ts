export interface GitHubRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  visibility: "public" | "private" | "internal";
  archived: boolean;
  pushed_at: string | null;
  default_branch: string;
}

export interface GitHubSecret {
  name: string;
  created_at: string;
  updated_at: string;
}

export interface GitHubEnvironment {
  name: string;
  secrets: GitHubSecret[];
}

export interface RepositoryDetails {
  secrets: GitHubSecret[];
  environments: GitHubEnvironment[];
}

export interface InstallationInventory {
  installationId: number;
  account: {
    login: string;
    type: string;
  };
  repositories: GitHubRepository[];
}

interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    type: string;
  };
}

interface InstallationTokenResponse {
  token: string;
}

interface RepositoryListResponse {
  repositories: GitHubRepository[];
}

interface SecretListResponse {
  secrets: GitHubSecret[];
}

interface EnvironmentListResponse {
  environments: Array<{ name: string }>;
}

const apiVersion = "2022-11-28";

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n");
  const base64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  if (!pem.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "GITHUB_PRIVATE_KEY must be PKCS#8 PEM. Convert the GitHub key with: openssl pkcs8 -topk8 -nocrypt -in key.pem -out key-pkcs8.pem",
    );
  }

  return crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function createAppJwt(appId: string, privateKey: string, now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000) - 60;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: issuedAt,
      exp: issuedAt + 9 * 60,
      iss: appId,
    }),
  );
  const unsignedToken = `${header}.${payload}`;
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken),
  );
  return `${unsignedToken}.${base64Url(new Uint8Array(signature))}`;
}

async function githubJson<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", apiVersion);
  headers.set("User-Agent", "Repory");

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 500)}`);
  }

  return (await response.json()) as T;
}

async function listInstallations(appJwt: string): Promise<GitHubInstallation[]> {
  return githubJson<GitHubInstallation[]>("https://api.github.com/app/installations?per_page=100", appJwt);
}

async function createInstallationToken(appJwt: string, installationId: number): Promise<string> {
  const result = await githubJson<InstallationTokenResponse>(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    appJwt,
    { method: "POST" },
  );
  return result.token;
}

async function listRepositories(token: string): Promise<GitHubRepository[]> {
  const repositories: GitHubRepository[] = [];
  let page = 1;

  while (true) {
    const result = await githubJson<RepositoryListResponse>(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      token,
    );
    repositories.push(...result.repositories);
    if (result.repositories.length < 100) break;
    page += 1;
  }

  return repositories;
}

async function listRepositorySecrets(token: string, fullName: string): Promise<GitHubSecret[]> {
  const result = await githubJson<SecretListResponse>(
    `https://api.github.com/repos/${fullName}/actions/secrets?per_page=100`,
    token,
  );
  return result.secrets;
}

async function listEnvironmentSecrets(token: string, fullName: string): Promise<GitHubEnvironment[]> {
  const result = await githubJson<EnvironmentListResponse>(
    `https://api.github.com/repos/${fullName}/environments?per_page=100`,
    token,
  );

  const environments: GitHubEnvironment[] = [];
  for (const environment of result.environments) {
    const secretResult = await githubJson<SecretListResponse>(
      `https://api.github.com/repos/${fullName}/environments/${encodeURIComponent(environment.name)}/secrets?per_page=100`,
      token,
    );
    environments.push({ name: environment.name, secrets: secretResult.secrets });
  }
  return environments;
}

export async function loadInventory(appId: string, privateKey: string): Promise<InstallationInventory[]> {
  const appJwt = await createAppJwt(appId, privateKey);
  const installations = await listInstallations(appJwt);
  const inventory: InstallationInventory[] = [];

  for (const installation of installations) {
    const token = await createInstallationToken(appJwt, installation.id);
    inventory.push({
      installationId: installation.id,
      account: installation.account,
      repositories: await listRepositories(token),
    });
  }

  return inventory;
}

export async function loadRepositoryDetails(
  appId: string,
  privateKey: string,
  installationId: number,
  fullName: string,
): Promise<RepositoryDetails> {
  const appJwt = await createAppJwt(appId, privateKey);
  const token = await createInstallationToken(appJwt, installationId);
  const [secrets, environments] = await Promise.all([
    listRepositorySecrets(token, fullName),
    listEnvironmentSecrets(token, fullName),
  ]);
  return { secrets, environments };
}

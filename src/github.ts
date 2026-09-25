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

export interface GitHubWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export interface BranchProtectionSummary {
  branch: string;
  protected: boolean;
  requiredStatusChecks: string[];
  enforceAdmins: boolean;
  requiredPullRequestReviews: boolean;
  requiredApprovingReviewCount: number;
  restrictions: boolean;
}

export interface RepositoryGovernance {
  actions: {
    available: boolean;
    workflows: GitHubWorkflow[];
    error?: string;
  };
  branchProtection: {
    available: boolean;
    summary?: BranchProtectionSummary;
    error?: string;
  };
}

export interface InstallationInventory {
  installationId: number;
  account: {
    login: string;
    type: string;
  };
  githubAppUrl?: string;
  installationUrl: string;
  repositories: GitHubRepository[];
}

interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    type: string;
  };
}

interface GitHubAppMetadata {
  html_url?: string;
  slug?: string;
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

interface WorkflowListResponse {
  workflows: GitHubWorkflow[];
}

interface BranchProtectionResponse {
  required_status_checks?: {
    contexts?: string[];
    checks?: Array<{ context: string; app_id: number | null }>;
  } | null;
  enforce_admins?: { enabled: boolean } | null;
  required_pull_request_reviews?: {
    required_approving_review_count?: number;
  } | null;
  restrictions?: unknown;
}

const apiVersion = "2022-11-28";

function base64Url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return new Uint8Array([length]);

  const octets: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    octets.unshift(remaining & 0xff);
    remaining >>= 8;
  }

  return new Uint8Array([0x80 | octets.length, ...octets]);
}

function decodePem(pem: string, label: string): Uint8Array {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(`-----BEGIN ${label}-----`, "")
    .replace(`-----END ${label}-----`, "")
    .replace(/\s/g, "");

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const rsaAlgorithmIdentifier = new Uint8Array([
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  ]);
  const privateKey = concatBytes(new Uint8Array([0x04]), derLength(pkcs1.length), pkcs1);
  const body = concatBytes(version, rsaAlgorithmIdentifier, privateKey);
  return concatBytes(new Uint8Array([0x30]), derLength(body.length), body);
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function privateKeyDer(pem: string): ArrayBuffer {
  if (pem.includes("BEGIN PRIVATE KEY")) {
    return bytesToArrayBuffer(decodePem(pem, "PRIVATE KEY"));
  }

  if (pem.includes("BEGIN RSA PRIVATE KEY")) {
    return bytesToArrayBuffer(wrapPkcs1AsPkcs8(decodePem(pem, "RSA PRIVATE KEY")));
  }

  throw new Error("GITHUB_PRIVATE_KEY must be a PKCS#8 or RSA PEM private key");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    privateKeyDer(pem),
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

class GitHubApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function githubJson<T>(url: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-GitHub-Api-Version", apiVersion);
  headers.set("User-Agent", "Proectio");

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new GitHubApiError(response.status, `GitHub API ${response.status}: ${body.slice(0, 500)}`);
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


async function listWorkflows(token: string, fullName: string): Promise<GitHubWorkflow[]> {
  const result = await githubJson<WorkflowListResponse>(
    `https://api.github.com/repos/${fullName}/actions/workflows?per_page=100`,
    token,
  );
  return result.workflows;
}

async function loadBranchProtection(
  token: string,
  fullName: string,
  branch: string,
): Promise<BranchProtectionSummary> {
  try {
    const result = await githubJson<BranchProtectionResponse>(
      `https://api.github.com/repos/${fullName}/branches/${encodeURIComponent(branch)}/protection`,
      token,
    );

    const contexts = new Set<string>(result.required_status_checks?.contexts ?? []);
    for (const check of result.required_status_checks?.checks ?? []) contexts.add(check.context);

    return {
      branch,
      protected: true,
      requiredStatusChecks: [...contexts].sort(),
      enforceAdmins: Boolean(result.enforce_admins?.enabled),
      requiredPullRequestReviews: Boolean(result.required_pull_request_reviews),
      requiredApprovingReviewCount: result.required_pull_request_reviews?.required_approving_review_count ?? 0,
      restrictions: Boolean(result.restrictions),
    };
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return {
        branch,
        protected: false,
        requiredStatusChecks: [],
        enforceAdmins: false,
        requiredPullRequestReviews: false,
        requiredApprovingReviewCount: 0,
        restrictions: false,
      };
    }
    throw error;
  }
}

export async function loadInventory(appId: string, privateKey: string): Promise<InstallationInventory[]> {
  const appJwt = await createAppJwt(appId, privateKey);
  const [installations, appMetadata] = await Promise.all([
    listInstallations(appJwt),
    githubJson<GitHubAppMetadata>("https://api.github.com/app", appJwt),
  ]);
  const inventory: InstallationInventory[] = [];
  const githubAppUrl = appMetadata.html_url || (appMetadata.slug ? `https://github.com/apps/${appMetadata.slug}` : undefined);

  for (const installation of installations) {
    const token = await createInstallationToken(appJwt, installation.id);
    const installationUrl =
      installation.account.type === "Organization"
        ? `https://github.com/organizations/${installation.account.login}/settings/installations/${installation.id}`
        : `https://github.com/settings/installations/${installation.id}`;

    inventory.push({
      installationId: installation.id,
      account: installation.account,
      githubAppUrl,
      installationUrl,
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


export async function loadRepositoryGovernance(
  appId: string,
  privateKey: string,
  installationId: number,
  fullName: string,
  defaultBranch: string,
): Promise<RepositoryGovernance> {
  const appJwt = await createAppJwt(appId, privateKey);
  const token = await createInstallationToken(appJwt, installationId);

  const [actionsResult, protectionResult] = await Promise.allSettled([
    listWorkflows(token, fullName),
    loadBranchProtection(token, fullName, defaultBranch),
  ]);

  return {
    actions:
      actionsResult.status === "fulfilled"
        ? { available: true, workflows: actionsResult.value }
        : {
            available: false,
            workflows: [],
            error: actionsResult.reason instanceof Error ? actionsResult.reason.message : "Unable to load workflows",
          },
    branchProtection:
      protectionResult.status === "fulfilled"
        ? { available: true, summary: protectionResult.value }
        : {
            available: false,
            error: protectionResult.reason instanceof Error ? protectionResult.reason.message : "Unable to load branch protection",
          },
  };
}

export interface CloudflareSecret {
  name: string;
  type?: string;
}

export interface CloudflareDeployment {
  id: string;
  createdOn: string;
  source?: string;
  strategy?: string;
  versions: Array<{
    versionId: string;
    percentage: number;
  }>;
}

export interface CloudflareBinding {
  name: string;
  type: string;
}

interface CloudflareEnvelope<T> {
  success: boolean;
  result: T;
  errors?: Array<{ code?: number; message?: string }>;
}

interface CloudflareDeploymentApi {
  id: string;
  created_on: string;
  source?: string;
  strategy?: string;
  versions?: Array<{
    version_id: string;
    percentage: number;
  }>;
}

interface CloudflareDeploymentListResult {
  deployments?: CloudflareDeploymentApi[];
}

interface CloudflareWorkerSettings {
  bindings?: Array<Record<string, unknown>>;
}

function apiError(status: number, errors: Array<{ message?: string }> | undefined, fallback: string): Error {
  const message = errors?.map((error) => error.message).filter(Boolean).join("; ");
  return new Error(`Cloudflare API ${status}: ${message || fallback}`);
}

async function cloudflareJson<T>(url: string, apiToken: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: "application/json",
    },
  });

  const body = (await response.json()) as CloudflareEnvelope<T>;
  if (!response.ok || !body.success) {
    throw apiError(response.status, body.errors, "request failed");
  }

  return body.result;
}

export async function listWorkerSecretNames(
  accountId: string,
  apiToken: string,
  workerName: string,
): Promise<CloudflareSecret[]> {
  const result = await cloudflareJson<Array<{ name: string; type?: string }>>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
    apiToken,
  );

  return result.map(({ name, type }) => ({ name, type }));
}

export async function listWorkerDeployments(
  accountId: string,
  apiToken: string,
  workerName: string,
): Promise<CloudflareDeployment[]> {
  const result = await cloudflareJson<CloudflareDeploymentListResult>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/deployments?per_page=10`,
    apiToken,
  );

  return (result.deployments ?? []).map((deployment) => ({
    id: deployment.id,
    createdOn: deployment.created_on,
    source: deployment.source,
    strategy: deployment.strategy,
    versions: (deployment.versions ?? []).map((version) => ({
      versionId: version.version_id,
      percentage: version.percentage,
    })),
  }));
}

export async function listWorkerBindings(
  accountId: string,
  apiToken: string,
  workerName: string,
): Promise<CloudflareBinding[]> {
  const result = await cloudflareJson<CloudflareWorkerSettings>(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/settings`,
    apiToken,
  );

  return (result.bindings ?? [])
    .map((binding) => ({
      name: typeof binding.name === "string" ? binding.name : "",
      type: typeof binding.type === "string" ? binding.type : "unknown",
    }))
    .filter((binding) => binding.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

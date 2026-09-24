export interface CloudflareSecret {
  name: string;
  type?: string;
}

interface CloudflareSecretsResponse {
  success: boolean;
  result: Array<{ name: string; type?: string }>;
  errors?: Array<{ code?: number; message?: string }>;
}

export async function listWorkerSecretNames(
  accountId: string,
  apiToken: string,
  workerName: string,
): Promise<CloudflareSecret[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${encodeURIComponent(workerName)}/secrets`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
    },
  );

  const body = (await response.json()) as CloudflareSecretsResponse;
  if (!response.ok || !body.success) {
    const message = body.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(`Cloudflare API ${response.status}: ${message || "unable to list Worker secrets"}`);
  }

  return body.result.map(({ name, type }) => ({ name, type }));
}

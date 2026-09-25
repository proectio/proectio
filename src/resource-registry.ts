import repositoryResources from "../config/repository-resources.json";

export interface CloudflareRepositoryResource {
  accountId: string;
  worker: string;
  appUrl?: string;
}

export interface RepositoryResource {
  repository: string;
  cloudflare?: CloudflareRepositoryResource;
}

interface RepositoryResourceRegistry {
  repositories: RepositoryResource[];
}

const registry = repositoryResources as RepositoryResourceRegistry;

export function resourceForRepository(fullName: string): RepositoryResource | undefined {
  return registry.repositories.find((resource) => resource.repository === fullName);
}

export function cloudflareResourceForRepository(fullName: string): CloudflareRepositoryResource | undefined {
  return resourceForRepository(fullName)?.cloudflare;
}

export function resolveCloudflareAppUrl(
  resource: CloudflareRepositoryResource,
  requestOrigin: string,
): string | undefined {
  if (!resource.appUrl) return undefined;
  return resource.appUrl === "$request-origin" ? requestOrigin : resource.appUrl;
}

export function cloudflareDashboardUrl(resource: CloudflareRepositoryResource): string {
  return `https://dash.cloudflare.com/${resource.accountId}/workers/services/view/${encodeURIComponent(resource.worker)}/production`;
}

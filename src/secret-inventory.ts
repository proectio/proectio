export type SecretPresence = "github-only" | "cloudflare-only" | "both";

export interface SecretComparison {
  name: string;
  presence: SecretPresence;
}

export function compareSecretNames(githubNames: string[], cloudflareNames: string[]): SecretComparison[] {
  const github = new Set(githubNames);
  const cloudflare = new Set(cloudflareNames);
  const names = [...new Set([...github, ...cloudflare])].sort((a, b) => a.localeCompare(b));

  return names.map((name) => ({
    name,
    presence: github.has(name) && cloudflare.has(name)
      ? "both"
      : github.has(name)
        ? "github-only"
        : "cloudflare-only",
  }));
}

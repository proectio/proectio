export type SecretProvider = "github" | "cloudflare";
export type SecretPresence = "github-only" | "cloudflare-only" | "both" | "missing";
export type SecretVerdict = "expected" | "missing" | "unexpected" | "misplaced" | "unmanaged";

export interface SecretComparison {
  name: string;
  presence: SecretPresence;
  expected: SecretProvider[];
  actual: SecretProvider[];
  verdict: SecretVerdict;
}

export type SecretPlacementPolicy = Record<string, SecretProvider[]>;

function presenceFor(actual: SecretProvider[]): SecretPresence {
  if (actual.length === 0) return "missing";
  if (actual.length === 2) return "both";
  return actual[0] === "github" ? "github-only" : "cloudflare-only";
}

function sameProviders(left: SecretProvider[], right: SecretProvider[]): boolean {
  return left.length === right.length && left.every((provider) => right.includes(provider));
}

export function compareSecretNames(
  githubNames: string[],
  cloudflareNames: string[],
  policy: SecretPlacementPolicy = {},
): SecretComparison[] {
  const github = new Set(githubNames);
  const cloudflare = new Set(cloudflareNames);
  const names = [...new Set([...github, ...cloudflare, ...Object.keys(policy)])].sort((a, b) => a.localeCompare(b));

  return names.map((name) => {
    const actual: SecretProvider[] = [
      ...(github.has(name) ? ["github" as const] : []),
      ...(cloudflare.has(name) ? ["cloudflare" as const] : []),
    ];
    const expected = policy[name] ?? [];

    let verdict: SecretVerdict;
    if (expected.length === 0) {
      verdict = "unmanaged";
    } else if (sameProviders(actual, expected)) {
      verdict = "expected";
    } else {
      const missingExpected = expected.some((provider) => !actual.includes(provider));
      const unexpectedActual = actual.some((provider) => !expected.includes(provider));
      verdict = missingExpected && unexpectedActual
        ? "misplaced"
        : missingExpected
          ? "missing"
          : "unexpected";
    }

    return { name, presence: presenceFor(actual), expected, actual, verdict };
  });
}

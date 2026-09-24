import { describe, expect, it } from "vitest";
import { compareSecretNames } from "./secret-inventory";

describe("compareSecretNames", () => {
  it("classifies observed secret names without policy as unmanaged", () => {
    expect(compareSecretNames(
      ["GH_ONLY", "SHARED_NAME"],
      ["CF_ONLY", "SHARED_NAME"],
    )).toEqual([
      { name: "CF_ONLY", presence: "cloudflare-only", expected: [], actual: ["cloudflare"], verdict: "unmanaged" },
      { name: "GH_ONLY", presence: "github-only", expected: [], actual: ["github"], verdict: "unmanaged" },
      { name: "SHARED_NAME", presence: "both", expected: [], actual: ["github", "cloudflare"], verdict: "unmanaged" },
    ]);
  });

  it("evaluates expected, missing, unexpected, and misplaced placements", () => {
    expect(compareSecretNames(
      ["GITHUB_ONLY", "BOTH", "EXTRA_PROVIDER"],
      ["CLOUDFLARE_ONLY", "BOTH", "MISPLACED", "EXTRA_PROVIDER"],
      {
        GITHUB_ONLY: ["github"],
        CLOUDFLARE_ONLY: ["cloudflare"],
        BOTH: ["github", "cloudflare"],
        MISSING: ["cloudflare"],
        EXTRA_PROVIDER: ["github"],
        MISPLACED: ["github"],
      },
    )).toEqual([
      { name: "BOTH", presence: "both", expected: ["github", "cloudflare"], actual: ["github", "cloudflare"], verdict: "expected" },
      { name: "CLOUDFLARE_ONLY", presence: "cloudflare-only", expected: ["cloudflare"], actual: ["cloudflare"], verdict: "expected" },
      { name: "EXTRA_PROVIDER", presence: "both", expected: ["github"], actual: ["github", "cloudflare"], verdict: "unexpected" },
      { name: "GITHUB_ONLY", presence: "github-only", expected: ["github"], actual: ["github"], verdict: "expected" },
      { name: "MISPLACED", presence: "cloudflare-only", expected: ["github"], actual: ["cloudflare"], verdict: "misplaced" },
      { name: "MISSING", presence: "missing", expected: ["cloudflare"], actual: [], verdict: "missing" },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { compareSecretNames } from "./secret-inventory";

describe("compareSecretNames", () => {
  it("classifies secret names across providers", () => {
    expect(compareSecretNames(
      ["GH_ONLY", "SHARED_NAME"],
      ["CF_ONLY", "SHARED_NAME"],
    )).toEqual([
      { name: "CF_ONLY", presence: "cloudflare-only" },
      { name: "GH_ONLY", presence: "github-only" },
      { name: "SHARED_NAME", presence: "both" },
    ]);
  });
});

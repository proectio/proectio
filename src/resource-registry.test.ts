import { describe, expect, it } from "vitest";
import {
  cloudflareDashboardUrl,
  cloudflareResourceForRepository,
  resolveCloudflareAppUrl,
  resourceForRepository,
} from "./resource-registry";

describe("repository resource registry", () => {
  it("resolves the current Proectio repository mapping", () => {
    expect(resourceForRepository("proectio/proectio")).toEqual({
      repository: "proectio/proectio",
      cloudflare: {
        accountId: "3094c995ea8e0405b8aa7fd1259eaea8",
        worker: "proectio",
        appUrl: "$request-origin",
      },
    });
  });

  it("returns undefined for repositories without a mapping", () => {
    expect(cloudflareResourceForRepository("example/unmapped")).toBeUndefined();
  });

  it("resolves request-origin app URLs without hardcoding production hostnames", () => {
    const resource = cloudflareResourceForRepository("proectio/proectio");
    expect(resource).toBeDefined();
    expect(resolveCloudflareAppUrl(resource!, "https://proectio.example")).toBe("https://proectio.example");
  });

  it("builds the Worker dashboard URL from the repository resource", () => {
    const resource = cloudflareResourceForRepository("proectio/proectio");
    expect(resource).toBeDefined();
    expect(cloudflareDashboardUrl(resource!)).toBe(
      "https://dash.cloudflare.com/3094c995ea8e0405b8aa7fd1259eaea8/workers/services/view/proectio/production",
    );
  });
});

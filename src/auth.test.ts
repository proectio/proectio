import { describe, expect, it } from "vitest";
import { createSession, verifySession } from "./auth";

describe("session", () => {
  it("accepts a valid owner session", async () => {
    const now = Date.UTC(2026, 8, 22, 12, 0, 0);
    const session = await createSession("sergii", "test-secret", now);
    await expect(verifySession(session, "sergii", "test-secret", now + 1000)).resolves.toBe(true);
  });

  it("rejects another login", async () => {
    const now = Date.UTC(2026, 8, 22, 12, 0, 0);
    const session = await createSession("someone-else", "test-secret", now);
    await expect(verifySession(session, "sergii", "test-secret", now + 1000)).resolves.toBe(false);
  });
});

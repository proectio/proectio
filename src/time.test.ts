import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./time";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-09-25T00:00:00Z");

  it("formats seconds and minutes", () => {
    expect(formatRelativeTime("2026-09-24T23:59:50Z", now)).toBe("10 seconds ago");
    expect(formatRelativeTime("2026-09-24T23:55:00Z", now)).toBe("5 minutes ago");
  });

  it("formats hours and yesterday", () => {
    expect(formatRelativeTime("2026-09-24T22:00:00Z", now)).toBe("2 hours ago");
    expect(formatRelativeTime("2026-09-23T23:00:00Z", now)).toBe("yesterday");
  });

  it("formats weeks, months, and years", () => {
    expect(formatRelativeTime("2026-09-17T00:00:00Z", now)).toBe("last week");
    expect(formatRelativeTime("2026-09-11T00:00:00Z", now)).toBe("2 weeks ago");
    expect(formatRelativeTime("2026-03-29T00:00:00Z", now)).toBe("6 months ago");
    expect(formatRelativeTime("2025-09-25T00:00:00Z", now)).toBe("1 year ago");
  });
});

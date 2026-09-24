export function getDetectedTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function listTimeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: "timeZone") => string[] };
  if (typeof intl.supportedValuesOf === "function") {
    return intl.supportedValuesOf("timeZone");
  }

  return ["UTC", "Europe/Kyiv", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Tokyo"];
}

function plural(value: number, singular: string, pluralForm = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : pluralForm} ago`;
}

export function formatRelativeTime(value: string | null, now = Date.now()): string {
  if (!value) return "Never";

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Unknown";

  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));

  if (diffSeconds < 5) return "just now";
  if (diffSeconds < 60) return plural(diffSeconds, "second");
  if (diffSeconds < 60 * 60) return plural(Math.floor(diffSeconds / 60), "minute");
  if (diffSeconds < 24 * 60 * 60) return plural(Math.floor(diffSeconds / (60 * 60)), "hour");

  const days = Math.floor(diffSeconds / (24 * 60 * 60));
  if (days === 1) return "yesterday";
  if (days < 7) return plural(days, "day");
  if (days < 14) return "last week";
  if (days < 60) return plural(Math.floor(days / 7), "week");
  if (days < 365) return plural(Math.floor(days / 30), "month");

  return plural(Math.floor(days / 365), "year");
}

export function formatExactTime(value: string | null, timeZone: string): string {
  if (!value) return "Never";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "long",
    timeZone,
  }).format(date);
}

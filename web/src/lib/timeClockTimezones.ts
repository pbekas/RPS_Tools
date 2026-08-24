export const TIME_CLOCK_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "America/Guatemala",
  "America/El_Salvador",
  "America/Tegucigalpa",
  "America/Managua",
  "America/Costa_Rica",
  "America/Belize",
  "America/Panama",
  "Asia/Manila",
] as const;

export type TimeClockTimezone = (typeof TIME_CLOCK_TIMEZONES)[number];

const TIME_CLOCK_TIMEZONE_LABELS: Record<string, string> = {
  "America/Chicago": "US Central (Chicago)",
  "America/New_York": "US Eastern (New York)",
  "America/Denver": "US Mountain (Denver)",
  "America/Los_Angeles": "US Pacific (Los Angeles)",
  "America/Phoenix": "Arizona (Phoenix)",
  "America/Anchorage": "Alaska (Anchorage)",
  "Pacific/Honolulu": "Hawaii (Honolulu)",
  "America/Puerto_Rico": "Puerto Rico",
  "America/Guatemala": "Central America (Guatemala)",
  "America/El_Salvador": "El Salvador",
  "America/Tegucigalpa": "Honduras",
  "America/Managua": "Nicaragua",
  "America/Costa_Rica": "Costa Rica",
  "America/Belize": "Belize",
  "America/Panama": "Panama",
  "Asia/Manila": "Philippines (Manila)",
};

export function timeClockTimezoneLabel(value: string): string {
  return TIME_CLOCK_TIMEZONE_LABELS[value] || value;
}

export function timeClockTimezoneOptions(current?: string | null): string[] {
  const list: string[] = [...TIME_CLOCK_TIMEZONES];
  const extra = (current || "").trim();
  if (extra && !list.includes(extra)) {
    list.unshift(extra);
  }
  return list;
}

export function isValidTimeClockTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TIME_CLOCK_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
  "Asia/Manila",
] as const;

export type TimeClockTimezone = (typeof TIME_CLOCK_TIMEZONES)[number];

export function isValidTimeClockTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

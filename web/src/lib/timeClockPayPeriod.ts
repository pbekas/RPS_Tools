import { fromDatetimeLocalValue } from "@/lib/timeClockFormat";

export type PayPeriodBounds = {
  period_start: string;
  period_end: string;
  period_number: number;
  from: string;
  to: string;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function dateToYmd(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export function daysBetweenYmd(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = Date.UTC(sy, sm - 1, sd);
  const e = Date.UTC(ey, em - 1, ed);
  return Math.floor((e - s) / 86400000);
}

export function resolvePayPeriod(
  anchorDate: string,
  lengthDays: number,
  timezone: string,
  reference: Date = new Date(),
  offset = 0
): PayPeriodBounds {
  const anchor = anchorDate.slice(0, 10);
  const refYmd = dateToYmd(reference, timezone);
  const daysSinceAnchor = daysBetweenYmd(anchor, refYmd);
  const periodIndex =
    daysSinceAnchor >= 0
      ? Math.floor(daysSinceAnchor / lengthDays)
      : Math.ceil(daysSinceAnchor / lengthDays) - 1;
  const adjustedIndex = periodIndex + offset;
  const period_start = addDaysYmd(anchor, adjustedIndex * lengthDays);
  const period_end = addDaysYmd(period_start, lengthDays - 1);
  const from = fromDatetimeLocalValue(`${period_start}T00:00`, timezone);
  const to = fromDatetimeLocalValue(`${addDaysYmd(period_end, 1)}T00:00`, timezone);
  return {
    period_start,
    period_end,
    period_number: adjustedIndex + 1,
    from,
    to,
  };
}

export function formatPayPeriodLabel(bounds: PayPeriodBounds): string {
  return `Pay period #${bounds.period_number}: ${bounds.period_start} – ${bounds.period_end}`;
}

export function weekStartsOverlappingRange(
  periodStart: string,
  periodEnd: string,
  timezone: string
): string[] {
  const weeks: string[] = [];
  let cursor = periodStart;
  while (cursor <= periodEnd) {
    const weekStart = weekStartForDate(cursor, timezone);
    if (!weeks.includes(weekStart)) {
      weeks.push(weekStart);
    }
    cursor = addDaysYmd(cursor, 1);
  }
  return weeks.sort();
}

function weekStartForDate(ymd: string, timezone: string): string {
  const iso = fromDatetimeLocalValue(`${ymd}T12:00`, timezone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const wd = (get("weekday") || "Mon").slice(0, 3);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = map[wd] ?? 1;
  const diff = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(Date.UTC(year, month - 1, day + diff));
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

export function matchesPayPeriod(
  fromIso: string,
  toIso: string,
  bounds: PayPeriodBounds
): boolean {
  return fromIso === bounds.from && toIso === bounds.to;
}

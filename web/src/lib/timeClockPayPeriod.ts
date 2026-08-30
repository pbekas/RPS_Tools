import {
  formatYmd,
  fromDatetimeLocalValue,
  shiftWeekStart,
  weekRangeFromStart,
  weekStartDate,
} from "@/lib/timeClockFormat";

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

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Absolute semi-monthly index: 24 periods per year, 0 = Jan 1–15. */
function semiMonthlyIndex(year: number, month: number, half: 0 | 1): number {
  return year * 24 + (month - 1) * 2 + half;
}

function fromSemiMonthlyIndex(index: number): { year: number; month: number; half: 0 | 1 } {
  const year = Math.floor(index / 24);
  const rem = index - year * 24;
  return {
    year,
    month: Math.floor(rem / 2) + 1,
    half: (rem % 2) as 0 | 1,
  };
}

/** Semi-monthly: 1st–15th and 16th–last day of the month. */
export function resolvePayPeriod(
  timezone: string,
  reference: Date = new Date(),
  offset = 0
): PayPeriodBounds {
  const refYmd = dateToYmd(reference, timezone);
  const [year, month, day] = refYmd.split("-").map(Number);
  const half = (day <= 15 ? 0 : 1) as 0 | 1;
  const { year: y, month: m, half: h } = fromSemiMonthlyIndex(
    semiMonthlyIndex(year, month, half) + offset
  );
  const period_start = h === 0 ? ymd(y, m, 1) : ymd(y, m, 16);
  const period_end = h === 0 ? ymd(y, m, 15) : ymd(y, m, lastDayOfMonth(y, m));
  const from = fromDatetimeLocalValue(`${period_start}T00:00`, timezone);
  const to = fromDatetimeLocalValue(`${addDaysYmd(period_end, 1)}T00:00`, timezone);
  return {
    period_start,
    period_end,
    period_number: h + 1,
    from,
    to,
  };
}

export function payPeriodHalfLabel(bounds: Pick<PayPeriodBounds, "period_number">): string {
  return bounds.period_number === 1 ? "1–15" : "16–end";
}

export function formatPayPeriodLabel(bounds: PayPeriodBounds): string {
  return `Pay period ${payPeriodHalfLabel(bounds)}: ${bounds.period_start} – ${bounds.period_end}`;
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

export type NamedRangeKind = "week" | "pay_period" | "month";

export type NamedRange = {
  kind: NamedRangeKind;
  offset: number;
  from: string;
  to: string;
  start: string;
  end: string;
  label: string;
  payPeriod?: PayPeriodBounds;
};

export function parseNamedRangeKind(
  value: string | null | undefined
): NamedRangeKind {
  if (value === "pay_period" || value === "month") return value;
  return "week";
}

export function parseRangeOffset(value: string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

export function resolveWeekRange(
  timezone: string,
  reference: Date = new Date(),
  offset = 0
): NamedRange {
  const start = shiftWeekStart(weekStartDate(reference, timezone), offset);
  const { from, to, week_end } = weekRangeFromStart(start, timezone);
  return {
    kind: "week",
    offset,
    from,
    to,
    start,
    end: week_end,
    label: `Week of ${formatYmd(start)} – ${formatYmd(week_end)}`,
  };
}

export function resolveMonthRange(
  timezone: string,
  reference: Date = new Date(),
  offset = 0
): NamedRange {
  const refYmd = dateToYmd(reference, timezone);
  const [year, month] = refYmd.split("-").map(Number);
  const index = year * 12 + (month - 1) + offset;
  const y = Math.floor(index / 12);
  const m = index - y * 12 + 1;
  const start = ymd(y, m, 1);
  const end = ymd(y, m, lastDayOfMonth(y, m));
  const from = fromDatetimeLocalValue(`${start}T00:00`, timezone);
  const to = fromDatetimeLocalValue(`${addDaysYmd(end, 1)}T00:00`, timezone);
  const label = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
  return {
    kind: "month",
    offset,
    from,
    to,
    start,
    end,
    label,
  };
}

export function resolveNamedRange(
  kind: NamedRangeKind,
  timezone: string,
  reference: Date = new Date(),
  offset = 0
): NamedRange {
  if (kind === "pay_period") {
    const payPeriod = resolvePayPeriod(timezone, reference, offset);
    return {
      kind,
      offset,
      from: payPeriod.from,
      to: payPeriod.to,
      start: payPeriod.period_start,
      end: payPeriod.period_end,
      label: formatPayPeriodLabel(payPeriod),
      payPeriod,
    };
  }
  if (kind === "month") {
    return resolveMonthRange(timezone, reference, offset);
  }
  return resolveWeekRange(timezone, reference, offset);
}

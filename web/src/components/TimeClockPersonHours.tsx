"use client";

import { useMemo } from "react";
import { WeeklyBreakdownTable } from "@/components/TimeClockEntries";
import type { TimeClockReport, TimeEntry } from "@/lib/timeClockTypes";
import {
  formatHours,
  formatTime,
  formatYmd,
  localYmd,
} from "@/lib/timeClockFormat";

export type ReportUser = NonNullable<TimeClockReport["by_user"]>[number];

const APPROVAL_STYLES: Record<string, string> = {
  approved: "text-pass",
  submitted: "text-accent",
  open: "text-warn",
  rejected: "text-fail",
  none: "text-ink-soft",
};

export function punchHours(entry: TimeEntry): number {
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : Date.now();
  return Math.max(0, (end - new Date(entry.clock_in).getTime()) / 3_600_000);
}

type DayGroup = {
  date: string;
  hours: number;
  entries: TimeEntry[];
};

export function groupEntriesByDay(
  entries: TimeEntry[],
  timezone: string
): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  const sorted = [...entries].sort((a, b) => a.clock_in.localeCompare(b.clock_in));
  for (const entry of sorted) {
    const date = localYmd(entry.clock_in, timezone);
    const existing = groups.get(date);
    const hours = punchHours(entry);
    if (existing) {
      existing.hours += hours;
      existing.entries.push(entry);
    } else {
      groups.set(date, { date, hours, entries: [entry] });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function TimeClockPersonHours({
  user,
  timezone,
  open,
  onToggle,
  showWeekly = false,
}: {
  user: ReportUser;
  timezone: string;
  open: boolean;
  onToggle: () => void;
  showWeekly?: boolean;
}) {
  const clockedIn = user.entries.some((entry) => !entry.clock_out);
  return (
    <div className="border-b border-line/70 last:border-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-wash/70"
      >
        <span
          className={`text-ink-soft transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden
        >
          ▸
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">{user.user_name}</span>
          <span className="block truncate text-sm text-ink-soft">
            {user.user_email}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-lg font-semibold text-accent">
            {formatHours(user.total_hours)}
          </span>
          {clockedIn ? (
            <span className="mt-0.5 inline-block rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-accent">
              Clocked in
            </span>
          ) : user.approval ? (
            <span
              className={`block text-xs font-semibold uppercase tracking-wide ${
                APPROVAL_STYLES[user.approval.status] || APPROVAL_STYLES.none
              }`}
            >
              {user.approval.status === "approved"
                ? `Approved by ${user.approval.reviewed_by_name || "manager"}`
                : user.approval.status}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <PersonHoursDetail
          user={user}
          timezone={timezone}
          showWeekly={showWeekly}
        />
      ) : null}
    </div>
  );
}

function PersonHoursDetail({
  user,
  timezone,
  showWeekly,
}: {
  user: ReportUser;
  timezone: string;
  showWeekly: boolean;
}) {
  const weeks = user.weekly_breakdown.filter((row) => row.entry_count > 0);
  return (
    <div className="border-t border-line bg-wash/30">
      {showWeekly && weeks.length > 1 ? (
        <div className="px-4 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Weekly totals
          </p>
          <WeeklyBreakdownTable rows={weeks} />
        </div>
      ) : null}
      <TimeClockDailyPunches entries={user.entries} timezone={timezone} />
    </div>
  );
}

export function TimeClockDailyPunches({
  entries,
  timezone,
}: {
  entries: TimeEntry[];
  timezone: string;
}) {
  const days = useMemo(
    () => groupEntriesByDay(entries, timezone),
    [entries, timezone]
  );

  if (!days.length) {
    return (
      <p className="px-4 py-3 text-sm text-ink-soft">No punches in this period.</p>
    );
  }

  return (
    <div className="divide-y divide-line/70">
      {days.map((day) => (
        <div key={day.date} className="px-4 py-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-ink">{formatYmd(day.date)}</p>
            <p className="text-sm font-semibold text-ink">{formatHours(day.hours)}</p>
          </div>
          <ul className="space-y-1.5">
            {day.entries.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[minmax(0,14rem)_auto]"
              >
                <p className="text-ink">
                  {formatTime(entry.clock_in, timezone)}
                  <span className="text-ink-soft"> – </span>
                  {entry.clock_out
                    ? formatTime(entry.clock_out, timezone)
                    : "Open"}
                </p>
                <p className="text-right font-medium text-ink">
                  {formatHours(punchHours(entry))}
                </p>
                {entry.notes ? (
                  <p className="col-span-2 text-xs text-ink-soft">{entry.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

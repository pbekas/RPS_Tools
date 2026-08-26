"use client";

import { useCallback, useMemo, useState } from "react";
import { WeeklyBreakdownTable } from "@/components/TimeClockEntries";
import type { TimeClockReport, TimeEntry } from "@/lib/timeClockTypes";
import {
  formatHours,
  formatTime,
  formatYmd,
  localYmd,
} from "@/lib/timeClockFormat";
import {
  formatPayPeriodLabel,
  resolvePayPeriod,
  type PayPeriodBounds,
} from "@/lib/timeClockPayPeriod";

type ReportUser = NonNullable<TimeClockReport["by_user"]>[number];

type PayPeriodConfig = {
  timezone: string;
};

type Props = {
  initialFrom: string;
  initialTo: string;
  initialReport: TimeClockReport | null;
  teamMode?: boolean;
  payPeriodConfig: PayPeriodConfig;
  initialPreset?: "current" | "previous" | "custom";
  scopeLabel?: string;
};

const APPROVAL_STYLES: Record<string, string> = {
  approved: "text-pass",
  submitted: "text-accent",
  open: "text-warn",
  rejected: "text-fail",
  none: "text-ink-soft",
};

function punchHours(entry: TimeEntry): number {
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : Date.now();
  return Math.max(0, (end - new Date(entry.clock_in).getTime()) / 3_600_000);
}

type DayGroup = {
  date: string;
  hours: number;
  entries: TimeEntry[];
};

function groupEntriesByDay(entries: TimeEntry[], timezone: string): DayGroup[] {
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

function PersonRow({
  user,
  timezone,
  open,
  onToggle,
}: {
  user: ReportUser;
  timezone: string;
  open: boolean;
  onToggle: () => void;
}) {
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
          {user.approval ? (
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
      {open ? <DailyPunches entries={user.entries} timezone={timezone} /> : null}
    </div>
  );
}

function DailyPunches({
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
    <div className="divide-y divide-line/70 border-t border-line">
      {days.map((day) => (
        <div key={day.date} className="px-4 py-3">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-semibold text-ink">
              {formatYmd(day.date)}
            </p>
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

export function TimeClockReportPanel({
  initialFrom,
  initialTo,
  initialReport,
  teamMode = false,
  payPeriodConfig,
  initialPreset = "current",
  scopeLabel,
}: Props) {
  const [preset, setPreset] = useState<"current" | "previous" | "custom">(initialPreset);
  const [from, setFrom] = useState(initialFrom.slice(0, 10));
  const [to, setTo] = useState(initialTo.slice(0, 10));
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [noPunchesOpen, setNoPunchesOpen] = useState(false);

  const activePayPeriod = useMemo((): PayPeriodBounds | null => {
    if (preset === "custom") return null;
    return resolvePayPeriod(
      payPeriodConfig.timezone,
      new Date(),
      preset === "previous" ? -1 : 0
    );
  }, [payPeriodConfig, preset]);

  const applyPreset = useCallback(
    (next: "current" | "previous" | "custom") => {
      setPreset(next);
      if (next === "custom") return;
      const bounds = resolvePayPeriod(
        payPeriodConfig.timezone,
        new Date(),
        next === "previous" ? -1 : 0
      );
      setFrom(bounds.period_start);
      setTo(bounds.period_end);
    },
    [payPeriodConfig]
  );

  const people = useMemo(() => {
    const rows = report?.by_user || [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (user) =>
        user.user_name.toLowerCase().includes(needle) ||
        user.user_email.toLowerCase().includes(needle)
    );
  }, [report, query]);

  const withHours = useMemo(
    () => people.filter((user) => user.total_hours > 0),
    [people]
  );
  const noPunches = useMemo(
    () => people.filter((user) => user.total_hours <= 0),
    [people]
  );

  async function loadReport() {
    setBusy(true);
    setMsg("");
    try {
      const params = new URLSearchParams({
        ...(teamMode ? { team: "1" } : {}),
        approval: "1",
      });
      if (preset !== "custom") {
        params.set("pay_period", preset);
      } else {
        params.set("from", new Date(`${from}T00:00:00`).toISOString());
        params.set("to", new Date(`${to}T23:59:59`).toISOString());
      }
      const res = await fetch(`/api/time-clock/report?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load report");
      setReport(data.report);
      setExpanded({});
      setNoPunchesOpen(false);
      if (data.report?.pay_period) {
        setFrom(data.report.pay_period.period_start);
        setTo(data.report.pay_period.period_end);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setBusy(false);
    }
  }

  function exportReport(format: "csv" | "pdf") {
    const params = new URLSearchParams({
      format,
      ...(teamMode ? { team: "1" } : {}),
    });
    if (preset !== "custom") {
      params.set("pay_period", preset);
    } else {
      params.set("from", new Date(`${from}T00:00:00`).toISOString());
      params.set("to", new Date(`${to}T23:59:59`).toISOString());
    }
    if (format === "pdf") {
      params.set("approval", "1");
    }
    window.location.href = `/api/time-clock/report?${params}`;
  }

  function togglePerson(email: string) {
    setExpanded((current) => ({ ...current, [email]: !current[email] }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white/90 p-4">
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">Pay period</span>
          <select
            value={preset}
            onChange={(e) =>
              applyPreset(e.target.value as "current" | "previous" | "custom")
            }
            className="mt-1 block min-w-[12rem] rounded-lg border border-line px-3 py-2"
          >
            <option value="current">Current pay period</option>
            <option value="previous">Previous pay period</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">From</span>
          <input
            type="date"
            value={from}
            disabled={preset !== "custom"}
            onChange={(e) => {
              setPreset("custom");
              setFrom(e.target.value);
            }}
            className="mt-1 block rounded-lg border border-line px-3 py-2 disabled:bg-wash"
          />
        </label>
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">To</span>
          <input
            type="date"
            value={to}
            disabled={preset !== "custom"}
            onChange={(e) => {
              setPreset("custom");
              setTo(e.target.value);
            }}
            className="mt-1 block rounded-lg border border-line px-3 py-2 disabled:bg-wash"
          />
        </label>
        <button
          type="button"
          onClick={loadReport}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Loading…" : "Run report"}
        </button>
        <button
          type="button"
          onClick={() => exportReport("csv")}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => exportReport("pdf")}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
        >
          Export PDF
        </button>
      </div>

      {activePayPeriod ? (
        <p className="text-sm text-ink-soft">{formatPayPeriodLabel(activePayPeriod)}</p>
      ) : null}

      {msg ? <p className="text-sm text-fail">{msg}</p> : null}

      {report ? (
        <>
          <div className="rounded-xl border border-line bg-white/90 px-4 py-4">
            <p className="text-sm text-ink-soft">
              {report.pay_period
                ? `Pay period ${report.pay_period.period_number === 1 ? "1–15" : "16–end"} total hours`
                : "Total hours for period"}
            </p>
            <p className="font-display text-3xl text-ink">{formatHours(report.total_hours)}</p>
            {report.pay_period ? (
              <p className="mt-1 text-sm text-ink-soft">
                {report.pay_period.period_start} – {report.pay_period.period_end}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-ink-soft">
              {scopeLabel ? `${scopeLabel} · ` : ""}
              {report.timezone}
            </p>
          </div>

          {teamMode ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl text-ink">Hours by person</h2>
                  <p className="text-sm text-ink-soft">
                    Expand a person to see daily punches and times. People with
                    no hours are under No punches.
                  </p>
                </div>
                {(report.by_user?.length || 0) > 8 ? (
                  <label className="text-sm">
                    <span className="sr-only">Search people</span>
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search people"
                      className="rounded-lg border border-line px-3 py-2"
                    />
                  </label>
                ) : null}
              </div>

              {withHours.length || noPunches.length ? (
                <div className="space-y-3">
                  {withHours.length ? (
                    <div className="overflow-hidden rounded-xl border border-line bg-white/90">
                      {withHours.map((user) => (
                        <PersonRow
                          key={user.user_email}
                          user={user}
                          timezone={report.timezone}
                          open={Boolean(expanded[user.user_email])}
                          onToggle={() => togglePerson(user.user_email)}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-line bg-white/90 px-4 py-4 text-sm text-ink-soft">
                      {query.trim()
                        ? "No matching people with hours in this period."
                        : "No hours in this period."}
                    </p>
                  )}

                  {noPunches.length ? (
                    <details
                      className="group overflow-hidden rounded-xl border border-line bg-white/90"
                      open={query.trim() ? true : noPunchesOpen}
                      onToggle={(event) => {
                        if (query.trim()) return;
                        setNoPunchesOpen(
                          (event.currentTarget as HTMLDetailsElement).open
                        );
                      }}
                    >
                      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink-soft hover:bg-wash/70 [&::-webkit-details-marker]:hidden">
                        <span className="inline-flex items-center gap-2">
                          <span
                            className="inline-block transition-transform group-open:rotate-90"
                            aria-hidden
                          >
                            ▸
                          </span>
                          No punches ({noPunches.length})
                        </span>
                      </summary>
                      <div className="border-t border-line">
                        {noPunches.map((user) => (
                          <PersonRow
                            key={user.user_email}
                            user={user}
                            timezone={report.timezone}
                            open={Boolean(expanded[user.user_email])}
                            onToggle={() => togglePerson(user.user_email)}
                          />
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : (
                <p className="rounded-xl border border-line bg-white/90 px-4 py-4 text-sm text-ink-soft">
                  {query.trim()
                    ? "No people match that search."
                    : "No people in this report."}
                </p>
              )}
            </div>
          ) : (
            <div>
              <h2 className="mb-3 font-display text-xl text-ink">Weekly breakdown</h2>
              <WeeklyBreakdownTable rows={report.weekly_breakdown} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

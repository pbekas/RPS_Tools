"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TeamLiveStatusRow } from "@/lib/timeClockTypes";
import { formatDateTime, formatHours } from "@/lib/timeClockFormat";

const STATUS_ORDER: Record<TeamLiveStatusRow["status"], number> = {
  clocked_in: 0,
  on_break: 1,
  forgot_to_punch: 2,
  not_started: 3,
  on_pto: 4,
  clocked_out: 5,
};

const STATUS_DOT: Record<TeamLiveStatusRow["status"], string> = {
  clocked_in: "bg-pass",
  on_break: "bg-warn",
  forgot_to_punch: "bg-fail",
  not_started: "bg-line",
  on_pto: "bg-accent/60",
  clocked_out: "bg-ink-soft",
};

type Props = {
  initialRows: TeamLiveStatusRow[];
  initialRefreshedAt: string;
};

export function TeamLiveBoard({ initialRows, initialRefreshedAt }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [refreshedAt, setRefreshedAt] = useState(initialRefreshedAt);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | TeamLiveStatusRow["status"]>("all");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/time-clock/live");
      const data = await res.json();
      if (res.ok) {
        setRows(data.rows || []);
        setRefreshedAt(data.refreshed_at || new Date().toISOString());
      }
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(refresh, 30_000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const summary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.status] = (counts[row.status] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((row) => (filter === "all" ? true : row.status === filter))
      .filter((row) => {
        if (!needle) return true;
        return (
          row.user_name.toLowerCase().includes(needle) ||
          row.user_email.toLowerCase().includes(needle)
        );
      })
      .sort((a, b) => {
        const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        if (order !== 0) return order;
        return a.user_name.localeCompare(b.user_name);
      });
  }, [rows, q, filter]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            ["clocked_in", "Clocked in"],
            ["on_break", "On break"],
            ["forgot_to_punch", "No punch"],
            ["on_pto", "Time off"],
            ["not_started", "Not started"],
            ["clocked_out", "Done for day"],
          ] as const
        ).map(([status, label]) => (
          <button
            key={status}
            type="button"
            onClick={() => setFilter(filter === status ? "all" : status)}
            className={`rounded-xl border px-4 py-3 text-left transition ${
              filter === status ? "border-accent bg-wash" : "border-line bg-white/90"
            }`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              {label}
            </p>
            <p className="mt-1 font-display text-2xl text-ink">{summary[status] || 0}</p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search team member"
          className="min-w-[14rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={refresh}
          disabled={busy}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
        >
          {busy ? "Refreshing…" : "Refresh"}
        </button>
        <p className="text-xs text-ink-soft">
          Updated {formatDateTime(refreshedAt, undefined)} · auto-refresh 30s
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((row) => (
          <div
            key={row.user_email}
            className="rounded-xl border border-line bg-white/90 px-4 py-4 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">{row.user_name}</p>
                <p className="text-sm text-ink-soft">{row.user_email}</p>
                {row.team_name ? (
                  <p className="text-xs text-ink-soft">{row.team_name}</p>
                ) : null}
              </div>
              <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${STATUS_DOT[row.status]}`} />
            </div>
            <p className="mt-3 text-sm font-semibold text-accent">{row.status_label}</p>
            <dl className="mt-3 space-y-1 text-sm text-ink-soft">
              <div className="flex justify-between gap-3">
                <dt>Local time</dt>
                <dd className="font-semibold text-ink">{row.local_time}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>Today</dt>
                <dd className="font-semibold text-ink">{formatHours(row.today_hours)}</dd>
              </div>
              {row.clocked_in_since ? (
                <div className="flex justify-between gap-3">
                  <dt>Since</dt>
                  <dd>{formatDateTime(row.clocked_in_since, row.timezone)}</dd>
                </div>
              ) : null}
              {row.last_punch_label ? (
                <div className="flex justify-between gap-3">
                  <dt>Last punch</dt>
                  <dd>{row.last_punch_label}</dd>
                </div>
              ) : null}
              {row.time_off_kind ? (
                <div className="flex justify-between gap-3">
                  <dt>Time off</dt>
                  <dd className="capitalize">
                    {row.time_off_kind}
                    {row.time_off_hours ? ` (${row.time_off_hours}h)` : ""}
                  </dd>
                </div>
              ) : null}
              {row.timesheet_status ? (
                <div className="flex justify-between gap-3">
                  <dt>This week</dt>
                  <dd className="capitalize">{row.timesheet_status}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

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
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
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
            className={`rounded-lg border px-3 py-2 text-left transition ${
              filter === status ? "border-accent bg-wash" : "border-line bg-white/90"
            }`}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
              {label}
            </p>
            <p className="mt-0.5 font-display text-xl text-ink">{summary[status] || 0}</p>
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

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((row) => {
          const details = [
            row.local_time,
            `${formatHours(row.today_hours)} today`,
            row.last_punch_label ? `last ${row.last_punch_label}` : null,
            row.time_off_kind
              ? `${row.time_off_kind}${row.time_off_hours ? ` ${row.time_off_hours}h` : ""}`
              : null,
          ].filter(Boolean);
          return (
            <div
              key={row.user_email}
              className="rounded-lg border border-line bg-white/90 px-3 py-2"
              title={row.user_email}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-ink">{row.user_name}</p>
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-accent">
                  {row.status_label}
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[row.status]}`} />
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-soft">{details.join(" · ")}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

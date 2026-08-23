"use client";

import { useMemo, useState } from "react";
import type { TimeClockSettings } from "@/lib/timeClockTypes";
import { formatHours } from "@/lib/timeClockFormat";

type TeamRow = {
  date: string;
  user_email: string;
  user_name: string;
  total_hours: number;
  entry_count: number;
  is_clocked_in: boolean;
};

type Props = {
  initialRows: TeamRow[];
  settings: TimeClockSettings;
  from: string;
  to: string;
};

export function TeamTimesheet({ initialRows, settings, from, to }: Props) {
  const [rows, setRows] = useState(initialRows);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.user_name.toLowerCase().includes(needle) ||
        r.user_email.toLowerCase().includes(needle) ||
        r.date.includes(needle)
    );
  }, [rows, q]);

  const byUser = useMemo(() => {
    const map = new Map<string, { name: string; hours: number; days: Set<string> }>();
    for (const row of rows) {
      const key = row.user_email;
      const existing = map.get(key) || {
        name: row.user_name,
        hours: 0,
        days: new Set<string>(),
      };
      existing.hours += row.total_hours;
      existing.days.add(row.date);
      map.set(key, existing);
    }
    return Array.from(map.entries())
      .map(([email, data]) => ({
        email,
        name: data.name,
        hours: data.hours,
        days: data.days.size,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  async function refresh() {
    setBusy(true);
    try {
      const params = new URLSearchParams({ from, to, view: "team_days" });
      const res = await fetch(`/api/time-clock/report?${params}`);
      const data = await res.json();
      if (res.ok) setRows(data.rows || []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {byUser.map((user) => (
          <div
            key={user.email}
            className="rounded-xl border border-line bg-white/90 px-4 py-3 shadow-sm"
          >
            <p className="font-semibold text-ink">{user.name}</p>
            <p className="text-sm text-ink-soft">{user.email}</p>
            <p className="mt-2 text-lg font-semibold text-accent">
              {formatHours(user.hours)}
            </p>
            <p className="text-sm text-ink-soft">{user.days} day(s) in range</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search team member or date"
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
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white/90">
        <table className="min-w-full text-sm">
          <thead className="border-b border-line bg-wash/60 text-left text-ink-soft">
            <tr>
              <th className="px-4 py-2 font-semibold">Date</th>
              <th className="px-4 py-2 font-semibold">Team member</th>
              <th className="px-4 py-2 font-semibold">Entries</th>
              <th className="px-4 py-2 font-semibold">Hours</th>
              <th className="px-4 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={`${row.date}-${row.user_email}`}
                className="border-b border-line/60 last:border-0"
              >
                <td className="px-4 py-2">{row.date}</td>
                <td className="px-4 py-2">
                  <div className="font-semibold text-ink">{row.user_name}</div>
                  <div className="text-ink-soft">{row.user_email}</div>
                </td>
                <td className="px-4 py-2">{row.entry_count}</td>
                <td className="px-4 py-2 font-semibold">{formatHours(row.total_hours)}</td>
                <td className="px-4 py-2">
                  {row.is_clocked_in ? (
                    <span className="rounded-full bg-wash px-2 py-0.5 text-xs font-semibold text-accent">
                      Clocked in
                    </span>
                  ) : (
                    <span className="text-ink-soft">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-soft">Times shown in {settings.timezone}.</p>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { TeamTimeOffEntry } from "@/lib/timeClockTypes";
import { TIME_OFF_KIND_LABELS } from "@/lib/timeClockTypes";
import { formatHours, formatYmd } from "@/lib/timeClockFormat";

type View = "upcoming" | "past" | "month";

type Props = {
  initialEntries: TeamTimeOffEntry[];
  initialFrom: string;
  initialTo: string;
  today: string;
};

function shiftMonth(yearMonth: string, delta: number): string {
  const [year, month] = yearMonth.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(yearMonth: string): { from: string; to: string } {
  const [year, month] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `${yearMonth}-01`,
    to: `${yearMonth}-${String(last).padStart(2, "0")}`,
  };
}

function monthLabel(yearMonth: string): string {
  const [year, month] = yearMonth.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function monthCells(yearMonth: string): Array<{ date: string | null }> {
  const [year, month] = yearMonth.split("-").map(Number);
  const firstDow = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: Array<{ date: string | null }> = [];
  for (let i = 0; i < firstDow; i += 1) cells.push({ date: null });
  for (let day = 1; day <= last; day += 1) {
    cells.push({
      date: `${yearMonth}-${String(day).padStart(2, "0")}`,
    });
  }
  while (cells.length % 7 !== 0) cells.push({ date: null });
  return cells;
}

export function TimeOffSchedule({
  initialEntries,
  initialFrom,
  initialTo,
  today,
}: Props) {
  const [view, setView] = useState<View>("upcoming");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [entries, setEntries] = useState(initialEntries);
  const [range, setRange] = useState({ from: initialFrom, to: initialTo });
  const [team, setTeam] = useState("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function load(nextView: View, nextMonth = month) {
    setBusy(true);
    setMsg("");
    try {
      let from = range.from;
      let to = range.to;
      if (nextView === "upcoming") {
        from = today;
        to = initialTo;
      } else if (nextView === "past") {
        from = initialFrom;
        to = today;
      } else {
        const bounds = monthBounds(nextMonth);
        from = bounds.from;
        to = bounds.to;
      }
      const params = new URLSearchParams({ view: "team", from, to });
      const res = await fetch(`/api/time-clock/time-off?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load time off");
      setEntries(data.entries || []);
      setRange({ from, to });
      setView(nextView);
      setMonth(nextMonth);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load time off");
    } finally {
      setBusy(false);
    }
  }

  const teams = useMemo(() => {
    const names = new Set<string>();
    for (const entry of entries) {
      if (entry.team_name) names.add(entry.team_name);
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [entries]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((entry) => {
      if (view === "upcoming" && entry.entry_date < today) return false;
      if (view === "past" && entry.entry_date >= today) return false;
      if (team !== "all" && entry.team_name !== team) return false;
      if (!needle) return true;
      return (
        (entry.user_name || "").toLowerCase().includes(needle) ||
        entry.user_email.toLowerCase().includes(needle) ||
        (entry.team_name || "").toLowerCase().includes(needle)
      );
    });
  }, [entries, q, team, today, view]);

  const byDate = useMemo(() => {
    const map = new Map<string, TeamTimeOffEntry[]>();
    for (const entry of visible) {
      const list = map.get(entry.entry_date) || [];
      list.push(entry);
      map.set(entry.entry_date, list);
    }
    const dates = Array.from(map.keys()).sort((a, b) =>
      view === "past" ? b.localeCompare(a) : a.localeCompare(b)
    );
    return dates.map((date) => ({ date, entries: map.get(date) || [] }));
  }, [visible, view]);

  const monthMap = useMemo(() => {
    const map = new Map<string, TeamTimeOffEntry[]>();
    for (const entry of visible) {
      const list = map.get(entry.entry_date) || [];
      list.push(entry);
      map.set(entry.entry_date, list);
    }
    return map;
  }, [visible]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white/90 p-4">
        <div className="flex gap-1 rounded-lg border border-line bg-wash/70 p-1">
          {(["upcoming", "past", "month"] as View[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => load(id)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${
                view === id ? "bg-white text-accent shadow-sm" : "text-ink-soft"
              }`}
            >
              {id}
            </button>
          ))}
        </div>
        {view === "month" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => load("month", shiftMonth(month, -1))}
              className="rounded-lg border border-line px-2 py-1.5 text-sm font-semibold"
            >
              ‹
            </button>
            <p className="min-w-[9rem] text-center text-sm font-semibold text-ink">
              {monthLabel(month)}
            </p>
            <button
              type="button"
              onClick={() => load("month", shiftMonth(month, 1))}
              className="rounded-lg border border-line px-2 py-1.5 text-sm font-semibold"
            >
              ›
            </button>
          </div>
        ) : null}
        {teams.length > 1 ? (
          <label className="text-sm">
            <span className="sr-only">Team</span>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="rounded-lg border border-line px-3 py-2"
            >
              <option value="all">All teams</option>
              {teams.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="text-sm">
          <span className="sr-only">Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people"
            className="rounded-lg border border-line px-3 py-2"
          />
        </label>
        {busy ? <p className="text-sm text-ink-soft">Loading…</p> : null}
      </div>
      {msg ? <p className="text-sm text-fail">{msg}</p> : null}

      {view === "month" ? (
        <div className="overflow-hidden rounded-xl border border-line bg-white/90">
          <div className="grid grid-cols-7 border-b border-line bg-wash/70 text-center text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="px-2 py-2">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {monthCells(month).map((cell, idx) => {
              const dayEntries = cell.date ? monthMap.get(cell.date) || [] : [];
              return (
                <div
                  key={cell.date || `empty-${idx}`}
                  className="min-h-[6.5rem] border-b border-r border-line/70 p-1.5 last:border-r-0"
                >
                  {cell.date ? (
                    <>
                      <p
                        className={`text-xs font-semibold ${
                          cell.date === today ? "text-accent" : "text-ink-soft"
                        }`}
                      >
                        {Number(cell.date.slice(-2))}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {dayEntries.slice(0, 3).map((entry) => (
                          <li
                            key={entry.id}
                            className={`truncate rounded px-1 text-[11px] ${
                              entry.status === "pending"
                                ? "bg-warn/15 text-ink"
                                : "bg-accent/10 text-ink"
                            }`}
                            title={`${entry.user_name || entry.user_email} · ${
                              TIME_OFF_KIND_LABELS[entry.kind]
                            }`}
                          >
                            {entry.user_name || entry.user_email}
                          </li>
                        ))}
                        {dayEntries.length > 3 ? (
                          <li className="px-1 text-[11px] text-ink-soft">
                            +{dayEntries.length - 3} more
                          </li>
                        ) : null}
                      </ul>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {byDate.length ? (
        <div className="space-y-3">
          {byDate.map((group) => (
            <section
              key={group.date}
              className="rounded-xl border border-line bg-white/90 px-4 py-3"
            >
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h2 className="font-semibold text-ink">{formatYmd(group.date)}</h2>
                <p className="text-sm text-ink-soft">
                  {group.entries.length}{" "}
                  {group.entries.length === 1 ? "person" : "people"}
                </p>
              </div>
              <ul className="divide-y divide-line/70">
                {group.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium text-ink">
                        {entry.user_name || entry.user_email}
                      </p>
                      <p className="text-ink-soft">
                        {entry.team_name || "No team"}
                        {" · "}
                        {TIME_OFF_KIND_LABELS[entry.kind] || entry.kind}
                        {entry.notes ? ` — ${entry.notes}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-ink">
                        {formatHours(entry.hours)}
                      </p>
                      <p
                        className={`text-xs font-semibold uppercase tracking-wide ${
                          entry.status === "pending" ? "text-warn" : "text-pass"
                        }`}
                      >
                        {entry.status}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-sm text-ink-soft">
          No scheduled or past time off in this range.
        </p>
      )}
    </div>
  );
}

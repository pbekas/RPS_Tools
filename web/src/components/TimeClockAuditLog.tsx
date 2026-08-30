"use client";

import { useMemo, useState } from "react";
import { PUNCH_EDIT_AUDIT_ACTIONS, type TimeClockAuditEntry } from "@/lib/timeClockTypes";
import { formatDateTime, timeClockAuditActionLabel } from "@/lib/timeClockFormat";

type Props = {
  initialEntries: TimeClockAuditEntry[];
  initialTotal: number;
};

type FilterKind = "all" | "punches";

function formatAuditDetails(entry: TimeClockAuditEntry): string {
  const reason =
    typeof entry.metadata.reason === "string" ? entry.metadata.reason : "";
  const beforeIn = entry.before_data.clock_in;
  const afterIn = entry.after_data.clock_in || entry.after_data.proposed_clock_in;
  const beforeOut = entry.before_data.clock_out;
  const afterOut = entry.after_data.clock_out || entry.after_data.proposed_clock_out;
  if (beforeIn || afterIn) {
    const parts = [
      `In ${stringifyValue(beforeIn)} → ${stringifyValue(afterIn)}`,
      `Out ${stringifyValue(beforeOut)} → ${stringifyValue(afterOut)}`,
    ];
    if (reason) parts.push(`Reason: ${reason}`);
    return parts.join(" · ");
  }
  if (reason) return `Reason: ${reason}`;
  if (Object.keys(entry.after_data).length) return JSON.stringify(entry.after_data);
  if (Object.keys(entry.before_data).length) return JSON.stringify(entry.before_data);
  return "—";
}

function stringifyValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "string") {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime()) && value.includes("T")) {
      return formatDateTime(value);
    }
    return value;
  }
  return String(value);
}

export function TimeClockAuditLog({ initialEntries, initialTotal }: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => {
      return (
        e.action.toLowerCase().includes(needle) ||
        timeClockAuditActionLabel(e.action).toLowerCase().includes(needle) ||
        (e.actor_email || "").toLowerCase().includes(needle) ||
        (e.actor_name || "").toLowerCase().includes(needle) ||
        (e.subject_email || "").toLowerCase().includes(needle) ||
        (e.subject_name || "").toLowerCase().includes(needle) ||
        (e.team_name || "").toLowerCase().includes(needle)
      );
    });
  }, [entries, q]);

  async function load(nextFilter: FilterKind, offset: number, append: boolean) {
    setBusy(true);
    try {
      const params = new URLSearchParams({
        limit: "100",
        offset: String(offset),
      });
      if (nextFilter === "punches") {
        params.set("actions", PUNCH_EDIT_AUDIT_ACTIONS.join(","));
      }
      const res = await fetch(`/api/time-clock/audit?${params}`);
      const data = await res.json();
      if (res.ok) {
        setEntries((prev) =>
          append ? [...prev, ...(data.entries || [])] : data.entries || []
        );
        setTotal(data.total || 0);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search audit log"
          className="min-w-[14rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm"
        />
        <select
          value={filter}
          onChange={(e) => {
            const next = e.target.value as FilterKind;
            setFilter(next);
            void load(next, 0, false);
          }}
          className="rounded-lg border border-line px-3 py-2 text-sm"
        >
          <option value="all">All events</option>
          <option value="punches">Punch edits</option>
        </select>
        <p className="text-sm text-ink-soft">{total} event(s)</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white/90">
        <table className="min-w-full text-sm">
          <thead className="border-b border-line bg-wash/60 text-left text-ink-soft">
            <tr>
              <th className="px-4 py-2 font-semibold">When</th>
              <th className="px-4 py-2 font-semibold">Action</th>
              <th className="px-4 py-2 font-semibold">Actor</th>
              <th className="px-4 py-2 font-semibold">Subject</th>
              <th className="px-4 py-2 font-semibold">Team</th>
              <th className="px-4 py-2 font-semibold">Details</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((entry) => (
              <tr key={entry.id} className="border-b border-line/60 align-top last:border-0">
                <td className="px-4 py-2 whitespace-nowrap">
                  {formatDateTime(entry.created_at)}
                </td>
                <td className="px-4 py-2 font-semibold text-ink">
                  {timeClockAuditActionLabel(entry.action)}
                </td>
                <td className="px-4 py-2">
                  <div>{entry.actor_name || entry.actor_email || "—"}</div>
                  <div className="text-xs text-ink-soft">{entry.actor_email}</div>
                </td>
                <td className="px-4 py-2">
                  <div>{entry.subject_name || entry.subject_email || "—"}</div>
                  <div className="text-xs text-ink-soft">{entry.subject_email}</div>
                </td>
                <td className="px-4 py-2">{entry.team_name || "—"}</td>
                <td className="max-w-md px-4 py-2 text-xs text-ink-soft">
                  {formatAuditDetails(entry)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {entries.length < total ? (
        <button
          type="button"
          onClick={() => load(filter, entries.length, true)}
          disabled={busy}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
        >
          {busy ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}

"use client";

import { useState } from "react";
import type { TimeEntry, TimeClockSettings } from "@/lib/timeClockTypes";
import {
  formatDateTime,
  formatDuration,
  formatHours,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from "@/lib/timeClockFormat";

type Props = {
  entries: TimeEntry[];
  settings: TimeClockSettings;
  canRequestEdits?: boolean;
  onUpdated?: () => void;
};

function entrySeconds(entry: TimeEntry): number {
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(entry.clock_in).getTime()) / 1000));
}

export function TimeClockEntries({
  entries,
  settings,
  canRequestEdits = true,
  onUpdated,
}: Props) {
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [proposedIn, setProposedIn] = useState("");
  const [proposedOut, setProposedOut] = useState("");
  const [proposedNotes, setProposedNotes] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function saveNotes(entry: TimeEntry) {
    setBusy(true);
    setMsg("");
    try {
      const notes = editingNotes[entry.id] ?? entry.notes;
      const res = await fetch(`/api/time-clock/entries/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onUpdated?.();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitEditRequest() {
    if (!editEntry) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/time-clock/entries/${editEntry.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "request_edit",
          proposed_clock_in: fromDatetimeLocalValue(proposedIn, settings.timezone),
          proposed_clock_out: proposedOut
            ? fromDatetimeLocalValue(proposedOut, settings.timezone)
            : null,
          proposed_notes: proposedNotes,
          reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setEditEntry(null);
      setMsg("Edit request submitted for manager approval.");
      onUpdated?.();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function openEdit(entry: TimeEntry) {
    setEditEntry(entry);
    setProposedIn(toDatetimeLocalValue(entry.clock_in, settings.timezone));
    setProposedOut(toDatetimeLocalValue(entry.clock_out, settings.timezone));
    setProposedNotes(entry.notes || "");
    setReason("");
    setMsg("");
  }

  if (!entries.length) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-sm text-ink-soft">
        No time entries for this period.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {msg ? (
        <p className="rounded-lg border border-line bg-wash px-3 py-2 text-sm text-ink">{msg}</p>
      ) : null}
      {entries.map((entry) => {
        const notesValue = editingNotes[entry.id] ?? entry.notes ?? "";
        const open = !entry.clock_out;
        return (
          <div
            key={entry.id}
            className="rounded-xl border border-line bg-white/90 px-4 py-3 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">
                  {formatDateTime(entry.clock_in, settings.timezone)}
                  {" → "}
                  {open ? "Now" : formatDateTime(entry.clock_out, settings.timezone)}
                </p>
                <p className="text-sm text-ink-soft">
                  {formatDuration(entrySeconds(entry))}
                  {entry.user_name ? ` · ${entry.user_name}` : ""}
                  {open ? " · In progress" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {canRequestEdits && !open ? (
                  <button
                    type="button"
                    onClick={() => openEdit(entry)}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash"
                  >
                    Request edit
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                value={notesValue}
                onChange={(e) =>
                  setEditingNotes((prev) => ({ ...prev, [entry.id]: e.target.value }))
                }
                placeholder="Notes"
                className="flex-1 rounded-lg border border-line px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={busy || notesValue === (entry.notes || "")}
                onClick={() => saveNotes(entry)}
                className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-50"
              >
                Save note
              </button>
            </div>
          </div>
        );
      })}

      {editEntry ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/30 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-xl">
            <h3 className="font-display text-xl text-ink">Request time edit</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Changes require manager approval before they apply.
            </p>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="font-semibold text-ink-soft">Clock in</span>
                <input
                  type="datetime-local"
                  value={proposedIn}
                  onChange={(e) => setProposedIn(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-ink-soft">Clock out</span>
                <input
                  type="datetime-local"
                  value={proposedOut}
                  onChange={(e) => setProposedOut(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-ink-soft">Notes</span>
                <input
                  type="text"
                  value={proposedNotes}
                  onChange={(e) => setProposedNotes(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                />
              </label>
              <label className="block text-sm">
                <span className="font-semibold text-ink-soft">Reason</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditEntry(null)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy || !proposedIn || !reason.trim()}
                onClick={submitEditRequest}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Submit request
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WeeklyBreakdownTable({
  rows,
}: {
  rows: Array<{ week_start: string; week_end: string; hours: number; entry_count: number }>;
}) {
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white/90">
      <table className="min-w-full text-sm">
        <thead className="border-b border-line bg-wash/60 text-left text-ink-soft">
          <tr>
            <th className="px-4 py-2 font-semibold">Week</th>
            <th className="px-4 py-2 font-semibold">Entries</th>
            <th className="px-4 py-2 font-semibold">Hours</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.week_start} className="border-b border-line/60 last:border-0">
              <td className="px-4 py-2">
                {row.week_start} – {row.week_end}
              </td>
              <td className="px-4 py-2">{row.entry_count}</td>
              <td className="px-4 py-2 font-semibold">{formatHours(row.hours)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

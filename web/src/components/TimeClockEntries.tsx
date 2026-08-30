"use client";

import { useEffect, useState } from "react";
import type { TimeClockAuditEntry, TimeClockSettings, TimeEntry } from "@/lib/timeClockTypes";
import {
  formatDateTime,
  formatDuration,
  formatHours,
  fromDatetimeLocalValue,
  timeClockAuditActionLabel,
  toDatetimeLocalValue,
} from "@/lib/timeClockFormat";

type Props = {
  entries: TimeEntry[];
  settings: TimeClockSettings;
  canRequestEdits?: boolean;
  canManagePunches?: boolean;
  onUpdated?: () => void;
};

function entrySeconds(entry: TimeEntry): number {
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(entry.clock_in).getTime()) / 1000));
}

export function PunchEditedBadge({
  entry,
  timezone,
}: {
  entry: TimeEntry;
  timezone?: string;
}) {
  if (!entry.last_edited_at) return null;
  const by = entry.last_edited_by_name || entry.last_edited_by || "a manager";
  const title = [
    `Edited ${formatDateTime(entry.last_edited_at, timezone)} by ${by}`,
    entry.last_edit_reason ? entry.last_edit_reason : null,
    entry.edit_count && entry.edit_count > 1 ? `${entry.edit_count} edits` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full bg-warn/15 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-warn"
    >
      Edited
    </span>
  );
}

export function PunchEditDialog({
  entry,
  settings,
  mode,
  onClose,
  onSaved,
}: {
  entry: TimeEntry;
  settings: Pick<TimeClockSettings, "timezone">;
  mode: "request" | "manager";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [proposedIn, setProposedIn] = useState(
    toDatetimeLocalValue(entry.clock_in, settings.timezone)
  );
  const [proposedOut, setProposedOut] = useState(
    toDatetimeLocalValue(entry.clock_out, settings.timezone)
  );
  const [proposedNotes, setProposedNotes] = useState(entry.notes || "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [history, setHistory] = useState<TimeClockAuditEntry[] | null>(null);
  const openPunch = !entry.clock_out;
  const isManager = mode === "manager";

  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    fetch(`/api/time-clock/entries/${entry.id}?history=1`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && Array.isArray(data.history)) setHistory(data.history);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id, isManager]);

  async function submit() {
    setBusy(true);
    setMsg("");
    try {
      const payload = {
        proposed_clock_in: fromDatetimeLocalValue(proposedIn, settings.timezone),
        proposed_clock_out: proposedOut
          ? fromDatetimeLocalValue(proposedOut, settings.timezone)
          : null,
        proposed_notes: proposedNotes,
        reason,
      };
      const res = isManager
        ? await fetch(`/api/time-clock/entries/${entry.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clock_in: payload.proposed_clock_in,
              clock_out: payload.proposed_clock_out,
              notes: payload.proposed_notes,
              reason: payload.reason,
            }),
          })
        : await fetch(`/api/time-clock/entries/${entry.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "request_edit",
              ...payload,
            }),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/30 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-white p-5 shadow-xl">
        <h3 className="font-display text-xl text-ink">
          {isManager ? "Edit punch" : "Request time edit"}
        </h3>
        <p className="mt-1 text-sm text-ink-soft">
          {isManager
            ? "This change applies immediately and is logged on the audit trail."
            : "Changes require manager approval before they apply."}
        </p>
        {entry.user_name ? (
          <p className="mt-1 text-sm font-semibold text-ink">{entry.user_name}</p>
        ) : null}
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
            {openPunch && isManager ? (
              <span className="mt-1 block text-xs text-ink-soft">
                Leave blank to keep this punch open.
              </span>
            ) : null}
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
            <span className="font-semibold text-ink-soft">
              {isManager ? "Reason (logged)" : "Reason"}
            </span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
        </div>
        {msg ? <p className="mt-3 text-sm text-fail">{msg}</p> : null}
        {isManager && history && history.length ? (
          <div className="mt-4 rounded-lg border border-line bg-wash/50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Edit history
            </p>
            <ul className="mt-2 space-y-2">
              {history.slice(0, 8).map((event) => (
                <li key={event.id} className="text-xs text-ink-soft">
                  <span className="font-semibold text-ink">
                    {timeClockAuditActionLabel(event.action)}
                  </span>
                  {" · "}
                  {formatDateTime(event.created_at, settings.timezone)}
                  {event.actor_name || event.actor_email
                    ? ` · ${event.actor_name || event.actor_email}`
                    : ""}
                  {typeof event.metadata.reason === "string" && event.metadata.reason
                    ? ` — ${event.metadata.reason}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              busy ||
              !proposedIn ||
              !reason.trim() ||
              (!proposedOut && (!isManager || openPunch === false))
            }
            onClick={submit}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Saving…" : isManager ? "Save punch" : "Submit request"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TimeClockEntries({
  entries,
  settings,
  canRequestEdits = true,
  canManagePunches = false,
  onUpdated,
}: Props) {
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [editEntry, setEditEntry] = useState<TimeEntry | null>(null);
  const [editMode, setEditMode] = useState<"request" | "manager">("request");
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

  function openEdit(entry: TimeEntry, mode: "request" | "manager") {
    setEditEntry(entry);
    setEditMode(mode);
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
                <p className="flex flex-wrap items-center gap-2 font-semibold text-ink">
                  <span>
                    {formatDateTime(entry.clock_in, settings.timezone)}
                    {" → "}
                    {open ? "Now" : formatDateTime(entry.clock_out, settings.timezone)}
                  </span>
                  <PunchEditedBadge entry={entry} timezone={settings.timezone} />
                </p>
                <p className="text-sm text-ink-soft">
                  {formatDuration(entrySeconds(entry))}
                  {entry.user_name ? ` · ${entry.user_name}` : ""}
                  {open ? " · In progress" : ""}
                </p>
              </div>
              <div className="flex gap-2">
                {canManagePunches ? (
                  <button
                    type="button"
                    onClick={() => openEdit(entry, "manager")}
                    className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash"
                  >
                    Edit punch
                  </button>
                ) : canRequestEdits && !open ? (
                  <button
                    type="button"
                    onClick={() => openEdit(entry, "request")}
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
        <PunchEditDialog
          entry={editEntry}
          settings={settings}
          mode={editMode}
          onClose={() => setEditEntry(null)}
          onSaved={() => {
            setEditEntry(null);
            setMsg(
              editMode === "manager"
                ? "Punch updated and logged."
                : "Edit request submitted for manager approval."
            );
            onUpdated?.();
          }}
        />
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

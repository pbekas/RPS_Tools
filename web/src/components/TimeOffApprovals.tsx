"use client";

import { useMemo, useState } from "react";
import { SearchSelect } from "@/components/SearchSelect";
import type {
  TeamTimeOffEntry,
  TimeOffEntry,
  TimeOffKind,
} from "@/lib/timeClockTypes";
import {
  TIME_OFF_KIND_LABELS,
  deductsFromTimeOffBank,
} from "@/lib/timeClockTypes";
import { formatHours, formatYmd } from "@/lib/timeClockFormat";

type Person = { email: string; name: string };

type Props = {
  initialRequests: TimeOffEntry[];
  initialApproved: TimeOffEntry[];
  overlapEntries: TeamTimeOffEntry[];
  people: Person[];
};

type Draft = {
  entry_date: string;
  kind: TimeOffKind;
  hours: string;
  notes: string;
};

export function TimeOffApprovals({
  initialRequests,
  initialApproved,
  overlapEntries,
  people,
}: Props) {
  const [requests, setRequests] = useState(initialRequests);
  const [approved, setApproved] = useState(initialApproved);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [msgIsError, setMsgIsError] = useState(false);
  const [person, setPerson] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  const othersByDate = useMemo(() => {
    const map = new Map<string, TeamTimeOffEntry[]>();
    for (const entry of overlapEntries) {
      const list = map.get(entry.entry_date) || [];
      list.push(entry);
      map.set(entry.entry_date, list);
    }
    return map;
  }, [overlapEntries]);

  async function review(entry: TimeOffEntry, approve: boolean) {
    setBusyId(entry.id);
    setMsg("");
    setMsgIsError(false);
    try {
      const res = await fetch(`/api/time-clock/time-off/${entry.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: approve ? "approve" : "deny",
          review_notes: notes[entry.id] || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setRequests((prev) => prev.filter((r) => r.id !== entry.id));
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(entry: TimeOffEntry) {
    setEditingId(entry.id);
    setDraft({
      entry_date: entry.entry_date,
      kind: entry.kind,
      hours: String(entry.hours),
      notes: entry.notes,
    });
    setMsg("");
    setMsgIsError(false);
  }

  async function saveEdit(entry: TimeOffEntry) {
    if (!draft) return;
    setBusyId(entry.id);
    setMsg("");
    setMsgIsError(false);
    try {
      const res = await fetch(`/api/time-clock/time-off/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_date: draft.entry_date,
          kind: draft.kind,
          hours: Number(draft.hours),
          notes: draft.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      const saved = data.entry as TimeOffEntry;
      setApproved((prev) =>
        prev
          .map((row) => (row.id === saved.id ? { ...row, ...saved } : row))
          .sort((a, b) => a.entry_date.localeCompare(b.entry_date))
      );
      setEditingId(null);
      setDraft(null);
      setMsg("Approved time off updated.");
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function removeApproved(entry: TimeOffEntry) {
    const label = entry.user_name || entry.user_email;
    if (
      !window.confirm(
        `Remove approved time off for ${label} on ${formatYmd(entry.entry_date)}? Bank hours will be restored.`
      )
    ) {
      return;
    }
    setBusyId(entry.id);
    setMsg("");
    setMsgIsError(false);
    try {
      const res = await fetch(`/api/time-clock/time-off/${entry.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      setApproved((prev) => prev.filter((row) => row.id !== entry.id));
      if (editingId === entry.id) {
        setEditingId(null);
        setDraft(null);
      }
      setMsg("Approved time off removed.");
    } catch (err) {
      setMsgIsError(true);
      setMsg(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusyId(null);
    }
  }

  const personOptions = useMemo(
    () =>
      people.map((row) => ({
        value: row.email,
        label: row.name || row.email,
        hint: row.email,
      })),
    [people]
  );

  const visibleApproved = useMemo(() => {
    const needle = person.trim().toLowerCase();
    const rows = needle
      ? approved.filter((entry) => entry.user_email.toLowerCase() === needle)
      : approved;
    return [...rows].sort((a, b) => {
      const byDate = b.entry_date.localeCompare(a.entry_date);
      if (byDate) return byDate;
      return (a.user_name || a.user_email).localeCompare(
        b.user_name || b.user_email
      );
    });
  }, [approved, person]);

  return (
    <div className="space-y-8">
      {msg ? (
        <p className={`text-sm ${msgIsError ? "text-fail" : "text-ink"}`}>{msg}</p>
      ) : null}
      <section className="space-y-4">
        <h2 className="font-display text-xl text-ink">Waiting for approval</h2>
        {!requests.length ? (
          <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-sm text-ink-soft">
            No time-off requests waiting for approval.
          </p>
        ) : null}
      {requests.map((entry) => {
        const others = (othersByDate.get(entry.entry_date) || []).filter(
          (other) => other.user_email !== entry.user_email
        );
        return (
          <div
            key={entry.id}
            className="rounded-xl border border-line bg-white/90 p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">
                  {entry.user_name || entry.user_email}
                </p>
                <p className="text-sm text-ink-soft">{entry.user_email}</p>
              </div>
              <p className="text-lg font-semibold text-accent">
                {formatHours(entry.hours)}
              </p>
            </div>
            <p className="mt-2 text-sm text-ink">
              {formatYmd(entry.entry_date)} ·{" "}
              {TIME_OFF_KIND_LABELS[entry.kind] || entry.kind}
              {entry.notes ? ` — ${entry.notes}` : ""}
            </p>
            {others.length ? (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                  others.length >= 2
                    ? "border border-warn/40 bg-warn/10 text-ink"
                    : "border border-line bg-wash/80 text-ink"
                }`}
              >
                <p className="font-semibold">
                  {others.length === 1
                    ? "Someone else is also off this day"
                    : `${others.length} other people are also off this day`}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {others.map((other) => (
                    <li key={other.id} className="text-ink-soft">
                      {other.user_name || other.user_email}
                      {other.team_name ? ` · ${other.team_name}` : ""}
                      {" · "}
                      {TIME_OFF_KIND_LABELS[other.kind] || other.kind}
                      {" · "}
                      {other.status === "approved" ? "approved" : "requested"}
                      {" · "}
                      {formatHours(other.hours)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">
                Nobody else has requested this date.
              </p>
            )}
            <textarea
              value={notes[entry.id] || ""}
              onChange={(e) =>
                setNotes((prev) => ({ ...prev, [entry.id]: e.target.value }))
              }
              placeholder="Optional note (shown if you deny the request)"
              rows={2}
              className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busyId === entry.id}
                onClick={() => review(entry, true)}
                className="rounded-lg bg-pass px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyId === entry.id}
                onClick={() => review(entry, false)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fail disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </div>
        );
      })}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-ink">Approved time off</h2>
            <p className="text-sm text-ink-soft">
              Change the date, type, hours, or notes, or remove an approved day.
              Time Off and sick hours go back to the annual bank when you remove
              them or switch them to a type that does not use the bank.
            </p>
          </div>
          <div className="w-full sm:w-64">
            <SearchSelect
              options={personOptions}
              value={person}
              onChange={setPerson}
              placeholder="Everyone"
              blankLabel="Everyone"
            />
          </div>
        </div>
        {!visibleApproved.length ? (
          <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-sm text-ink-soft">
            No approved time off in the last year or the next 18 months.
          </p>
        ) : (
          visibleApproved.map((entry) => {
            const editing = editingId === entry.id && draft;
            return (
              <div
                key={entry.id}
                className="rounded-xl border border-line bg-white/90 p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-ink">
                      {entry.user_name || entry.user_email}
                    </p>
                    <p className="text-sm text-ink-soft">{entry.user_email}</p>
                  </div>
                  <p className="text-lg font-semibold text-accent">
                    {formatHours(entry.hours)}
                  </p>
                </div>
                {editing ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="block text-sm">
                      <span className="font-semibold text-ink-soft">Date</span>
                      <input
                        type="date"
                        value={draft.entry_date}
                        onChange={(e) =>
                          setDraft({ ...draft, entry_date: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="font-semibold text-ink-soft">Type</span>
                      <select
                        value={draft.kind}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            kind: e.target.value as TimeOffKind,
                          })
                        }
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                      >
                        {(Object.keys(TIME_OFF_KIND_LABELS) as TimeOffKind[]).map(
                          (kind) => (
                            <option key={kind} value={kind}>
                              {TIME_OFF_KIND_LABELS[kind]}
                              {deductsFromTimeOffBank(kind)
                                ? " (uses bank)"
                                : " (no bank)"}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                    <label className="block text-sm">
                      <span className="font-semibold text-ink-soft">Hours</span>
                      <input
                        type="number"
                        min={0.5}
                        max={24}
                        step={0.5}
                        value={draft.hours}
                        onChange={(e) =>
                          setDraft({ ...draft, hours: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="font-semibold text-ink-soft">Notes</span>
                      <input
                        type="text"
                        value={draft.notes}
                        onChange={(e) =>
                          setDraft({ ...draft, notes: e.target.value })
                        }
                        className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                      />
                    </label>
                    <div className="flex gap-2 sm:col-span-2">
                      <button
                        type="button"
                        disabled={busyId === entry.id || !draft.entry_date}
                        onClick={() => saveEdit(entry)}
                        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() => {
                          setEditingId(null);
                          setDraft(null);
                        }}
                        className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mt-2 text-sm text-ink">
                      {formatYmd(entry.entry_date)} ·{" "}
                      {TIME_OFF_KIND_LABELS[entry.kind] || entry.kind}
                      {entry.notes ? ` — ${entry.notes}` : ""}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() => startEdit(entry)}
                        className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busyId === entry.id}
                        onClick={() => removeApproved(entry)}
                        className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fail disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

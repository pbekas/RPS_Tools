"use client";

import { useCallback, useState } from "react";
import type { TimeOffEntry, TimeOffKind } from "@/lib/timeClockTypes";

const KIND_LABELS: Record<TimeOffKind, string> = {
  pto: "PTO",
  sick: "Sick",
  holiday: "Holiday",
  unpaid: "Unpaid",
};

type Props = {
  weekStart: string;
  weekEnd: string;
  initialEntries: TimeOffEntry[];
  canEdit: boolean;
  onChanged?: () => void;
};

export function TimeOffPanel({
  weekStart,
  weekEnd,
  initialEntries,
  canEdit,
  onChanged,
}: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [entryDate, setEntryDate] = useState(weekStart);
  const [kind, setKind] = useState<TimeOffKind>("pto");
  const [hours, setHours] = useState("8");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const reload = useCallback(async () => {
    const params = new URLSearchParams({ week_start: weekStart });
    const res = await fetch(`/api/time-clock/time-off?${params}`);
    const data = await res.json();
    if (res.ok) setEntries(data.entries || []);
  }, [weekStart]);

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/time-clock/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_date: entryDate,
          kind,
          hours: Number(hours),
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      await reload();
      onChanged?.();
      setNotes("");
      setMsg("Time off saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this time off day?")) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/time-clock/time-off/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await reload();
      onChanged?.();
      setMsg("Time off removed.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-white/90 p-4 shadow-sm">
      <div>
        <h2 className="font-display text-xl text-ink">Time off</h2>
        <p className="text-sm text-ink-soft">
          Log PTO, sick, holiday, or unpaid days for {weekStart} – {weekEnd}.
          Time off suppresses forgot-to-punch reminders.
        </p>
      </div>

      {entries.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <div>
                <span className="font-semibold text-ink">{entry.entry_date}</span>
                <span className="mx-2 text-ink-soft">·</span>
                <span>{KIND_LABELS[entry.kind]}</span>
                <span className="mx-2 text-ink-soft">·</span>
                <span>{entry.hours}h</span>
                {entry.notes ? (
                  <span className="ml-2 text-ink-soft">— {entry.notes}</span>
                ) : null}
              </div>
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(entry.id)}
                  className="text-sm font-semibold text-fail hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">No time off logged this week.</p>
      )}

      <p className="text-sm font-semibold text-ink">{totalHours}h time off this week</p>

      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Date</span>
            <input
              type="date"
              value={entryDate}
              min={weekStart}
              max={weekEnd}
              onChange={(e) => setEntryDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Type</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TimeOffKind)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            >
              {(Object.keys(KIND_LABELS) as TimeOffKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Hours</span>
            <input
              type="number"
              min={0.5}
              max={24}
              step={0.5}
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="font-semibold text-ink-soft">Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
              placeholder="e.g. vacation, doctor appointment"
            />
          </label>
          <button
            type="button"
            onClick={save}
            disabled={busy || !entryDate}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2 sm:w-fit"
          >
            {busy ? "Saving…" : "Add / update day"}
          </button>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-ink">{msg}</p> : null}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TimeOffBank, TimeOffEntry, TimeOffKind } from "@/lib/timeClockTypes";
import { deductsFromTimeOffBank } from "@/lib/timeClockTypes";
import { formatHours } from "@/lib/timeClockFormat";
import { TimeOffBankCard } from "@/components/TimeOffBankCard";

const KIND_LABELS: Record<TimeOffKind, string> = {
  pto: "Time Off",
  sick: "Sick",
  holiday: "Holiday",
  unpaid: "Unpaid",
};

const STATUS_STYLES: Record<TimeOffEntry["status"], string> = {
  pending: "bg-wash text-accent",
  approved: "bg-pass/10 text-pass",
  denied: "bg-fail/10 text-fail",
};

function addMonths(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Props = {
  weekStart: string;
  weekEnd: string;
  initialEntries: TimeOffEntry[];
  initialBank: TimeOffBank;
  canEdit: boolean;
  onChanged?: () => void;
};

export function TimeOffPanel({
  weekStart,
  weekEnd,
  initialEntries,
  initialBank,
  canEdit,
  onChanged,
}: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [bank, setBank] = useState(initialBank);
  const [entryDate, setEntryDate] = useState(todayIso());
  const [kind, setKind] = useState<TimeOffKind>("pto");
  const [hours, setHours] = useState("8");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const maxDate = addMonths(todayIso(), 18);

  const reload = useCallback(async () => {
    const params = new URLSearchParams({
      from: weekStart,
      to: addMonths(weekStart, 18),
    });
    const res = await fetch(`/api/time-clock/time-off?${params}`);
    const data = await res.json();
    if (res.ok) {
      setEntries(data.entries || []);
      if (data.bank) setBank(data.bank);
    }
  }, [weekStart]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit() {
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
      if (!res.ok) throw new Error(data.error || "Request failed");
      await reload();
      if (data.bank) setBank(data.bank);
      onChanged?.();
      setNotes("");
      setMsg(
        data.entry?.status === "approved"
          ? "Time off saved."
          : "Time-off request submitted for supervisor or admin approval."
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this time-off request?")) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/time-clock/time-off/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed");
      await reload();
      if (data.bank) setBank(data.bank);
      onChanged?.();
      setMsg("Time-off request removed.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  const thisWeek = useMemo(
    () => entries.filter((e) => e.entry_date >= weekStart && e.entry_date <= weekEnd),
    [entries, weekStart, weekEnd]
  );
  const upcoming = useMemo(
    () => entries.filter((e) => e.entry_date > weekEnd),
    [entries, weekEnd]
  );
  const weekHours = thisWeek
    .filter((e) => e.status !== "denied")
    .reduce((sum, e) => sum + e.hours, 0);

  function row(entry: TimeOffEntry) {
    const canRemove = canEdit && entry.status !== "approved";
    return (
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
          <span
            className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLES[entry.status]}`}
          >
            {entry.status}
          </span>
          {entry.notes ? (
            <span className="ml-2 text-ink-soft">— {entry.notes}</span>
          ) : null}
          {entry.status === "denied" && entry.review_notes ? (
            <span className="ml-2 text-fail">— {entry.review_notes}</span>
          ) : null}
        </div>
        {canRemove ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => remove(entry.id)}
            className="text-sm font-semibold text-fail hover:underline disabled:opacity-50"
          >
            Cancel
          </button>
        ) : null}
      </li>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-white/90 p-4 shadow-sm">
      <div>
        <h2 className="font-display text-xl text-ink">Time off</h2>
        <p className="text-sm text-ink-soft">
          Request time off for any future date. Supervisors and admins approve or deny
          each request. Approved Time Off and sick days deduct from your annual bank.
        </p>
      </div>

      {bank.eligible !== false ? <TimeOffBankCard bank={bank} /> : null}

      {thisWeek.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {thisWeek.map(row)}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">No time-off requests this week.</p>
      )}

      {upcoming.length ? (
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Upcoming requests
          </p>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {upcoming.map(row)}
          </ul>
        </div>
      ) : null}

      <p className="text-sm font-semibold text-ink">
        {formatHours(weekHours)} time off this week
      </p>

      {canEdit ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Date</span>
            <input
              type="date"
              value={entryDate}
              max={maxDate}
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
                  {deductsFromTimeOffBank(k) ? " (uses bank)" : " (no bank)"}
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
            onClick={submit}
            disabled={busy || !entryDate}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2 sm:w-fit"
          >
            {busy ? "Submitting…" : "Submit request"}
          </button>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-ink">{msg}</p> : null}
    </div>
  );
}

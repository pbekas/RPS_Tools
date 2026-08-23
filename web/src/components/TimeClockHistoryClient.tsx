"use client";

import { useCallback, useState } from "react";
import type { TimeClockSettings, TimeEntry } from "@/lib/timeClockTypes";
import { TimeClockEntries } from "@/components/TimeClockEntries";

type Props = {
  initialEntries: TimeEntry[];
  settings: TimeClockSettings;
  initialFrom: string;
  initialTo: string;
};

export function TimeClockHistoryClient({
  initialEntries,
  settings,
  initialFrom,
  initialTo,
}: Props) {
  const [entries, setEntries] = useState(initialEntries);
  const [from, setFrom] = useState(initialFrom.slice(0, 10));
  const [to, setTo] = useState(initialTo.slice(0, 10));
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59`).toISOString();
      const params = new URLSearchParams({ from: fromIso, to: toIso, limit: "200" });
      const res = await fetch(`/api/time-clock/entries?${params}`);
      const data = await res.json();
      if (res.ok) setEntries(data.entries || []);
    } finally {
      setBusy(false);
    }
  }, [from, to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-lg border border-line px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-lg border border-line px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={load}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Loading…" : "Load"}
        </button>
      </div>
      <TimeClockEntries entries={entries} settings={settings} onUpdated={load} />
    </div>
  );
}

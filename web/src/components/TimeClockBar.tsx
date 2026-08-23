"use client";

import { useCallback, useEffect, useState } from "react";
import type { PunchStatus, TimeClockSettings } from "@/lib/timeClockTypes";
import { formatDateTime, formatDuration } from "@/lib/timeClockFormat";

type Props = {
  initialStatus: PunchStatus;
  settings: TimeClockSettings;
  onPunch?: () => void;
};

export function TimeClockBar({ initialStatus, settings, onPunch }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [elapsed, setElapsed] = useState(initialStatus.elapsed_seconds);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    if (!status.is_clocked_in) return;
    const tick = () => {
      if (!status.open_entry) return;
      const start = new Date(status.open_entry.clock_in).getTime();
      setElapsed(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
  }, [status]);

  const punch = useCallback(
    async (action: "clock_in" | "clock_out") => {
      setBusy(true);
      setMsg("");
      try {
        const res = await fetch("/api/time-clock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, notes: action === "clock_out" ? notes : undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Action failed");
        setStatus(data.status);
        setElapsed(data.status.elapsed_seconds);
        if (action === "clock_out") {
          setNotes("");
          setShowNotes(false);
        }
        onPunch?.();
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Action failed");
      } finally {
        setBusy(false);
      }
    },
    [notes, onPunch]
  );

  const statusText = status.is_clocked_in
    ? `Clocked in since ${formatDateTime(status.open_entry?.clock_in || null, settings.timezone)} · ${formatDuration(elapsed)}`
    : "Clocked out";

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-white/90 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-soft">Time clock</p>
        <p className="truncate text-base font-semibold text-ink">{statusText}</p>
        {msg ? <p className="mt-1 text-sm text-fail">{msg}</p> : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {status.is_clocked_in ? (
          <>
            {showNotes ? (
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional note for this segment"
                className="w-full min-w-[12rem] rounded-lg border border-line px-3 py-2 text-sm sm:w-56"
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowNotes(true)}
                className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
              >
                Add note
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => punch("clock_out")}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
            >
              {busy ? "Saving…" : "Clock out"}
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => punch("clock_in")}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            {busy ? "Saving…" : "Clock in"}
          </button>
        )}
      </div>
    </div>
  );
}

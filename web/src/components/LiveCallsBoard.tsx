"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";

type LiveRow = {
  extension: string;
  name: string;
  email?: string;
  status: string;
  direction?: string;
  on_call_with?: string;
  duration_seconds?: number | null;
  call_id?: string | null;
};

type LiveBoard = {
  ok?: boolean;
  telephony_error?: string | null;
  fetched_at?: string;
  active_calls?: number;
  ringing?: number;
  on_call?: number;
  idle?: number;
  directory?: LiveRow[];
  error?: string;
};

function statusTone(status: string): string {
  const s = status.toLowerCase();
  if (s === "ringing") return "bg-amber-100 text-warn";
  if (s === "on-call" || s === "busy") return "bg-emerald-100 text-pass";
  if (s === "held") return "bg-sky-100 text-ink";
  return "bg-zinc-100 text-ink-soft";
}

export function LiveCallsBoard() {
  const [board, setBoard] = useState<LiveBoard | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const res = await fetch("/api/ops/live-calls", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load live calls");
      setBoard(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load live calls");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, []);

  const rows = board?.directory || [];
  const activeRows = rows.filter((r) => r.status !== "idle");
  const showRows = activeRows.length > 0 ? activeRows : rows.slice(0, 40);

  return (
    <section className="mb-8 rounded-2xl border border-line bg-white/85 p-5 shadow-soft">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Live
          </p>
          <h2 className="mt-1 font-display text-2xl text-ink">Who&apos;s on a call</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Telephony snapshot every 5s · ringing and on-call lines first
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-xl border border-line px-3 py-2 text-sm font-semibold text-ink hover:bg-wash"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-line bg-wash px-4 py-3 text-sm text-ink-soft">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <Stat label="Ringing" value={board?.ringing ?? 0} />
        <Stat label="On call" value={board?.on_call ?? 0} />
        <Stat label="Idle (mapped)" value={board?.idle ?? 0} />
        <Stat label="Active calls" value={board?.active_calls ?? 0} />
      </div>

      {loading && !board ? (
        <p className="mt-4 text-sm text-ink-soft">Loading…</p>
      ) : activeRows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">
          No one is ringing or on a call right now
          {rows.length ? ` · ${rows.length} mapped extensions idle` : ""}.
        </p>
      ) : null}

      {board?.telephony_error ? (
        <p className="mt-3 text-xs text-warn">Telephony: {board.telephony_error}</p>
      ) : null}

      {showRows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-3 py-2">Ext</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">On call with</th>
                <th className="px-3 py-2">Duration</th>
              </tr>
            </thead>
            <tbody>
              {showRows.map((row) => (
                <tr
                  key={`${row.extension}-${row.call_id || "idle"}`}
                  className="border-b border-line/70 last:border-0"
                >
                  <td className="px-3 py-2 font-semibold text-ink">{row.extension}</td>
                  <td className="px-3 py-2 text-ink">{row.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone(
                        row.status
                      )}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">
                    {row.on_call_with || "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-soft">
                    {row.duration_seconds != null
                      ? formatDuration(row.duration_seconds)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {board?.fetched_at ? (
        <p className="mt-2 text-[11px] text-ink-soft">
          Updated {new Date(board.fetched_at).toLocaleTimeString()}
        </p>
      ) : null}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-wash/50 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </div>
      <div className="font-display text-xl text-ink">{value}</div>
    </div>
  );
}

"use client";

import { useState } from "react";
import type { TimeClockReport } from "@/lib/timeClockTypes";
import { WeeklyBreakdownTable } from "@/components/TimeClockEntries";
import { formatHours } from "@/lib/timeClockFormat";

type Props = {
  initialFrom: string;
  initialTo: string;
  initialReport: TimeClockReport | null;
  teamMode?: boolean;
};

export function TimeClockReportPanel({
  initialFrom,
  initialTo,
  initialReport,
  teamMode = false,
}: Props) {
  const [from, setFrom] = useState(initialFrom.slice(0, 10));
  const [to, setTo] = useState(initialTo.slice(0, 10));
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function loadReport() {
    setBusy(true);
    setMsg("");
    try {
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${to}T23:59:59`).toISOString();
      const params = new URLSearchParams({
        from: fromIso,
        to: toIso,
        ...(teamMode ? { team: "1" } : {}),
      });
      const res = await fetch(`/api/time-clock/report?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load report");
      setReport(data.report);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const fromIso = new Date(`${from}T00:00:00`).toISOString();
    const toIso = new Date(`${to}T23:59:59`).toISOString();
    const params = new URLSearchParams({
      from: fromIso,
      to: toIso,
      format: "csv",
      ...(teamMode ? { team: "1" } : {}),
    });
    window.location.href = `/api/time-clock/report?${params}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white/90 p-4">
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
          onClick={loadReport}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Loading…" : "Run report"}
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
        >
          Export CSV
        </button>
      </div>

      {msg ? <p className="text-sm text-fail">{msg}</p> : null}

      {report ? (
        <>
          <div className="rounded-xl border border-line bg-white/90 px-4 py-4">
            <p className="text-sm text-ink-soft">Total hours for period</p>
            <p className="font-display text-3xl text-ink">{formatHours(report.total_hours)}</p>
            <p className="mt-1 text-xs text-ink-soft">{report.timezone}</p>
          </div>

          <div>
            <h2 className="mb-3 font-display text-xl text-ink">Weekly breakdown</h2>
            <WeeklyBreakdownTable rows={report.weekly_breakdown} />
          </div>

          {teamMode && report.by_user?.length ? (
            <div className="space-y-4">
              <h2 className="font-display text-xl text-ink">By team member</h2>
              {report.by_user.map((user) => (
                <div
                  key={user.user_email}
                  className="rounded-xl border border-line bg-white/90 px-4 py-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-ink">{user.user_name}</p>
                      <p className="text-sm text-ink-soft">{user.user_email}</p>
                    </div>
                    <p className="text-lg font-semibold text-accent">
                      {formatHours(user.total_hours)}
                    </p>
                  </div>
                  <div className="mt-3">
                    <WeeklyBreakdownTable rows={user.weekly_breakdown} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

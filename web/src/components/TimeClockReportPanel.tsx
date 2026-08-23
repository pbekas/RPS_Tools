"use client";

import { useCallback, useMemo, useState } from "react";
import type { TimeClockReport } from "@/lib/timeClockTypes";
import { WeeklyBreakdownTable } from "@/components/TimeClockEntries";
import { formatHours } from "@/lib/timeClockFormat";
import {
  formatPayPeriodLabel,
  resolvePayPeriod,
  type PayPeriodBounds,
} from "@/lib/timeClockPayPeriod";

type PayPeriodConfig = {
  timezone: string;
};

type Props = {
  initialFrom: string;
  initialTo: string;
  initialReport: TimeClockReport | null;
  teamMode?: boolean;
  payPeriodConfig: PayPeriodConfig;
  initialPreset?: "current" | "previous" | "custom";
};

const APPROVAL_STYLES: Record<string, string> = {
  approved: "text-pass",
  submitted: "text-accent",
  open: "text-warn",
  rejected: "text-fail",
  none: "text-ink-soft",
};

export function TimeClockReportPanel({
  initialFrom,
  initialTo,
  initialReport,
  teamMode = false,
  payPeriodConfig,
  initialPreset = "current",
}: Props) {
  const [preset, setPreset] = useState<"current" | "previous" | "custom">(initialPreset);
  const [from, setFrom] = useState(initialFrom.slice(0, 10));
  const [to, setTo] = useState(initialTo.slice(0, 10));
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const activePayPeriod = useMemo((): PayPeriodBounds | null => {
    if (preset === "custom") return null;
    return resolvePayPeriod(
      payPeriodConfig.timezone,
      new Date(),
      preset === "previous" ? -1 : 0
    );
  }, [payPeriodConfig, preset]);

  const applyPreset = useCallback(
    (next: "current" | "previous" | "custom") => {
      setPreset(next);
      if (next === "custom") return;
      const bounds = resolvePayPeriod(
        payPeriodConfig.timezone,
        new Date(),
        next === "previous" ? -1 : 0
      );
      setFrom(bounds.period_start);
      setTo(bounds.period_end);
    },
    [payPeriodConfig]
  );

  async function loadReport() {
    setBusy(true);
    setMsg("");
    try {
      const params = new URLSearchParams({
        ...(teamMode ? { team: "1" } : {}),
        approval: "1",
      });
      if (preset !== "custom") {
        params.set("pay_period", preset);
      } else {
        params.set("from", new Date(`${from}T00:00:00`).toISOString());
        params.set("to", new Date(`${to}T23:59:59`).toISOString());
      }
      const res = await fetch(`/api/time-clock/report?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load report");
      setReport(data.report);
      if (data.report?.pay_period) {
        setFrom(data.report.pay_period.period_start);
        setTo(data.report.pay_period.period_end);
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load report");
    } finally {
      setBusy(false);
    }
  }

  function exportReport(format: "csv" | "pdf") {
    const params = new URLSearchParams({
      format,
      ...(teamMode ? { team: "1" } : {}),
    });
    if (preset !== "custom") {
      params.set("pay_period", preset);
    } else {
      params.set("from", new Date(`${from}T00:00:00`).toISOString());
      params.set("to", new Date(`${to}T23:59:59`).toISOString());
    }
    if (format === "pdf") {
      params.set("approval", "1");
    }
    window.location.href = `/api/time-clock/report?${params}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white/90 p-4">
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">Date range</span>
          <select
            value={preset}
            onChange={(e) =>
              applyPreset(e.target.value as "current" | "previous" | "custom")
            }
            className="mt-1 block min-w-[12rem] rounded-lg border border-line px-3 py-2"
          >
            <option value="current">Current pay period</option>
            <option value="previous">Previous pay period</option>
            <option value="custom">Custom dates</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">From</span>
          <input
            type="date"
            value={from}
            disabled={preset !== "custom"}
            onChange={(e) => {
              setPreset("custom");
              setFrom(e.target.value);
            }}
            className="mt-1 block rounded-lg border border-line px-3 py-2 disabled:bg-wash"
          />
        </label>
        <label className="text-sm">
          <span className="font-semibold text-ink-soft">To</span>
          <input
            type="date"
            value={to}
            disabled={preset !== "custom"}
            onChange={(e) => {
              setPreset("custom");
              setTo(e.target.value);
            }}
            className="mt-1 block rounded-lg border border-line px-3 py-2 disabled:bg-wash"
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
          onClick={() => exportReport("csv")}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={() => exportReport("pdf")}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
        >
          Export PDF
        </button>
      </div>

      {activePayPeriod ? (
        <p className="text-sm text-ink-soft">{formatPayPeriodLabel(activePayPeriod)}</p>
      ) : null}

      {msg ? <p className="text-sm text-fail">{msg}</p> : null}

      {report ? (
        <>
          <div className="rounded-xl border border-line bg-white/90 px-4 py-4">
            <p className="text-sm text-ink-soft">
              {report.pay_period
                ? `Pay period ${report.pay_period.period_number === 1 ? "1–15" : "16–end"} total hours`
                : "Total hours for period"}
            </p>
            <p className="font-display text-3xl text-ink">{formatHours(report.total_hours)}</p>
            {report.pay_period ? (
              <p className="mt-1 text-sm text-ink-soft">
                {report.pay_period.period_start} – {report.pay_period.period_end}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-ink-soft">{report.timezone}</p>
          </div>

          {teamMode && report.by_user?.length ? (
            <div className="space-y-4">
              <h2 className="font-display text-xl text-ink">By employee</h2>
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
                    <div className="text-right">
                      <p className="text-lg font-semibold text-accent">
                        {formatHours(user.total_hours)}
                      </p>
                      {user.approval ? (
                        <p
                          className={`text-xs font-semibold uppercase tracking-wide ${
                            APPROVAL_STYLES[user.approval.status] || APPROVAL_STYLES.none
                          }`}
                        >
                          {user.approval.status === "approved"
                            ? `Approved by ${user.approval.reviewed_by_name || "manager"}`
                            : user.approval.status}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3">
                    <WeeklyBreakdownTable rows={user.weekly_breakdown} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <h2 className="mb-3 font-display text-xl text-ink">Weekly breakdown</h2>
              <WeeklyBreakdownTable rows={report.weekly_breakdown} />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

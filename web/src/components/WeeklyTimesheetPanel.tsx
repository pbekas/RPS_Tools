"use client";

import { useCallback, useState } from "react";
import type { TimeClockSettings, WeeklyTimesheet } from "@/lib/timeClockTypes";
import { TimeClockEntries } from "@/components/TimeClockEntries";
import { TimeOffPanel } from "@/components/TimeOffPanel";
import { formatHours, shiftWeekStart } from "@/lib/timeClockFormat";

type Props = {
  initialTimesheet: WeeklyTimesheet;
  settings: TimeClockSettings;
  displayTimezone: string;
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-wash text-ink-soft",
  submitted: "bg-wash text-accent",
  approved: "bg-pass/10 text-pass",
  rejected: "bg-fail/10 text-fail",
};

export function WeeklyTimesheetPanel({
  initialTimesheet,
  settings,
  displayTimezone,
}: Props) {
  const [timesheet, setTimesheet] = useState(initialTimesheet);
  const [weekStart, setWeekStart] = useState(initialTimesheet.week_start);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const displaySettings = { ...settings, timezone: displayTimezone };

  const loadWeek = useCallback(async (nextWeekStart: string) => {
    setBusy(true);
    setMsg("");
    try {
      const params = new URLSearchParams({ week_start: nextWeekStart });
      const res = await fetch(`/api/time-clock/timesheets?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load timesheet");
      setTimesheet(data.timesheet);
      setWeekStart(nextWeekStart);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load timesheet");
    } finally {
      setBusy(false);
    }
  }, []);

  async function submitWeek() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/time-clock/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", week_start: weekStart }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      setTimesheet(data.timesheet);
      setMsg("Timesheet submitted for manager approval.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  const canEdit =
    timesheet.status !== "approved" && timesheet.status !== "submitted";
  const canSubmit =
    (timesheet.status === "open" || timesheet.status === "rejected") &&
    !timesheet.has_open_entry &&
    !timesheet.has_pending_edits &&
    ((timesheet.entries?.length || 0) > 0 || (timesheet.time_off?.length || 0) > 0);

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-line bg-white/90 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-ink">Weekly timesheet</h2>
            <p className="text-sm text-ink-soft">
              {timesheet.week_start} – {timesheet.week_end} ({displayTimezone})
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => loadWeek(shiftWeekStart(weekStart, -1))}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => loadWeek(shiftWeekStart(weekStart, 1))}
              className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash"
            >
              Next
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              STATUS_STYLES[timesheet.status] || STATUS_STYLES.open
            }`}
          >
            {timesheet.status}
          </span>
          <span className="text-sm font-semibold text-ink">
            {formatHours(timesheet.total_hours)} worked
          </span>
          {(timesheet.time_off_hours || 0) > 0 ? (
            <span className="text-sm text-ink-soft">
              {formatHours(timesheet.time_off_hours || 0)} time off
            </span>
          ) : null}
          {timesheet.status === "rejected" && timesheet.review_notes ? (
            <span className="text-sm text-fail">Manager note: {timesheet.review_notes}</span>
          ) : null}
        </div>

        {timesheet.has_open_entry ? (
          <p className="rounded-lg border border-warn/30 bg-wash px-3 py-2 text-sm text-warn">
            Clock out of all open entries before submitting this week.
          </p>
        ) : null}
        {timesheet.has_pending_edits ? (
          <p className="rounded-lg border border-warn/30 bg-wash px-3 py-2 text-sm text-warn">
            You have pending edit requests for this week. Wait for manager review before submitting.
          </p>
        ) : null}
        {msg ? <p className="text-sm text-ink">{msg}</p> : null}

        {canSubmit ? (
          <button
            type="button"
            disabled={busy}
            onClick={submitWeek}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit timesheet for approval"}
          </button>
        ) : null}

        {timesheet.status === "approved" ? (
          <p className="text-sm text-ink-soft">
            This week is approved and locked. Contact a manager if you need changes.
          </p>
        ) : null}

        <TimeClockEntries
          entries={timesheet.entries || []}
          settings={displaySettings}
          canRequestEdits={canEdit}
          onUpdated={() => loadWeek(weekStart)}
        />
      </div>

      <TimeOffPanel
        weekStart={timesheet.week_start}
        weekEnd={timesheet.week_end}
        initialEntries={timesheet.time_off || []}
        canEdit={canEdit}
        onChanged={() => loadWeek(weekStart)}
      />
    </div>
  );
}

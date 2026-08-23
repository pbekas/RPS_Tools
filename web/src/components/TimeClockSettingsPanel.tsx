"use client";

import { useState } from "react";
import type { TimeClockSettings } from "@/lib/timeClockTypes";
import { TIME_CLOCK_TIMEZONES } from "@/lib/timeClockTimezones";

type Props = {
  initialSettings: TimeClockSettings;
};

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

export function TimeClockSettingsPanel({ initialSettings }: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [maxOpenHours, setMaxOpenHours] = useState(String(settings.max_open_hours));
  const [reminderEnabled, setReminderEnabled] = useState(settings.reminder_enabled);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [remindClockInEnabled, setRemindClockInEnabled] = useState(
    settings.remind_clock_in_enabled
  );
  const [remindClockInAfter, setRemindClockInAfter] = useState(
    settings.remind_clock_in_after
  );
  const [remindClockOutEnabled, setRemindClockOutEnabled] = useState(
    settings.remind_clock_out_enabled
  );
  const [remindClockOutAfter, setRemindClockOutAfter] = useState(
    settings.remind_clock_out_after
  );
  const [remindTimesheetEnabled, setRemindTimesheetEnabled] = useState(
    settings.remind_timesheet_enabled
  );
  const [remindTimesheetWeekday, setRemindTimesheetWeekday] = useState(
    String(settings.remind_timesheet_weekday)
  );
  const [remindTimesheetAfter, setRemindTimesheetAfter] = useState(
    settings.remind_timesheet_after
  );
  const [payPeriodAnchorDate, setPayPeriodAnchorDate] = useState(
    settings.pay_period_anchor_date
  );
  const [payPeriodLengthDays, setPayPeriodLengthDays] = useState(
    String(settings.pay_period_length_days)
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/time-clock/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_open_hours: Number(maxOpenHours),
          reminder_enabled: reminderEnabled,
          timezone,
          remind_clock_in_enabled: remindClockInEnabled,
          remind_clock_in_after: remindClockInAfter,
          remind_clock_out_enabled: remindClockOutEnabled,
          remind_clock_out_after: remindClockOutAfter,
          remind_timesheet_enabled: remindTimesheetEnabled,
          remind_timesheet_weekday: Number(remindTimesheetWeekday),
          remind_timesheet_after: remindTimesheetAfter,
          pay_period_anchor_date: payPeriodAnchorDate,
          pay_period_length_days: Number(payPeriodLengthDays),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSettings(data.settings);
      setMsg("Settings saved.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6 rounded-xl border border-line bg-white/90 p-5 shadow-sm">
      <div>
        <h2 className="font-display text-xl text-ink">Reminder settings</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Google Chat alerts use each team member&apos;s timezone (or the practice
          default). Time off days are skipped for forgot-to-punch reminders.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input
          type="checkbox"
          checked={reminderEnabled}
          onChange={(e) => setReminderEnabled(e.target.checked)}
        />
        Enable time clock reminders
      </label>

      <fieldset className="space-y-3 rounded-lg border border-line p-4" disabled={!reminderEnabled}>
        <legend className="px-1 text-sm font-semibold text-ink">Long open punch</legend>
        <label className="block text-sm">
          <span className="font-semibold text-ink-soft">Max open hours before reminder</span>
          <input
            type="number"
            min={1}
            max={24}
            step={0.5}
            value={maxOpenHours}
            onChange={(e) => setMaxOpenHours(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-line p-4" disabled={!reminderEnabled}>
        <legend className="px-1 text-sm font-semibold text-ink">Forgot to clock in</legend>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={remindClockInEnabled}
            onChange={(e) => setRemindClockInEnabled(e.target.checked)}
          />
          Remind on weekdays with no punch
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-ink-soft">After (local time)</span>
          <input
            type="time"
            value={remindClockInAfter}
            onChange={(e) => setRemindClockInAfter(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-line p-4" disabled={!reminderEnabled}>
        <legend className="px-1 text-sm font-semibold text-ink">Forgot to clock out</legend>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={remindClockOutEnabled}
            onChange={(e) => setRemindClockOutEnabled(e.target.checked)}
          />
          Remind when still clocked in at end of day
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-ink-soft">After (local time)</span>
          <input
            type="time"
            value={remindClockOutAfter}
            onChange={(e) => setRemindClockOutAfter(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-line p-4" disabled={!reminderEnabled}>
        <legend className="px-1 text-sm font-semibold text-ink">Timesheet not submitted</legend>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink">
          <input
            type="checkbox"
            checked={remindTimesheetEnabled}
            onChange={(e) => setRemindTimesheetEnabled(e.target.checked)}
          />
          Nudge when the weekly timesheet is still open
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-ink-soft">Weekday</span>
          <select
            value={remindTimesheetWeekday}
            onChange={(e) => setRemindTimesheetWeekday(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          >
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-ink-soft">After (local time)</span>
          <input
            type="time"
            value={remindTimesheetAfter}
            onChange={(e) => setRemindTimesheetAfter(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-ink">Pay period (Plane PDF)</legend>
        <p className="text-xs text-ink-soft">
          Biweekly pay periods are calculated from the anchor date. Reports can preset
          to the current or previous pay period for reimbursement exports.
        </p>
        <label className="block text-sm">
          <span className="font-semibold text-ink-soft">Anchor date (start of pay period #1)</span>
          <input
            type="date"
            value={payPeriodAnchorDate}
            onChange={(e) => setPayPeriodAnchorDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
        <label className="block text-sm">
          <span className="font-semibold text-ink-soft">Length (days)</span>
          <input
            type="number"
            min={7}
            max={31}
            value={payPeriodLengthDays}
            onChange={(e) => setPayPeriodLengthDays(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
      </fieldset>

      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Practice default timezone</span>
        <p className="text-xs text-ink-soft">
          Used for manager reports and as the fallback when a user has not set a timezone.
        </p>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2"
        >
          {TIME_CLOCK_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </label>

      {msg ? <p className="text-sm text-ink">{msg}</p> : null}

      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save settings"}
      </button>

      {settings.updated_at ? (
        <p className="text-xs text-ink-soft">
          Last updated {new Date(settings.updated_at).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

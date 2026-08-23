"use client";

import { useState } from "react";
import type { TimeClockSettings } from "@/lib/timeClockTypes";

type Props = {
  initialSettings: TimeClockSettings;
};

const TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
];

export function TimeClockSettingsPanel({ initialSettings }: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [maxOpenHours, setMaxOpenHours] = useState(String(settings.max_open_hours));
  const [reminderEnabled, setReminderEnabled] = useState(settings.reminder_enabled);
  const [timezone, setTimezone] = useState(settings.timezone);
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
    <div className="max-w-xl space-y-4 rounded-xl border border-line bg-white/90 p-5 shadow-sm">
      <div>
        <h2 className="font-display text-xl text-ink">Reminder settings</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Send a Google Chat alert when someone stays clocked in longer than the
          configured limit without clocking out.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm font-semibold text-ink">
        <input
          type="checkbox"
          checked={reminderEnabled}
          onChange={(e) => setReminderEnabled(e.target.checked)}
        />
        Enable clock-out reminders
      </label>

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

      <label className="block text-sm">
        <span className="font-semibold text-ink-soft">Timezone</span>
        <select
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line px-3 py-2"
        >
          {TIMEZONES.map((tz) => (
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

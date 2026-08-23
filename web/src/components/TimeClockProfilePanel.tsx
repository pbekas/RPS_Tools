"use client";

import { useState } from "react";
import type { TimeClockProfile } from "@/lib/timeClockTypes";
import { TIME_CLOCK_TIMEZONES } from "@/lib/timeClockTimezones";

type Props = {
  initialProfile: TimeClockProfile;
};

export function TimeClockProfilePanel({ initialProfile }: Props) {
  const [profile, setProfile] = useState(initialProfile);
  const [timezone, setTimezone] = useState(profile.effective_timezone);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function save() {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/time-clock/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setProfile(data.profile);
      setTimezone(data.profile.effective_timezone);
      setMsg("Timezone saved. Punch and timesheet dates use your local time.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-white/90 p-4 shadow-sm">
      <h2 className="font-display text-lg text-ink">Your timezone</h2>
      <p className="mt-1 text-sm text-ink-soft">
        Remote team members can set their local timezone. Managers still see
        reports in the practice default timezone.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block min-w-[220px] flex-1 text-sm">
          <span className="font-semibold text-ink-soft">Timezone</span>
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
        <button
          type="button"
          onClick={save}
          disabled={busy || timezone === profile.effective_timezone}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save timezone"}
        </button>
      </div>
      {msg ? <p className="mt-2 text-sm text-ink">{msg}</p> : null}
    </div>
  );
}

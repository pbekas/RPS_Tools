"use client";

import { useState } from "react";
import type { TimeClockSettings, WeeklyTimesheet } from "@/lib/timeClockTypes";
import { TimeClockEntries } from "@/components/TimeClockEntries";
import { formatHours } from "@/lib/timeClockFormat";

type Props = {
  initialTimesheets: WeeklyTimesheet[];
  settings: TimeClockSettings;
};

export function TimesheetApprovals({ initialTimesheets, settings }: Props) {
  const [timesheets, setTimesheets] = useState(initialTimesheets);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function review(sheet: WeeklyTimesheet, approve: boolean) {
    const key = `${sheet.user_email}:${sheet.week_start}`;
    setBusyId(key);
    setMsg("");
    try {
      const res = await fetch("/api/time-clock/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: approve ? "approve" : "reject",
          user_email: sheet.user_email,
          week_start: sheet.week_start,
          review_notes: notes[key] || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setTimesheets((prev) =>
        prev.filter(
          (t) => !(t.user_email === sheet.user_email && t.week_start === sheet.week_start)
        )
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!timesheets.length) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-sm text-ink-soft">
        No timesheets waiting for approval.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {msg ? <p className="text-sm text-fail">{msg}</p> : null}
      {timesheets.map((sheet) => {
        const key = `${sheet.user_email}:${sheet.week_start}`;
        return (
          <div key={key} className="rounded-xl border border-line bg-white/90 p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">
                  {sheet.user_name || sheet.user_email}
                </p>
                <p className="text-sm text-ink-soft">
                  Week of {sheet.week_start} – {sheet.week_end}
                </p>
              </div>
              <p className="text-lg font-semibold text-accent">
                {formatHours(sheet.total_hours)}
              </p>
            </div>

            <div className="mt-4">
              <TimeClockEntries
                entries={sheet.entries || []}
                settings={settings}
                canRequestEdits={false}
                canManagePunches
                onUpdated={async () => {
                  const params = new URLSearchParams({
                    week_start: sheet.week_start,
                    userEmail: sheet.user_email,
                  });
                  const res = await fetch(`/api/time-clock/timesheets?${params}`);
                  const data = await res.json();
                  if (res.ok && data.timesheet) {
                    setTimesheets((prev) =>
                      prev.map((row) =>
                        row.user_email === sheet.user_email &&
                        row.week_start === sheet.week_start
                          ? data.timesheet
                          : row
                      )
                    );
                  }
                }}
              />
            </div>

            <textarea
              value={notes[key] || ""}
              onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
              placeholder="Optional review note (required context for rejections)"
              rows={2}
              className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busyId === key}
                onClick={() => review(sheet, true)}
                className="rounded-lg bg-pass px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Approve week
              </button>
              <button
                type="button"
                disabled={busyId === key}
                onClick={() => review(sheet, false)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fail disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

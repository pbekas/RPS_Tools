"use client";

import { useCallback, useState } from "react";
import type { PunchStatus, TimeClockSettings, TimeEntry } from "@/lib/timeClockTypes";
import { TimeClockBar } from "@/components/TimeClockBar";
import { TimeClockEntries } from "@/components/TimeClockEntries";

type Props = {
  initialStatus: PunchStatus;
  initialEntries: TimeEntry[];
  settings: TimeClockSettings;
  displayTimezone: string;
  from: string;
  to: string;
};

export function TimeClockHome({
  initialStatus,
  initialEntries,
  settings,
  displayTimezone,
  from,
  to,
}: Props) {
  const [entries, setEntries] = useState(initialEntries);

  const refreshEntries = useCallback(async () => {
    const params = new URLSearchParams({ from, to, limit: "50" });
    const res = await fetch(`/api/time-clock/entries?${params}`);
    const data = await res.json();
    if (res.ok) setEntries(data.entries || []);
  }, [from, to]);

  return (
    <div className="space-y-6">
      <TimeClockBar
        initialStatus={initialStatus}
        settings={{ ...settings, timezone: displayTimezone }}
        onPunch={refreshEntries}
      />
      <div>
        <h2 className="mb-3 font-display text-xl text-ink">Today</h2>
        <p className="mb-2 text-xs text-ink-soft">Times shown in {displayTimezone}</p>
        <TimeClockEntries
          entries={entries}
          settings={{ ...settings, timezone: displayTimezone }}
          onUpdated={refreshEntries}
        />
      </div>
    </div>
  );
}

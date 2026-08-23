"use client";

import { useState } from "react";
import type { TimeClockSettings, TimeEntryEditRequest, WeeklyTimesheet } from "@/lib/timeClockTypes";
import { EditApprovals } from "@/components/EditApprovals";
import { TimesheetApprovals } from "@/components/TimesheetApprovals";

type Props = {
  initialEditRequests: TimeEntryEditRequest[];
  initialTimesheets: WeeklyTimesheet[];
  settings: TimeClockSettings;
};

export function ApprovalsHub({
  initialEditRequests,
  initialTimesheets,
  settings,
}: Props) {
  const [tab, setTab] = useState<"timesheets" | "edits">(
    initialTimesheets.length ? "timesheets" : "edits"
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-xl border border-line bg-paper/80 p-1">
        <button
          type="button"
          onClick={() => setTab("timesheets")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "timesheets" ? "bg-white text-accent shadow-sm" : "text-ink-soft"
          }`}
        >
          Weekly timesheets
          {initialTimesheets.length ? ` (${initialTimesheets.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setTab("edits")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "edits" ? "bg-white text-accent shadow-sm" : "text-ink-soft"
          }`}
        >
          Time edits
          {initialEditRequests.length ? ` (${initialEditRequests.length})` : ""}
        </button>
      </div>

      {tab === "timesheets" ? (
        <TimesheetApprovals initialTimesheets={initialTimesheets} settings={settings} />
      ) : (
        <EditApprovals initialRequests={initialEditRequests} settings={settings} />
      )}
    </div>
  );
}

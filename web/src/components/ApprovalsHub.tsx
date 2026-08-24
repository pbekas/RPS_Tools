"use client";

import { useState } from "react";
import type {
  TimeClockSettings,
  TimeEntryEditRequest,
  TimeOffEntry,
  WeeklyTimesheet,
} from "@/lib/timeClockTypes";
import { EditApprovals } from "@/components/EditApprovals";
import { TimesheetApprovals } from "@/components/TimesheetApprovals";
import { TimeOffApprovals } from "@/components/TimeOffApprovals";

type Props = {
  initialEditRequests: TimeEntryEditRequest[];
  initialTimesheets: WeeklyTimesheet[];
  initialTimeOffRequests: TimeOffEntry[];
  settings: TimeClockSettings;
};

export function ApprovalsHub({
  initialEditRequests,
  initialTimesheets,
  initialTimeOffRequests,
  settings,
}: Props) {
  const [tab, setTab] = useState<"timesheets" | "edits" | "timeoff">(
    initialTimeOffRequests.length
      ? "timeoff"
      : initialTimesheets.length
        ? "timesheets"
        : "edits"
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
        <button
          type="button"
          onClick={() => setTab("timeoff")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            tab === "timeoff" ? "bg-white text-accent shadow-sm" : "text-ink-soft"
          }`}
        >
          Time off
          {initialTimeOffRequests.length ? ` (${initialTimeOffRequests.length})` : ""}
        </button>
      </div>

      {tab === "timesheets" ? (
        <TimesheetApprovals initialTimesheets={initialTimesheets} settings={settings} />
      ) : tab === "edits" ? (
        <EditApprovals initialRequests={initialEditRequests} settings={settings} />
      ) : (
        <TimeOffApprovals initialRequests={initialTimeOffRequests} />
      )}
    </div>
  );
}

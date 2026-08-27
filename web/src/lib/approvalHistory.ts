import "server-only";

import { formatHours, formatYmd, localYmd } from "@/lib/timeClockFormat";
import {
  listEditRequests,
  listReviewedTimesheets,
} from "@/lib/timeClockDb";
import { listReviewedTimeOff } from "@/lib/timeOffDb";
import {
  TIME_OFF_KIND_LABELS,
  type ApprovalHistoryItem,
  type ApprovalHistoryType,
  type TimeOffStatus,
  type TimesheetStatus,
} from "@/lib/timeClockTypes";

export type ApprovalHistoryFilters = {
  type?: "all" | ApprovalHistoryType;
  personEmail?: string | null;
  status?: "all" | "approved" | "denied";
  from: string;
  to: string;
  userEmails?: string[] | null;
  timezone: string;
  limit?: number;
};

function outcome(status: string): "approved" | "denied" {
  return status === "approved" ? "approved" : "denied";
}

function timesheetStatuses(
  status: ApprovalHistoryFilters["status"]
): TimesheetStatus[] {
  if (status === "approved") return ["approved"];
  if (status === "denied") return ["rejected"];
  return ["approved", "rejected"];
}

function editStatuses(status: ApprovalHistoryFilters["status"]): string[] {
  if (status === "approved") return ["approved"];
  if (status === "denied") return ["rejected"];
  return ["approved", "rejected"];
}

function timeOffStatuses(
  status: ApprovalHistoryFilters["status"]
): TimeOffStatus[] {
  if (status === "approved") return ["approved"];
  if (status === "denied") return ["denied"];
  return ["approved", "denied"];
}

export async function listApprovalHistory(
  filters: ApprovalHistoryFilters
): Promise<ApprovalHistoryItem[]> {
  const type = filters.type || "all";
  const person = filters.personEmail?.trim().toLowerCase() || null;
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);
  const items: ApprovalHistoryItem[] = [];

  const loadTimesheets = type === "all" || type === "timesheet";
  const loadEdits = type === "all" || type === "edit";
  const loadTimeOff = type === "all" || type === "timeoff";

  const [timesheets, edits, timeOff] = await Promise.all([
    loadTimesheets
      ? listReviewedTimesheets({
          userEmails: filters.userEmails,
          userEmail: person,
          statuses: timesheetStatuses(filters.status),
          from: filters.from,
          to: filters.to,
          limit,
        })
      : Promise.resolve([]),
    loadEdits
      ? listEditRequests({
          statuses: editStatuses(filters.status),
          userEmails: filters.userEmails,
          userEmail: person,
          from: filters.from,
          to: filters.to,
          limit,
        })
      : Promise.resolve([]),
    loadTimeOff
      ? listReviewedTimeOff({
          from: filters.from,
          to: filters.to,
          userEmails: filters.userEmails,
          userEmail: person,
          statuses: timeOffStatuses(filters.status),
          limit,
        })
      : Promise.resolve([]),
  ]);

  for (const sheet of timesheets) {
    items.push({
      id: `timesheet:${sheet.user_email}:${sheet.week_start}`,
      type: "timesheet",
      person_email: sheet.user_email,
      person_name: sheet.user_name || sheet.user_email,
      status: outcome(sheet.status),
      item_date: sheet.week_start,
      reviewed_at: sheet.reviewed_at,
      reviewer_name: sheet.reviewer_name,
      summary: `Week of ${formatYmd(sheet.week_start)} · ${formatHours(sheet.total_hours)}`,
      review_notes: sheet.review_notes || "",
    });
  }

  for (const request of edits) {
    const itemDate = localYmd(request.original_clock_in, filters.timezone);
    items.push({
      id: `edit:${request.id}`,
      type: "edit",
      person_email: request.requested_by,
      person_name: request.requester_name || request.requested_by,
      status: outcome(request.status),
      item_date: itemDate,
      reviewed_at: request.reviewed_at,
      reviewer_name: request.reviewer_name,
      summary: `Punch on ${formatYmd(itemDate)}${
        request.reason ? ` · ${request.reason}` : ""
      }`,
      review_notes: request.review_notes || "",
    });
  }

  for (const entry of timeOff) {
    items.push({
      id: `timeoff:${entry.id}`,
      type: "timeoff",
      person_email: entry.user_email,
      person_name: entry.user_name || entry.user_email,
      status: outcome(entry.status),
      item_date: entry.entry_date,
      reviewed_at: entry.reviewed_at,
      reviewer_name: entry.reviewer_name,
      summary: `${TIME_OFF_KIND_LABELS[entry.kind] || entry.kind} · ${formatYmd(
        entry.entry_date
      )} · ${formatHours(entry.hours)}`,
      review_notes: entry.review_notes || "",
    });
  }

  items.sort((a, b) => {
    const reviewed = (b.reviewed_at || "").localeCompare(a.reviewed_at || "");
    if (reviewed) return reviewed;
    return b.item_date.localeCompare(a.item_date);
  });

  return items.slice(0, limit);
}

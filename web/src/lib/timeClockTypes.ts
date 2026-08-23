export type TimeEntry = {
  id: string;
  user_email: string;
  user_name?: string;
  clock_in: string;
  clock_out: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type TimeEntryEditRequest = {
  id: string;
  entry_id: string;
  requested_by: string;
  requester_name?: string;
  original_clock_in: string;
  original_clock_out: string | null;
  original_notes: string;
  proposed_clock_in: string;
  proposed_clock_out: string | null;
  proposed_notes: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewer_name?: string;
  reviewed_at: string | null;
  review_notes: string;
  created_at: string;
  updated_at: string;
  entry?: TimeEntry;
};

export type TimeOffKind = "pto" | "sick" | "holiday" | "unpaid";

/** Kinds that deduct from the annual time-off bank. */
export const BANK_DEDUCTING_KINDS: TimeOffKind[] = ["pto", "sick"];

export function deductsFromTimeOffBank(kind: TimeOffKind): boolean {
  return BANK_DEDUCTING_KINDS.includes(kind);
}

export type TimeOffEntry = {
  id: string;
  user_email: string;
  entry_date: string;
  kind: TimeOffKind;
  hours: number;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TimeOffBank = {
  user_email: string;
  user_name?: string;
  year: number;
  allotted_hours: number;
  used_hours: number;
  remaining_hours: number;
  is_default_allotment: boolean;
  notes: string;
};

export type TimeClockSettings = {
  id: string;
  max_open_hours: number;
  reminder_enabled: boolean;
  timezone: string;
  remind_clock_in_enabled: boolean;
  remind_clock_in_after: string;
  remind_clock_out_enabled: boolean;
  remind_clock_out_after: string;
  remind_timesheet_enabled: boolean;
  remind_timesheet_weekday: number;
  remind_timesheet_after: string;
  pay_period_anchor_date: string;
  pay_period_length_days: number;
  default_annual_pto_hours: number;
  updated_at: string;
  updated_by: string | null;
};

export type TimeClockProfile = {
  email: string;
  name: string;
  timezone: string | null;
  effective_timezone: string;
};

export type PunchStatus = {
  is_clocked_in: boolean;
  open_entry: TimeEntry | null;
  elapsed_seconds: number | null;
};

export type WeeklyHoursRow = {
  week_start: string;
  week_end: string;
  hours: number;
  entry_count: number;
};

export type PayPeriodInfo = {
  period_start: string;
  period_end: string;
  period_number: number;
};

export type TimeClockReportApproval = {
  status: "approved" | "submitted" | "open" | "rejected" | "none";
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  weeks: Array<{
    week_start: string;
    week_end: string;
    status: TimesheetStatus;
    reviewed_by_name?: string;
    reviewed_at?: string | null;
  }>;
};

export type TimeClockReport = {
  from: string;
  to: string;
  timezone: string;
  total_hours: number;
  weekly_breakdown: WeeklyHoursRow[];
  entries: TimeEntry[];
  pay_period?: PayPeriodInfo;
  by_user?: Array<{
    user_email: string;
    user_name: string;
    total_hours: number;
    weekly_breakdown: WeeklyHoursRow[];
    entries: TimeEntry[];
    approval?: TimeClockReportApproval;
  }>;
};

export type TimesheetStatus = "open" | "submitted" | "approved" | "rejected";

export type WeeklyTimesheet = {
  id: string;
  user_email: string;
  user_name?: string;
  week_start: string;
  week_end: string;
  status: TimesheetStatus;
  total_hours: number;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewer_name?: string;
  reviewed_at: string | null;
  review_notes: string;
  created_at: string;
  updated_at: string;
  entries?: TimeEntry[];
  has_open_entry?: boolean;
  has_pending_edits?: boolean;
  time_off?: TimeOffEntry[];
  time_off_hours?: number;
};

export type TeamMemberLiveStatus =
  | "clocked_in"
  | "on_break"
  | "clocked_out"
  | "not_started"
  | "forgot_to_punch"
  | "on_pto";

export type TeamLiveStatusRow = {
  user_email: string;
  user_name: string;
  timezone: string;
  local_time: string;
  status: TeamMemberLiveStatus;
  status_label: string;
  today_hours: number;
  last_punch_at: string | null;
  last_punch_label: string | null;
  clocked_in_since: string | null;
  timesheet_status: TimesheetStatus | null;
  team_id: string | null;
  team_name: string | null;
  time_off_kind: TimeOffKind | null;
  time_off_hours: number | null;
  time_off_bank_remaining: number;
  time_off_bank_used: number;
  time_off_bank_allotted: number;
};

export type TimeClockTeam = {
  id: string;
  name: string;
  slug: string;
  supervisor_email: string | null;
  supervisor_name?: string;
  active: boolean;
  member_count: number;
  created_at: string;
  updated_at: string;
  members?: Array<{ user_email: string; user_name: string; role: string }>;
};

export type TimeClockAuditEntry = {
  id: string;
  actor_email: string | null;
  actor_name?: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  subject_email: string | null;
  subject_name?: string;
  team_id: string | null;
  team_name?: string;
  before_data: Record<string, unknown>;
  after_data: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
};

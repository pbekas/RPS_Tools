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

export type TimeClockSettings = {
  id: string;
  max_open_hours: number;
  reminder_enabled: boolean;
  timezone: string;
  updated_at: string;
  updated_by: string | null;
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

export type TimeClockReport = {
  from: string;
  to: string;
  timezone: string;
  total_hours: number;
  weekly_breakdown: WeeklyHoursRow[];
  entries: TimeEntry[];
  by_user?: Array<{
    user_email: string;
    user_name: string;
    total_hours: number;
    weekly_breakdown: WeeklyHoursRow[];
    entries: TimeEntry[];
  }>;
};

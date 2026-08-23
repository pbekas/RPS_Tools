import "server-only";

import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";
import { logTimeClockAudit } from "@/lib/timeClockAudit";
import { getTeamIdForUser } from "@/lib/timeClockTeamsDb";
import type {
  PunchStatus,
  TeamLiveStatusRow,
  TeamMemberLiveStatus,
  TimeClockReport,
  TimeClockSettings,
  TimeEntry,
  TimeEntryEditRequest,
  WeeklyHoursRow,
  WeeklyTimesheet,
} from "@/lib/timeClockTypes";
import {
  addDaysIso,
  localHourAndWeekday,
  startOfDayIso,
  weekRangeFromStart,
  weekStartDate,
} from "@/lib/timeClockFormat";

const usePostgres = () => process.env.DB_BACKEND?.trim().toLowerCase() === "postgres";

function requirePostgres() {
  if (!usePostgres()) {
    throw new Error("Time clock module requires DB_BACKEND=postgres");
  }
}

function serializeRow<T>(row: QueryResultRow): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === "string" && key.endsWith("_hours")) {
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

function entryFromRow(row: QueryResultRow): TimeEntry {
  return serializeRow<TimeEntry>(row);
}

function editRequestFromRow(row: QueryResultRow): TimeEntryEditRequest {
  return serializeRow<TimeEntryEditRequest>(row);
}

function durationSeconds(clockIn: string, clockOut: string | null, now = Date.now()): number {
  const start = new Date(clockIn).getTime();
  const end = clockOut ? new Date(clockOut).getTime() : now;
  return Math.max(0, Math.floor((end - start) / 1000));
}

export function entryHours(entry: TimeEntry, now = Date.now()): number {
  return durationSeconds(entry.clock_in, entry.clock_out, now) / 3600;
}

async function auditSubject(
  subjectEmail: string,
  input: Omit<Parameters<typeof logTimeClockAudit>[0], "subjectEmail" | "teamId"> & {
    teamId?: string | null;
  }
) {
  const teamId =
    input.teamId === undefined ? await getTeamIdForUser(subjectEmail) : input.teamId;
  await logTimeClockAudit({
    ...input,
    subjectEmail,
    teamId: teamId || null,
  });
}

export async function getTimeClockSettings(): Promise<TimeClockSettings> {
  requirePostgres();
  const rows = await query(
    `SELECT id, max_open_hours::float8 AS max_open_hours, reminder_enabled, timezone,
            updated_at, updated_by
     FROM time_clock_settings
     WHERE id = 'default'`
  );
  if (!rows[0]) {
    throw new Error("Time clock settings not initialized");
  }
  return serializeRow<TimeClockSettings>(rows[0]);
}

export async function updateTimeClockSettings(
  patch: Partial<Pick<TimeClockSettings, "max_open_hours" | "reminder_enabled" | "timezone">>,
  updatedBy: string
): Promise<TimeClockSettings> {
  requirePostgres();
  const current = await getTimeClockSettings();
  const maxOpenHours = patch.max_open_hours ?? current.max_open_hours;
  const reminderEnabled = patch.reminder_enabled ?? current.reminder_enabled;
  const timezone = patch.timezone ?? current.timezone;
  const rows = await query(
    `UPDATE time_clock_settings
     SET max_open_hours = $1,
         reminder_enabled = $2,
         timezone = $3,
         updated_at = now(),
         updated_by = $4
     WHERE id = 'default'
     RETURNING id, max_open_hours::float8 AS max_open_hours, reminder_enabled, timezone,
               updated_at, updated_by`,
    [maxOpenHours, reminderEnabled, timezone, updatedBy.toLowerCase()]
  );
  const updated = serializeRow<TimeClockSettings>(rows[0]);
  await logTimeClockAudit({
    actorEmail: updatedBy,
    action: "settings.updated",
    entityType: "settings",
    entityId: "default",
    before: {
      max_open_hours: current.max_open_hours,
      reminder_enabled: current.reminder_enabled,
      timezone: current.timezone,
    },
    after: {
      max_open_hours: updated.max_open_hours,
      reminder_enabled: updated.reminder_enabled,
      timezone: updated.timezone,
    },
  });
  return updated;
}

export async function getOpenEntry(userEmail: string): Promise<TimeEntry | null> {
  requirePostgres();
  const rows = await query(
    `SELECT e.id, e.user_email, u.name AS user_name, e.clock_in, e.clock_out, e.notes,
            e.created_at, e.updated_at
     FROM time_entries e
     JOIN users u ON u.email = e.user_email
     WHERE e.user_email = $1 AND e.clock_out IS NULL
     ORDER BY e.clock_in DESC
     LIMIT 1`,
    [userEmail.toLowerCase()]
  );
  return rows[0] ? entryFromRow(rows[0]) : null;
}

export async function getPunchStatus(userEmail: string): Promise<PunchStatus> {
  const openEntry = await getOpenEntry(userEmail);
  if (!openEntry) {
    return { is_clocked_in: false, open_entry: null, elapsed_seconds: null };
  }
  return {
    is_clocked_in: true,
    open_entry: openEntry,
    elapsed_seconds: durationSeconds(openEntry.clock_in, null),
  };
}

export async function clockIn(userEmail: string): Promise<TimeEntry> {
  requirePostgres();
  const email = userEmail.toLowerCase();
  const open = await getOpenEntry(email);
  if (open) {
    throw new Error("Already clocked in");
  }
  const rows = await query(
    `INSERT INTO time_entries (user_email, clock_in)
     VALUES ($1, now())
     RETURNING id, user_email, clock_in, clock_out, notes, created_at, updated_at`,
    [email]
  );
  const entry = entryFromRow(rows[0]);
  const withName = await getTimeEntry(entry.id);
  const saved = withName || entry;
  await auditSubject(email, {
    actorEmail: email,
    action: "punch.clock_in",
    entityType: "time_entry",
    entityId: saved.id,
    after: { clock_in: saved.clock_in },
  });
  return saved;
}

export async function clockOut(userEmail: string, notes?: string): Promise<TimeEntry> {
  requirePostgres();
  const email = userEmail.toLowerCase();
  const open = await getOpenEntry(email);
  if (!open) {
    throw new Error("Not clocked in");
  }
  const rows = await query(
    `UPDATE time_entries
     SET clock_out = now(),
         notes = COALESCE(NULLIF($2, ''), notes),
         updated_at = now()
     WHERE id = $1
     RETURNING id, user_email, clock_in, clock_out, notes, created_at, updated_at`,
    [open.id, (notes || "").trim()]
  );
  const entry = entryFromRow(rows[0]);
  const withName = await getTimeEntry(entry.id);
  const saved = withName || entry;
  await auditSubject(email, {
    actorEmail: email,
    action: "punch.clock_out",
    entityType: "time_entry",
    entityId: saved.id,
    before: { clock_in: open.clock_in, clock_out: null },
    after: { clock_in: saved.clock_in, clock_out: saved.clock_out, notes: saved.notes },
  });
  return saved;
}

export async function getTimeEntry(id: string): Promise<TimeEntry | null> {
  requirePostgres();
  const rows = await query(
    `SELECT e.id, e.user_email, u.name AS user_name, e.clock_in, e.clock_out, e.notes,
            e.created_at, e.updated_at
     FROM time_entries e
     JOIN users u ON u.email = e.user_email
     WHERE e.id = $1`,
    [id]
  );
  return rows[0] ? entryFromRow(rows[0]) : null;
}

export type ListTimeEntriesOpts = {
  userEmail?: string | null;
  userEmails?: string[] | null;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
};

export async function listTimeEntries(
  opts: ListTimeEntriesOpts = {}
): Promise<{ entries: TimeEntry[]; total: number }> {
  requirePostgres();
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.userEmail) {
    clauses.push(`e.user_email = $${idx++}`);
    params.push(opts.userEmail.toLowerCase());
  }
  if (opts.userEmails?.length) {
    clauses.push(`e.user_email = ANY($${idx++}::citext[])`);
    params.push(opts.userEmails.map((e) => e.toLowerCase()));
  }
  if (opts.from) {
    clauses.push(`e.clock_in >= $${idx++}::timestamptz`);
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push(`e.clock_in < $${idx++}::timestamptz`);
    params.push(opts.to);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const countRes = await query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM time_entries e ${where}`,
    params
  );
  const total = Number(countRes[0]?.total || 0);

  const rows = await query(
    `SELECT e.id, e.user_email, u.name AS user_name, e.clock_in, e.clock_out, e.notes,
            e.created_at, e.updated_at
     FROM time_entries e
     JOIN users u ON u.email = e.user_email
     ${where}
     ORDER BY e.clock_in DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );
  return { entries: rows.map(entryFromRow), total };
}

export async function updateEntryNotes(
  entryId: string,
  userEmail: string,
  notes: string,
  isAdmin: boolean
): Promise<TimeEntry> {
  requirePostgres();
  const entry = await getTimeEntry(entryId);
  if (!entry) throw new Error("Entry not found");
  if (!isAdmin && entry.user_email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new Error("Forbidden");
  }
  if (!isAdmin && (await isEntryWeekApproved(entry))) {
    throw new Error("This week has been approved and cannot be edited");
  }
  const sheet = await getTimesheet(entry.user_email, weekStartDate(new Date(entry.clock_in), (await getTimeClockSettings()).timezone));
  if (!isAdmin && sheet?.status === "submitted") {
    throw new Error("This week is submitted for approval and cannot be edited");
  }
  const rows = await query(
    `UPDATE time_entries
     SET notes = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, user_email, clock_in, clock_out, notes, created_at, updated_at`,
    [entryId, notes.trim()]
  );
  const updated = entryFromRow(rows[0]);
  const withName = await getTimeEntry(updated.id);
  const saved = withName || updated;
  await auditSubject(entry.user_email, {
    actorEmail: userEmail,
    action: "entry.notes_updated",
    entityType: "time_entry",
    entityId: saved.id,
    before: { notes: entry.notes },
    after: { notes: saved.notes },
  });
  return saved;
}

export async function createEditRequest(input: {
  entryId: string;
  requestedBy: string;
  proposedClockIn: string;
  proposedClockOut: string | null;
  proposedNotes: string;
  reason: string;
}): Promise<TimeEntryEditRequest> {
  requirePostgres();
  const entry = await getTimeEntry(input.entryId);
  if (!entry) throw new Error("Entry not found");
  if (entry.user_email.toLowerCase() !== input.requestedBy.toLowerCase()) {
    throw new Error("Forbidden");
  }
  if (entry.clock_out === null) {
    throw new Error("Close the entry before requesting a time edit");
  }
  if (await isEntryWeekApproved(entry)) {
    throw new Error("This week has been approved and cannot be edited");
  }

  const pending = await query<{ id: string }>(
    `SELECT id FROM time_entry_edit_requests
     WHERE entry_id = $1 AND status = 'pending'
     LIMIT 1`,
    [input.entryId]
  );
  if (pending[0]) {
    throw new Error("A pending edit request already exists for this entry");
  }

  const rows = await query(
    `INSERT INTO time_entry_edit_requests (
       entry_id, requested_by,
       original_clock_in, original_clock_out, original_notes,
       proposed_clock_in, proposed_clock_out, proposed_notes, reason
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.entryId,
      input.requestedBy.toLowerCase(),
      entry.clock_in,
      entry.clock_out,
      entry.notes,
      input.proposedClockIn,
      input.proposedClockOut,
      input.proposedNotes.trim(),
      input.reason.trim(),
    ]
  );
  const request = editRequestFromRow(rows[0]);
  await auditSubject(entry.user_email, {
    actorEmail: input.requestedBy,
    action: "entry.edit_requested",
    entityType: "edit_request",
    entityId: request.id,
    before: {
      clock_in: entry.clock_in,
      clock_out: entry.clock_out,
      notes: entry.notes,
    },
    after: {
      proposed_clock_in: input.proposedClockIn,
      proposed_clock_out: input.proposedClockOut,
      proposed_notes: input.proposedNotes,
      reason: input.reason,
    },
  });
  return request;
}

export async function listEditRequests(opts: {
  status?: string;
  userEmail?: string | null;
  userEmails?: string[] | null;
  limit?: number;
}): Promise<TimeEntryEditRequest[]> {
  requirePostgres();
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.status) {
    clauses.push(`r.status = $${idx++}`);
    params.push(opts.status);
  }
  if (opts.userEmail) {
    clauses.push(`r.requested_by = $${idx++}`);
    params.push(opts.userEmail.toLowerCase());
  }
  if (opts.userEmails?.length) {
    clauses.push(`r.requested_by = ANY($${idx++}::citext[])`);
    params.push(opts.userEmails.map((e) => e.toLowerCase()));
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  const rows = await query(
    `SELECT r.*,
            req.name AS requester_name,
            rev.name AS reviewer_name,
            e.id AS entry_id_ref,
            e.user_email AS entry_user_email,
            eu.name AS entry_user_name,
            e.clock_in AS entry_clock_in,
            e.clock_out AS entry_clock_out,
            e.notes AS entry_notes,
            e.created_at AS entry_created_at,
            e.updated_at AS entry_updated_at
     FROM time_entry_edit_requests r
     JOIN users req ON req.email = r.requested_by
     LEFT JOIN users rev ON rev.email = r.reviewed_by
     JOIN time_entries e ON e.id = r.entry_id
     JOIN users eu ON eu.email = e.user_email
     ${where}
     ORDER BY r.created_at DESC
     LIMIT $${idx}`,
    [...params, limit]
  );

  return rows.map((row) => {
    const request = editRequestFromRow(row);
    request.requester_name = String(row.requester_name || "");
    request.reviewer_name = row.reviewer_name ? String(row.reviewer_name) : undefined;
    request.entry = {
      id: String(row.entry_id_ref),
      user_email: String(row.entry_user_email),
      user_name: String(row.entry_user_name || ""),
      clock_in: new Date(row.entry_clock_in as Date).toISOString(),
      clock_out: row.entry_clock_out
        ? new Date(row.entry_clock_out as Date).toISOString()
        : null,
      notes: String(row.entry_notes || ""),
      created_at: new Date(row.entry_created_at as Date).toISOString(),
      updated_at: new Date(row.entry_updated_at as Date).toISOString(),
    };
    return request;
  });
}

export async function reviewEditRequest(input: {
  requestId: string;
  reviewerEmail: string;
  approve: boolean;
  reviewNotes?: string;
}): Promise<TimeEntryEditRequest> {
  requirePostgres();
  const rows = await query(
    `SELECT * FROM time_entry_edit_requests WHERE id = $1`,
    [input.requestId]
  );
  const row = rows[0];
  if (!row) throw new Error("Edit request not found");
  if (row.status !== "pending") throw new Error("Edit request is no longer pending");

  const status = input.approve ? "approved" : "rejected";

  if (input.approve) {
    await query(
      `UPDATE time_entries
       SET clock_in = $2,
           clock_out = $3,
           notes = $4,
           updated_at = now()
       WHERE id = $1`,
      [
        row.entry_id,
        row.proposed_clock_in,
        row.proposed_clock_out,
        row.proposed_notes,
      ]
    );
  }

  await query(
    `UPDATE time_entry_edit_requests
     SET status = $2,
         reviewed_by = $3,
         reviewed_at = now(),
         review_notes = $4,
         updated_at = now()
     WHERE id = $1`,
    [
      input.requestId,
      status,
      input.reviewerEmail.toLowerCase(),
      (input.reviewNotes || "").trim(),
    ]
  );

  const requests = await listEditRequests({ limit: 200 });
  const found = requests.find((r) => r.id === input.requestId);
  if (found) {
    await auditSubject(String(row.requested_by), {
      actorEmail: input.reviewerEmail,
      action: input.approve ? "entry.edit_approved" : "entry.edit_rejected",
      entityType: "edit_request",
      entityId: input.requestId,
      before: {
        clock_in: row.original_clock_in,
        clock_out: row.original_clock_out,
        notes: row.original_notes,
      },
      after: input.approve
        ? {
            clock_in: row.proposed_clock_in,
            clock_out: row.proposed_clock_out,
            notes: row.proposed_notes,
          }
        : { review_notes: input.reviewNotes || "" },
    });
    return found;
  }

  throw new Error("Updated edit request could not be loaded");
}

function buildWeeklyBreakdown(
  entries: TimeEntry[],
  timezone: string,
  from: Date,
  to: Date
): WeeklyHoursRow[] {
  const weeks = new Map<string, WeeklyHoursRow>();

  for (const entry of entries) {
    const hours = entryHours(entry);
    const weekStart = weekStartInTimezone(entry.clock_in, timezone);
    const key = weekStart.toISOString().slice(0, 10);
    const existing = weeks.get(key);
    if (existing) {
      existing.hours += hours;
      existing.entry_count += 1;
    } else {
      const start = new Date(weekStart);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      weeks.set(key, {
        week_start: start.toISOString().slice(0, 10),
        week_end: end.toISOString().slice(0, 10),
        hours,
        entry_count: 1,
      });
    }
  }

  return Array.from(weeks.values()).sort((a, b) =>
    a.week_start.localeCompare(b.week_start)
  );
}

function weekStartInTimezone(iso: string, timezone: string): Date {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
  const parts = formatter.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const local = new Date(Date.UTC(year, month - 1, day));
  const weekday = local.getUTCDay();
  const diff = weekday === 0 ? -6 : 1 - weekday;
  local.setUTCDate(local.getUTCDate() + diff);
  return local;
}

export async function buildTimeClockReport(opts: {
  from: string;
  to: string;
  userEmail?: string | null;
  userEmails?: string[] | null;
  team?: boolean;
}): Promise<TimeClockReport> {
  requirePostgres();
  const settings = await getTimeClockSettings();
  const timezone = settings.timezone;

  if (opts.team) {
    const { entries } = await listTimeEntries({
      from: opts.from,
      to: opts.to,
      userEmails: opts.userEmails,
      limit: 5000,
    });
    const byUser = new Map<string, TimeEntry[]>();
    for (const entry of entries) {
      const key = entry.user_email.toLowerCase();
      const list = byUser.get(key) || [];
      list.push(entry);
      byUser.set(key, list);
    }

    const users = Array.from(byUser.entries()).map(([email, userEntries]) => {
      const totalHours = userEntries.reduce((sum, e) => sum + entryHours(e), 0);
      return {
        user_email: email,
        user_name: userEntries[0]?.user_name || email,
        total_hours: totalHours,
        weekly_breakdown: buildWeeklyBreakdown(
          userEntries,
          timezone,
          new Date(opts.from),
          new Date(opts.to)
        ),
        entries: userEntries,
      };
    });

    const totalHours = users.reduce((sum, u) => sum + u.total_hours, 0);
    const allEntries = entries;
    return {
      from: opts.from,
      to: opts.to,
      timezone,
      total_hours: totalHours,
      weekly_breakdown: buildWeeklyBreakdown(
        allEntries,
        timezone,
        new Date(opts.from),
        new Date(opts.to)
      ),
      entries: allEntries,
      by_user: users.sort((a, b) => a.user_name.localeCompare(b.user_name)),
    };
  }

  const { entries } = await listTimeEntries({
    userEmail: opts.userEmail || undefined,
    from: opts.from,
    to: opts.to,
    limit: 5000,
  });
  const totalHours = entries.reduce((sum, e) => sum + entryHours(e), 0);
  return {
    from: opts.from,
    timezone,
    to: opts.to,
    total_hours: totalHours,
    weekly_breakdown: buildWeeklyBreakdown(
      entries,
      timezone,
      new Date(opts.from),
      new Date(opts.to)
    ),
    entries,
  };
}

export async function listTeamDaySummary(opts: {
  from: string;
  to: string;
  userEmails?: string[] | null;
}): Promise<
  Array<{
    date: string;
    user_email: string;
    user_name: string;
    total_hours: number;
    entry_count: number;
    is_clocked_in: boolean;
  }>
> {
  requirePostgres();
  const settings = await getTimeClockSettings();
  const emailFilter = opts.userEmails?.length
    ? `AND e.user_email = ANY($4::citext[])`
    : "";
  const params: unknown[] = [opts.from, opts.to, settings.timezone];
  if (opts.userEmails?.length) {
    params.push(opts.userEmails.map((e) => e.toLowerCase()));
  }
  const rows = await query(
    `SELECT
       to_char((e.clock_in AT TIME ZONE $3)::date, 'YYYY-MM-DD') AS day,
       e.user_email,
       u.name AS user_name,
       SUM(
         EXTRACT(EPOCH FROM (
           COALESCE(e.clock_out, now()) - e.clock_in
         )) / 3600.0
       )::float8 AS total_hours,
       COUNT(*)::int AS entry_count,
       BOOL_OR(e.clock_out IS NULL) AS is_clocked_in
     FROM time_entries e
     JOIN users u ON u.email = e.user_email
     WHERE e.clock_in >= $1::timestamptz
       AND e.clock_in < $2::timestamptz
       ${emailFilter}
     GROUP BY day, e.user_email, u.name
     ORDER BY day DESC, u.name ASC`,
    params
  );
  return rows.map((row) => ({
    date: String(row.day),
    user_email: String(row.user_email),
    user_name: String(row.user_name || row.user_email),
    total_hours: Number(row.total_hours || 0),
    entry_count: Number(row.entry_count || 0),
    is_clocked_in: Boolean(row.is_clocked_in),
  }));
}

export async function listUsersWithTimeClockAccess(): Promise<
  Array<{ email: string; name: string; role: string }>
> {
  requirePostgres();
  const rows = await query(
    `SELECT email, name, role
     FROM users
     WHERE active = true
       AND (
         role IN ('Admin', 'Supervisor')
         OR EXISTS (
           SELECT 1 FROM unnest(COALESCE(modules, ARRAY[]::text[])) AS m(mod)
           WHERE m.mod = 'time_clock'
         )
       )
     ORDER BY name ASC, email ASC`
  );
  return rows.map((row) => ({
    email: String(row.email),
    name: String(row.name || row.email),
    role: String(row.role || "Agent"),
  }));
}

function dateToYmd(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function timesheetFromRow(row: QueryResultRow, timezone: string): WeeklyTimesheet {
  const weekStart = dateToYmd(row.week_start);
  const { week_end } = weekRangeFromStart(weekStart, timezone);
  const sheet = serializeRow<WeeklyTimesheet>({
    ...row,
    week_start: weekStart,
    week_end,
    total_hours: Number(row.total_hours || 0),
  });
  if (row.user_name) sheet.user_name = String(row.user_name);
  if (row.reviewer_name) sheet.reviewer_name = String(row.reviewer_name);
  return sheet;
}

export async function getTimesheet(
  userEmail: string,
  weekStart: string
): Promise<WeeklyTimesheet | null> {
  requirePostgres();
  const settings = await getTimeClockSettings();
  const rows = await query(
    `SELECT t.*, u.name AS user_name, rev.name AS reviewer_name
     FROM time_timesheets t
     JOIN users u ON u.email = t.user_email
     LEFT JOIN users rev ON rev.email = t.reviewed_by
     WHERE t.user_email = $1 AND t.week_start = $2::date`,
    [userEmail.toLowerCase(), weekStart]
  );
  return rows[0] ? timesheetFromRow(rows[0], settings.timezone) : null;
}

export async function isEntryWeekApproved(entry: TimeEntry): Promise<boolean> {
  const settings = await getTimeClockSettings();
  const weekStart = weekStartDate(new Date(entry.clock_in), settings.timezone);
  const sheet = await getTimesheet(entry.user_email, weekStart);
  return sheet?.status === "approved";
}

async function ensureTimesheetRow(
  userEmail: string,
  weekStart: string
): Promise<WeeklyTimesheet> {
  const existing = await getTimesheet(userEmail, weekStart);
  if (existing) return existing;
  const rows = await query(
    `INSERT INTO time_timesheets (user_email, week_start, status, total_hours)
     VALUES ($1, $2::date, 'open', 0)
     ON CONFLICT (user_email, week_start) DO NOTHING
     RETURNING *`,
    [userEmail.toLowerCase(), weekStart]
  );
  if (rows[0]) {
    const settings = await getTimeClockSettings();
    return timesheetFromRow(rows[0], settings.timezone);
  }
  const created = await getTimesheet(userEmail, weekStart);
  if (!created) throw new Error("Failed to create timesheet");
  return created;
}

export async function getWeeklyTimesheetDetail(
  userEmail: string,
  weekStart: string
): Promise<WeeklyTimesheet> {
  requirePostgres();
  const settings = await getTimeClockSettings();
  const { from, to, week_end } = weekRangeFromStart(weekStart, settings.timezone);
  const [{ entries }, sheet] = await Promise.all([
    listTimeEntries({ userEmail, from, to, limit: 500 }),
    ensureTimesheetRow(userEmail, weekStart),
  ]);

  const totalHours = entries.reduce((sum, e) => sum + entryHours(e), 0);
  const openEntry = entries.some((e) => !e.clock_out);
  const pendingEdits = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM time_entry_edit_requests r
     JOIN time_entries e ON e.id = r.entry_id
     WHERE r.requested_by = $1
       AND r.status = 'pending'
       AND e.clock_in >= $2::timestamptz
       AND e.clock_in < $3::timestamptz`,
    [userEmail.toLowerCase(), from, to]
  );

  await query(
    `UPDATE time_timesheets
     SET total_hours = $3, updated_at = now()
     WHERE user_email = $1 AND week_start = $2::date`,
    [userEmail.toLowerCase(), weekStart, totalHours]
  );

  return {
    ...sheet,
    week_end,
    total_hours: totalHours,
    entries,
    has_open_entry: openEntry,
    has_pending_edits: Number(pendingEdits[0]?.count || 0) > 0,
  };
}

export async function submitWeeklyTimesheet(
  userEmail: string,
  weekStart: string
): Promise<WeeklyTimesheet> {
  const detail = await getWeeklyTimesheetDetail(userEmail, weekStart);
  if (detail.status === "approved") {
    throw new Error("This timesheet is already approved");
  }
  if (detail.status === "submitted") {
    throw new Error("This timesheet is already submitted");
  }
  if (detail.has_open_entry) {
    throw new Error("Clock out of all open entries before submitting");
  }
  if (detail.has_pending_edits) {
    throw new Error("Resolve pending edit requests before submitting");
  }
  if (!detail.entries?.length) {
    throw new Error("No time entries for this week");
  }

  await query(
    `UPDATE time_timesheets
     SET status = 'submitted',
         submitted_at = now(),
         total_hours = $3,
         review_notes = '',
         reviewed_by = NULL,
         reviewed_at = NULL,
         updated_at = now()
     WHERE user_email = $1 AND week_start = $2::date`,
    [userEmail.toLowerCase(), weekStart, detail.total_hours]
  );
  await auditSubject(userEmail, {
    actorEmail: userEmail,
    action: "timesheet.submitted",
    entityType: "timesheet",
    entityId: `${userEmail}:${weekStart}`,
    after: { week_start: weekStart, total_hours: detail.total_hours },
  });
  return getWeeklyTimesheetDetail(userEmail, weekStart);
}

export async function listSubmittedTimesheets(
  limit = 50,
  userEmails?: string[] | null
): Promise<WeeklyTimesheet[]> {
  requirePostgres();
  const settings = await getTimeClockSettings();
  const clauses = ["t.status = 'submitted'"];
  const params: unknown[] = [];
  let idx = 1;
  if (userEmails?.length) {
    clauses.push(`t.user_email = ANY($${idx++}::citext[])`);
    params.push(userEmails.map((e) => e.toLowerCase()));
  }
  params.push(Math.min(limit, 200));
  const rows = await query(
    `SELECT t.*, u.name AS user_name, rev.name AS reviewer_name
     FROM time_timesheets t
     JOIN users u ON u.email = t.user_email
     LEFT JOIN users rev ON rev.email = t.reviewed_by
     WHERE ${clauses.join(" AND ")}
     ORDER BY t.submitted_at ASC
     LIMIT $${idx}`,
    params
  );
  return rows.map((row) => timesheetFromRow(row, settings.timezone));
}

export async function reviewWeeklyTimesheet(input: {
  userEmail: string;
  weekStart: string;
  reviewerEmail: string;
  approve: boolean;
  reviewNotes?: string;
}): Promise<WeeklyTimesheet> {
  requirePostgres();
  const sheet = await getTimesheet(input.userEmail, input.weekStart);
  if (!sheet) throw new Error("Timesheet not found");
  if (sheet.status !== "submitted") {
    throw new Error("Only submitted timesheets can be reviewed");
  }

  const status = input.approve ? "approved" : "rejected";
  await query(
    `UPDATE time_timesheets
     SET status = $3,
         reviewed_by = $4,
         reviewed_at = now(),
         review_notes = $5,
         updated_at = now()
     WHERE user_email = $1 AND week_start = $2::date`,
    [
      input.userEmail.toLowerCase(),
      input.weekStart,
      status,
      input.reviewerEmail.toLowerCase(),
      (input.reviewNotes || "").trim(),
    ]
  );
  await auditSubject(input.userEmail, {
    actorEmail: input.reviewerEmail,
    action: input.approve ? "timesheet.approved" : "timesheet.rejected",
    entityType: "timesheet",
    entityId: `${input.userEmail}:${input.weekStart}`,
    before: { status: sheet.status, total_hours: sheet.total_hours },
    after: {
      status,
      review_notes: input.reviewNotes || "",
      total_hours: sheet.total_hours,
    },
  });
  return getWeeklyTimesheetDetail(input.userEmail, input.weekStart);
}

function statusLabel(status: TeamMemberLiveStatus): string {
  const labels: Record<TeamMemberLiveStatus, string> = {
    clocked_in: "Clocked in",
    on_break: "On break",
    clocked_out: "Clocked out",
    not_started: "Not started",
    forgot_to_punch: "No punch today",
  };
  return labels[status];
}

export async function listTeamLiveStatus(
  allowedUserEmails?: string[] | null
): Promise<TeamLiveStatusRow[]> {
  requirePostgres();
  const settings = await getTimeClockSettings();
  const emailFilter = allowedUserEmails?.length
    ? `AND u.email = ANY($1::citext[])`
    : "";
  const userParams = allowedUserEmails?.length
    ? [allowedUserEmails.map((e) => e.toLowerCase())]
    : [];
  const users = await query<{
    email: string;
    name: string;
    timezone: string | null;
    team_id: string | null;
    team_name: string | null;
  }>(
    `SELECT u.email, u.name, u.timezone, t.id AS team_id, t.name AS team_name
     FROM users u
     LEFT JOIN time_clock_team_members m ON m.user_email = u.email
     LEFT JOIN time_clock_teams t ON t.id = m.team_id
     WHERE u.active = true
       AND (
         u.role IN ('Admin', 'Supervisor')
         OR EXISTS (
           SELECT 1 FROM unnest(COALESCE(u.modules, ARRAY[]::text[])) AS m(mod)
           WHERE m.mod = 'time_clock'
         )
       )
       ${emailFilter}
     ORDER BY t.name ASC NULLS LAST, u.name ASC, u.email ASC`,
    userParams
  );

  const now = new Date();
  const rows: TeamLiveStatusRow[] = [];

  for (const user of users) {
    const tz = (user.timezone || settings.timezone).trim() || settings.timezone;
    const todayStart = startOfDayIso(now, tz);
    const tomorrowStart = addDaysIso(todayStart, 1, tz);
    const { hour, minute, weekday } = localHourAndWeekday(now, tz);
    const localTime = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(now);

    const openRows = await query(
      `SELECT clock_in FROM time_entries
       WHERE user_email = $1 AND clock_out IS NULL
       ORDER BY clock_in DESC LIMIT 1`,
      [user.email]
    );

    const todayRows = await query(
      `SELECT clock_in, clock_out
       FROM time_entries
       WHERE user_email = $1
         AND clock_in >= $2::timestamptz
         AND clock_in < $3::timestamptz
       ORDER BY clock_in ASC`,
      [user.email, todayStart, tomorrowStart]
    );

    let todayHours = 0;
    let lastPunchAt: string | null = null;
    for (const entry of todayRows) {
      const clockIn = new Date(entry.clock_in as Date).toISOString();
      const clockOut = entry.clock_out
        ? new Date(entry.clock_out as Date).toISOString()
        : null;
      todayHours += entryHours({
        id: "",
        user_email: user.email,
        clock_in: clockIn,
        clock_out: clockOut,
        notes: "",
        created_at: clockIn,
        updated_at: clockIn,
      });
      lastPunchAt = clockOut || clockIn;
    }

    const weekStart = weekStartDate(now, settings.timezone);
    const timesheet = await getTimesheet(user.email, weekStart);

    let status: TeamMemberLiveStatus;
    const openEntry = openRows[0];
    if (openEntry) {
      status = "clocked_in";
    } else if (!todayRows.length) {
      const isWorkday = weekday >= 1 && weekday <= 5;
      const minutesSinceMidnight = hour * 60 + minute;
      status =
        isWorkday && minutesSinceMidnight >= 9 * 60 + 30
          ? "forgot_to_punch"
          : "not_started";
    } else if (hour < 18) {
      status = "on_break";
    } else {
      status = "clocked_out";
    }

    rows.push({
      user_email: user.email,
      user_name: user.name || user.email,
      timezone: tz,
      local_time: localTime,
      status,
      status_label: statusLabel(status),
      today_hours: todayHours,
      last_punch_at: lastPunchAt,
      last_punch_label: lastPunchAt ? formatPunchLabel(lastPunchAt, tz) : null,
      clocked_in_since: openEntry
        ? new Date(openEntry.clock_in as Date).toISOString()
        : null,
      timesheet_status: timesheet?.status ?? null,
      team_id: user.team_id ? String(user.team_id) : null,
      team_name: user.team_name ? String(user.team_name) : null,
    });
  }

  return rows;
}

function formatPunchLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

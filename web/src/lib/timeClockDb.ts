import "server-only";

import { randomUUID } from "crypto";
import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";
import type {
  PunchStatus,
  TimeClockReport,
  TimeClockSettings,
  TimeEntry,
  TimeEntryEditRequest,
  WeeklyHoursRow,
} from "@/lib/timeClockTypes";

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
  return serializeRow<TimeClockSettings>(rows[0]);
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
  return withName || entry;
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
  return withName || entry;
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
  const rows = await query(
    `UPDATE time_entries
     SET notes = $2, updated_at = now()
     WHERE id = $1
     RETURNING id, user_email, clock_in, clock_out, notes, created_at, updated_at`,
    [entryId, notes.trim()]
  );
  const updated = entryFromRow(rows[0]);
  const withName = await getTimeEntry(updated.id);
  return withName || updated;
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
  return editRequestFromRow(rows[0]);
}

export async function listEditRequests(opts: {
  status?: string;
  userEmail?: string | null;
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
  if (found) return found;

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
  team?: boolean;
}): Promise<TimeClockReport> {
  requirePostgres();
  const settings = await getTimeClockSettings();
  const timezone = settings.timezone;

  if (opts.team) {
    const { entries } = await listTimeEntries({
      from: opts.from,
      to: opts.to,
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
     GROUP BY day, e.user_email, u.name
     ORDER BY day DESC, u.name ASC`,
    [opts.from, opts.to, settings.timezone]
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
         role = 'Admin'
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

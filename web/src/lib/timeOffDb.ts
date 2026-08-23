import "server-only";

import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";
import { logTimeClockAudit } from "@/lib/timeClockAudit";
import { getTeamIdForUser } from "@/lib/timeClockTeamsDb";
import type { TimeOffEntry, TimeOffKind } from "@/lib/timeClockTypes";

const usePostgres = () => process.env.DB_BACKEND?.trim().toLowerCase() === "postgres";

function requirePostgres() {
  if (!usePostgres()) {
    throw new Error("Time off requires DB_BACKEND=postgres");
  }
}

const TIME_OFF_KINDS: TimeOffKind[] = ["pto", "sick", "holiday", "unpaid"];

export function isTimeOffKind(value: string): value is TimeOffKind {
  return TIME_OFF_KINDS.includes(value as TimeOffKind);
}

function entryFromRow(row: QueryResultRow): TimeOffEntry {
  return {
    id: String(row.id),
    user_email: String(row.user_email),
    entry_date:
      row.entry_date instanceof Date
        ? row.entry_date.toISOString().slice(0, 10)
        : String(row.entry_date).slice(0, 10),
    kind: String(row.kind) as TimeOffKind,
    hours: Number(row.hours),
    notes: String(row.notes || ""),
    created_by: row.created_by ? String(row.created_by) : null,
    created_at: new Date(row.created_at as Date).toISOString(),
    updated_at: new Date(row.updated_at as Date).toISOString(),
  };
}

export async function listTimeOffEntries(
  userEmail: string,
  fromDate: string,
  toDate: string
): Promise<TimeOffEntry[]> {
  requirePostgres();
  const rows = await query(
    `SELECT id, user_email, entry_date, kind, hours::float8 AS hours, notes,
            created_by, created_at, updated_at
     FROM time_off_entries
     WHERE user_email = $1
       AND entry_date >= $2::date
       AND entry_date <= $3::date
     ORDER BY entry_date ASC`,
    [userEmail.toLowerCase(), fromDate, toDate]
  );
  return rows.map(entryFromRow);
}

export async function getTimeOffForDate(
  userEmail: string,
  entryDate: string
): Promise<TimeOffEntry | null> {
  requirePostgres();
  const rows = await query(
    `SELECT id, user_email, entry_date, kind, hours::float8 AS hours, notes,
            created_by, created_at, updated_at
     FROM time_off_entries
     WHERE user_email = $1 AND entry_date = $2::date`,
    [userEmail.toLowerCase(), entryDate]
  );
  return rows[0] ? entryFromRow(rows[0]) : null;
}

export async function upsertTimeOffEntry(input: {
  userEmail: string;
  entryDate: string;
  kind: TimeOffKind;
  hours: number;
  notes?: string;
  actorEmail: string;
}): Promise<TimeOffEntry> {
  requirePostgres();
  if (!isTimeOffKind(input.kind)) {
    throw new Error("Invalid time off kind");
  }
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 24) {
    throw new Error("Hours must be between 0 and 24");
  }

  const existing = await getTimeOffForDate(input.userEmail, input.entryDate);
  const rows = await query(
    `INSERT INTO time_off_entries (user_email, entry_date, kind, hours, notes, created_by)
     VALUES ($1, $2::date, $3, $4, $5, $6)
     ON CONFLICT (user_email, entry_date) DO UPDATE
       SET kind = EXCLUDED.kind,
           hours = EXCLUDED.hours,
           notes = EXCLUDED.notes,
           updated_at = now()
     RETURNING id, user_email, entry_date, kind, hours::float8 AS hours, notes,
               created_by, created_at, updated_at`,
    [
      input.userEmail.toLowerCase(),
      input.entryDate,
      input.kind,
      input.hours,
      (input.notes || "").trim(),
      input.actorEmail.toLowerCase(),
    ]
  );
  const saved = entryFromRow(rows[0]);
  const teamId = await getTeamIdForUser(input.userEmail);
  await logTimeClockAudit({
    actorEmail: input.actorEmail,
    subjectEmail: input.userEmail,
    teamId: teamId || null,
    action: existing ? "time_off.updated" : "time_off.created",
    entityType: "time_off",
    entityId: saved.id,
    before: existing
      ? {
          entry_date: existing.entry_date,
          kind: existing.kind,
          hours: existing.hours,
          notes: existing.notes,
        }
      : {},
    after: {
      entry_date: saved.entry_date,
      kind: saved.kind,
      hours: saved.hours,
      notes: saved.notes,
    },
  });
  return saved;
}

export async function deleteTimeOffEntry(
  id: string,
  userEmail: string,
  actorEmail: string
): Promise<void> {
  requirePostgres();
  const rows = await query(
    `SELECT id, user_email, entry_date, kind, hours::float8 AS hours, notes,
            created_by, created_at, updated_at
     FROM time_off_entries
     WHERE id = $1 AND user_email = $2`,
    [id, userEmail.toLowerCase()]
  );
  if (!rows[0]) throw new Error("Time off entry not found");
  const existing = entryFromRow(rows[0]);
  await query(`DELETE FROM time_off_entries WHERE id = $1`, [id]);
  const teamId = await getTeamIdForUser(userEmail);
  await logTimeClockAudit({
    actorEmail,
    subjectEmail: userEmail,
    teamId: teamId || null,
    action: "time_off.deleted",
    entityType: "time_off",
    entityId: id,
    before: {
      entry_date: existing.entry_date,
      kind: existing.kind,
      hours: existing.hours,
      notes: existing.notes,
    },
    after: {},
  });
}

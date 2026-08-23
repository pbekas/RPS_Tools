import "server-only";

import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";
import { logTimeClockAudit } from "@/lib/timeClockAudit";
import { getTeamIdForUser } from "@/lib/timeClockTeamsDb";
import type { TimeOffBank, TimeOffEntry, TimeOffKind } from "@/lib/timeClockTypes";
import {
  BANK_DEDUCTING_KINDS,
  deductsFromTimeOffBank,
} from "@/lib/timeClockTypes";
import { allowlist } from "@/lib/sqlAllowlist";

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

export { deductsFromTimeOffBank };

async function getDefaultAnnualPtoHours(): Promise<number> {
  const rows = await query<{ default_annual_pto_hours: number }>(
    `SELECT default_annual_pto_hours::float8 AS default_annual_pto_hours
     FROM time_clock_settings
     WHERE id = 'default'`
  );
  return Number(rows[0]?.default_annual_pto_hours ?? 80);
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

function yearFromDate(entryDate: string): number {
  return Number(entryDate.slice(0, 4));
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

async function sumUsedBankHours(
  userEmail: string,
  year: number,
  excludeEntryId?: string | null
): Promise<number> {
  const params: unknown[] = [userEmail.toLowerCase(), year, BANK_DEDUCTING_KINDS];
  let excludeClause = "";
  if (excludeEntryId) {
    params.push(excludeEntryId);
    excludeClause = `AND id <> $${params.length}`;
  }
  const rows = await query<{ used: number }>(
    `SELECT COALESCE(SUM(hours), 0)::float8 AS used
     FROM time_off_entries
     WHERE user_email = $1
       AND EXTRACT(YEAR FROM entry_date)::int = $2
       AND kind = ANY($3::text[])
       ${excludeClause}`,
    params
  );
  return Number(rows[0]?.used || 0);
}

export async function batchTimeOffBankSummaries(
  userEmails: string[],
  year: number
): Promise<
  Map<string, { allotted_hours: number; used_hours: number; remaining_hours: number }>
> {
  requirePostgres();
  const emails = [...new Set(userEmails.map((e) => e.toLowerCase()))];
  const result = new Map<
    string,
    { allotted_hours: number; used_hours: number; remaining_hours: number }
  >();
  if (!emails.length) return result;

  const defaultAllotment = await getDefaultAnnualPtoHours();
  const [bankRows, usedRows] = await Promise.all([
    query<{ user_email: string; allotted_hours: number }>(
      `SELECT user_email, allotted_hours::float8 AS allotted_hours
       FROM time_off_banks
       WHERE user_email = ANY($1::citext[]) AND year = $2`,
      [emails, year]
    ),
    query<{ user_email: string; used: number }>(
      `SELECT user_email, COALESCE(SUM(hours), 0)::float8 AS used
       FROM time_off_entries
       WHERE user_email = ANY($1::citext[])
         AND EXTRACT(YEAR FROM entry_date)::int = $2
         AND kind = ANY($3::text[])
       GROUP BY user_email`,
      [emails, year, BANK_DEDUCTING_KINDS]
    ),
  ]);

  const customAllotments = new Map(
    bankRows.map((row) => [String(row.user_email).toLowerCase(), Number(row.allotted_hours)])
  );
  const usedByEmail = new Map(
    usedRows.map((row) => [String(row.user_email).toLowerCase(), Number(row.used)])
  );

  for (const email of emails) {
    const allotted = customAllotments.get(email) ?? defaultAllotment;
    const used = usedByEmail.get(email) ?? 0;
    result.set(email, {
      allotted_hours: allotted,
      used_hours: used,
      remaining_hours: Math.max(0, allotted - used),
    });
  }
  return result;
}

export async function getTimeOffBank(
  userEmail: string,
  year?: number
): Promise<TimeOffBank> {
  requirePostgres();
  const bankYear = year ?? new Date().getFullYear();
  const email = userEmail.toLowerCase();

  const [userRows, bankRows, used, defaultAllotment] = await Promise.all([
    query<{ email: string; name: string }>(
      `SELECT email, name FROM users WHERE email = $1`,
      [email]
    ),
    query(
      `SELECT allotted_hours::float8 AS allotted_hours, notes
       FROM time_off_banks
       WHERE user_email = $1 AND year = $2`,
      [email, bankYear]
    ),
    sumUsedBankHours(email, bankYear),
    getDefaultAnnualPtoHours(),
  ]);

  if (!userRows[0]) throw new Error("User not found");

  const hasCustom = Boolean(bankRows[0]);
  const allotted = hasCustom
    ? Number(bankRows[0].allotted_hours)
    : defaultAllotment;
  const remaining = Math.max(0, allotted - used);

  return {
    user_email: email,
    user_name: String(userRows[0].name || email),
    year: bankYear,
    allotted_hours: allotted,
    used_hours: used,
    remaining_hours: remaining,
    is_default_allotment: !hasCustom,
    notes: hasCustom ? String(bankRows[0].notes || "") : "",
  };
}

export async function setTimeOffBankAllotment(input: {
  userEmail: string;
  year: number;
  allottedHours: number;
  notes?: string;
  actorEmail: string;
}): Promise<TimeOffBank> {
  requirePostgres();
  if (
    !Number.isFinite(input.allottedHours) ||
    input.allottedHours < 0 ||
    input.allottedHours > 2000
  ) {
    throw new Error("Allotted hours must be between 0 and 2000");
  }
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    throw new Error("Invalid year");
  }

  const email = input.userEmail.toLowerCase();
  const before = await getTimeOffBank(email, input.year);
  if (input.allottedHours + 0.001 < before.used_hours) {
    throw new Error(
      `Cannot set allotment below hours already used (${before.used_hours}h used in ${input.year})`
    );
  }
  await query(
    `INSERT INTO time_off_banks (user_email, year, allotted_hours, notes, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_email, year) DO UPDATE
       SET allotted_hours = EXCLUDED.allotted_hours,
           notes = EXCLUDED.notes,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
    [
      email,
      input.year,
      input.allottedHours,
      (input.notes || "").trim(),
      input.actorEmail.toLowerCase(),
    ]
  );

  const after = await getTimeOffBank(email, input.year);

  const teamId = await getTeamIdForUser(email);
  await logTimeClockAudit({
    actorEmail: input.actorEmail,
    subjectEmail: email,
    teamId: teamId || null,
    action: "time_off_bank.updated",
    entityType: "time_off_bank",
    entityId: `${email}:${input.year}`,
    before: {
      year: before.year,
      allotted_hours: before.allotted_hours,
      is_default_allotment: before.is_default_allotment,
    },
    after: {
      year: after.year,
      allotted_hours: after.allotted_hours,
      notes: after.notes,
    },
  });
  return after;
}

export async function listTimeOffBanks(
  year: number,
  userEmails?: string[] | null
): Promise<TimeOffBank[]> {
  requirePostgres();
  if (allowlist(userEmails) === "none") return [];
  const emailFilter = userEmails?.length
    ? `AND u.email = ANY($2::citext[])`
    : "";
  const params: unknown[] = [year];
  if (userEmails?.length) {
    params.push(userEmails.map((e) => e.toLowerCase()));
  }

  const users = await query<{ email: string; name: string }>(
    `SELECT u.email, u.name
     FROM users u
     WHERE u.active = true
       AND (
         u.role IN ('Admin', 'Supervisor')
         OR EXISTS (
           SELECT 1 FROM unnest(COALESCE(u.modules, ARRAY[]::text[])) AS m(mod)
           WHERE m.mod = 'time_clock'
         )
       )
       ${emailFilter}
     ORDER BY u.name ASC, u.email ASC`,
    params
  );

  const banks: TimeOffBank[] = [];
  for (const user of users) {
    banks.push(await getTimeOffBank(String(user.email), year));
  }
  return banks;
}

async function assertBankAllowsHours(input: {
  userEmail: string;
  entryDate: string;
  kind: TimeOffKind;
  hours: number;
  existing?: TimeOffEntry | null;
}): Promise<void> {
  if (!deductsFromTimeOffBank(input.kind)) return;

  const year = yearFromDate(input.entryDate);
  const existingDeduct =
    input.existing && deductsFromTimeOffBank(input.existing.kind)
      ? input.existing.hours
      : 0;
  const usedWithout = await sumUsedBankHours(
    input.userEmail,
    year,
    input.existing?.id || null
  );
  const bank = await getTimeOffBank(input.userEmail, year);
  const available = bank.allotted_hours - usedWithout;
  if (input.hours > available + 0.001) {
    throw new Error(
      `Not enough time-off bank hours for ${year}. ` +
        `Remaining ${Math.max(0, available).toFixed(1)}h ` +
        `(allotted ${bank.allotted_hours}h, used ${usedWithout}h` +
        `${existingDeduct ? `, replacing ${existingDeduct}h` : ""}).`
    );
  }
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
  await assertBankAllowsHours({
    userEmail: input.userEmail,
    entryDate: input.entryDate,
    kind: input.kind,
    hours: input.hours,
    existing,
  });

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
  const bankAfter = deductsFromTimeOffBank(saved.kind)
    ? await getTimeOffBank(input.userEmail, yearFromDate(saved.entry_date))
    : null;
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
      bank_remaining: bankAfter?.remaining_hours,
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
  const bankAfter = deductsFromTimeOffBank(existing.kind)
    ? await getTimeOffBank(userEmail, yearFromDate(existing.entry_date))
    : null;
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
    after: {
      bank_remaining: bankAfter?.remaining_hours,
    },
  });
}

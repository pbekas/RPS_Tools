import "server-only";

import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";
import { logTimeClockAudit } from "@/lib/timeClockAudit";
import { getTeamIdForUser } from "@/lib/timeClockTeamsDb";
import { notifyTimeOffPending } from "@/lib/timeClockApprovalMail";
import type {
  TeamTimeOffEntry,
  TimeOffBank,
  TimeOffEntry,
  TimeOffKind,
  TimeOffStatus,
} from "@/lib/timeClockTypes";
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

/** PTO banks apply to employees only, not Admin accounts. */
export function roleHasTimeOffBank(role: string | null | undefined): boolean {
  return (role || "").trim().toLowerCase() !== "admin";
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

const ENTRY_SELECT = `e.id, e.user_email, e.entry_date, e.kind, e.hours::float8 AS hours, e.notes,
            e.created_by, e.created_at, e.updated_at,
            e.status, e.reviewed_by, e.reviewed_at, e.review_notes,
            u.name AS user_name, rev.name AS reviewer_name`;

function entryFromRow(row: QueryResultRow): TimeOffEntry {
  const status = String(row.status || "approved") as TimeOffStatus;
  return {
    id: String(row.id),
    user_email: String(row.user_email),
    user_name: row.user_name ? String(row.user_name) : undefined,
    entry_date:
      row.entry_date instanceof Date
        ? row.entry_date.toISOString().slice(0, 10)
        : String(row.entry_date).slice(0, 10),
    kind: String(row.kind) as TimeOffKind,
    hours: Number(row.hours),
    notes: String(row.notes || ""),
    status: ["pending", "approved", "denied"].includes(status) ? status : "approved",
    created_by: row.created_by ? String(row.created_by) : null,
    reviewed_by: row.reviewed_by ? String(row.reviewed_by) : null,
    reviewer_name: row.reviewer_name ? String(row.reviewer_name) : undefined,
    reviewed_at: row.reviewed_at
      ? new Date(row.reviewed_at as Date).toISOString()
      : null,
    review_notes: String(row.review_notes || ""),
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
    `SELECT ${ENTRY_SELECT}
     FROM time_off_entries e
     LEFT JOIN users u ON u.email = e.user_email
     LEFT JOIN users rev ON rev.email = e.reviewed_by
     WHERE e.user_email = $1
       AND e.entry_date >= $2::date
       AND e.entry_date <= $3::date
     ORDER BY e.entry_date ASC`,
    [userEmail.toLowerCase(), fromDate, toDate]
  );
  return rows.map(entryFromRow);
}

export async function listPendingTimeOffRequests(
  userEmails?: string[] | null
): Promise<TimeOffEntry[]> {
  requirePostgres();
  const scope = allowlist(userEmails);
  if (scope === "none") return [];
  const params: unknown[] = [];
  const emailClause =
    scope === "all"
      ? ""
      : `AND e.user_email = ANY($1::citext[])`;
  if (scope !== "all") params.push(scope.map((e) => String(e).toLowerCase()));
  const rows = await query(
    `SELECT ${ENTRY_SELECT}
     FROM time_off_entries e
     LEFT JOIN users u ON u.email = e.user_email
     LEFT JOIN users rev ON rev.email = e.reviewed_by
     WHERE e.status = 'pending'
       ${emailClause}
     ORDER BY e.entry_date ASC, u.name ASC`,
    params
  );
  return rows.map(entryFromRow);
}

export async function listTeamTimeOff(opts: {
  from: string;
  to: string;
  userEmails?: string[] | null;
  statuses?: TimeOffStatus[];
}): Promise<TeamTimeOffEntry[]> {
  requirePostgres();
  const scope = allowlist(opts.userEmails);
  if (scope === "none") return [];
  const statuses = opts.statuses?.length
    ? opts.statuses
    : (["pending", "approved"] as TimeOffStatus[]);
  const params: unknown[] = [opts.from, opts.to, statuses];
  let emailClause = "";
  if (scope !== "all") {
    params.push(scope.map((email) => String(email).toLowerCase()));
    emailClause = `AND e.user_email = ANY($4::citext[])`;
  }
  const rows = await query(
    `SELECT DISTINCT ON (e.id)
            ${ENTRY_SELECT},
            t.id AS team_id,
            t.name AS team_name
     FROM time_off_entries e
     LEFT JOIN users u ON u.email = e.user_email
     LEFT JOIN users rev ON rev.email = e.reviewed_by
     LEFT JOIN time_clock_team_members m ON m.user_email = e.user_email
     LEFT JOIN time_clock_teams t ON t.id = m.team_id
     WHERE e.entry_date >= $1::date
       AND e.entry_date <= $2::date
       AND e.status = ANY($3::text[])
       ${emailClause}
     ORDER BY e.id, t.name ASC NULLS LAST`,
    params
  );
  return rows
    .map((row) => ({
      ...entryFromRow(row),
      team_id: row.team_id ? String(row.team_id) : null,
      team_name: row.team_name ? String(row.team_name) : null,
    }))
    .sort((a, b) => {
      const byDate = a.entry_date.localeCompare(b.entry_date);
      if (byDate) return byDate;
      const byTeam = (a.team_name || "zzz").localeCompare(b.team_name || "zzz");
      if (byTeam) return byTeam;
      return (a.user_name || a.user_email).localeCompare(b.user_name || b.user_email);
    });
}

export async function getTimeOffEntryById(id: string): Promise<TimeOffEntry | null> {
  requirePostgres();
  const rows = await query(
    `SELECT ${ENTRY_SELECT}
     FROM time_off_entries e
     LEFT JOIN users u ON u.email = e.user_email
     LEFT JOIN users rev ON rev.email = e.reviewed_by
     WHERE e.id = $1`,
    [id]
  );
  return rows[0] ? entryFromRow(rows[0]) : null;
}

async function findTimeOffOnDate(
  userEmail: string,
  entryDate: string
): Promise<TimeOffEntry | null> {
  const rows = await query(
    `SELECT ${ENTRY_SELECT}
     FROM time_off_entries e
     LEFT JOIN users u ON u.email = e.user_email
     LEFT JOIN users rev ON rev.email = e.reviewed_by
     WHERE e.user_email = $1 AND e.entry_date = $2::date`,
    [userEmail.toLowerCase(), entryDate]
  );
  return rows[0] ? entryFromRow(rows[0]) : null;
}

export async function getTimeOffForDate(
  userEmail: string,
  entryDate: string
): Promise<TimeOffEntry | null> {
  requirePostgres();
  const entry = await findTimeOffOnDate(userEmail, entryDate);
  if (!entry || entry.status !== "approved") return null;
  return entry;
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
       AND status IN ('pending', 'approved')
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
  const [bankRows, usedRows, roleRows] = await Promise.all([
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
         AND status IN ('pending', 'approved')
       GROUP BY user_email`,
      [emails, year, BANK_DEDUCTING_KINDS]
    ),
    query<{ email: string; role: string }>(
      `SELECT email, role FROM users WHERE email = ANY($1::citext[])`,
      [emails]
    ),
  ]);

  const roles = new Map(
    roleRows.map((row) => [
      String(row.email).toLowerCase(),
      String(row.role || "Agent"),
    ])
  );
  const customAllotments = new Map(
    bankRows.map((row) => [String(row.user_email).toLowerCase(), Number(row.allotted_hours)])
  );
  const usedByEmail = new Map(
    usedRows.map((row) => [String(row.user_email).toLowerCase(), Number(row.used)])
  );

  for (const email of emails) {
    if (!roleHasTimeOffBank(roles.get(email))) {
      result.set(email, {
        allotted_hours: 0,
        used_hours: 0,
        remaining_hours: 0,
      });
      continue;
    }
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
    query<{ email: string; name: string; role: string }>(
      `SELECT email, name, role FROM users WHERE email = $1`,
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

  const eligible = roleHasTimeOffBank(userRows[0].role);
  if (!eligible) {
    return {
      user_email: email,
      user_name: String(userRows[0].name || email),
      year: bankYear,
      allotted_hours: 0,
      used_hours: 0,
      remaining_hours: 0,
      is_default_allotment: true,
      notes: "",
      eligible: false,
    };
  }

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
    eligible: true,
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
  if (!before.eligible) {
    throw new Error("PTO banks are only for employees, not admins");
  }
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
    ? `AND u.email = ANY($1::citext[])`
    : "";
  const params: unknown[] = userEmails?.length
    ? [userEmails.map((e) => e.toLowerCase())]
    : [];

  const users = await query<{ email: string; name: string }>(
    `SELECT u.email, u.name
     FROM users u
     WHERE u.active = true
       AND lower(u.role::text) <> 'admin'
       AND (
         u.role IN ('Supervisor')
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
  const bank = await getTimeOffBank(input.userEmail, year);
  if (!bank.eligible) return;
  const existingDeduct =
    input.existing && deductsFromTimeOffBank(input.existing.kind)
      ? input.existing.hours
      : 0;
  const usedWithout = await sumUsedBankHours(
    input.userEmail,
    year,
    input.existing?.id || null
  );
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
  autoApprove?: boolean;
}): Promise<TimeOffEntry> {
  requirePostgres();
  if (!isTimeOffKind(input.kind)) {
    throw new Error("Invalid time off kind");
  }
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 24) {
    throw new Error("Hours must be between 0 and 24");
  }

  const existing = await findTimeOffOnDate(input.userEmail, input.entryDate);
  if (existing?.status === "approved" && !input.autoApprove) {
    throw new Error(
      "This day is already approved. Ask a supervisor or admin to change it."
    );
  }
  await assertBankAllowsHours({
    userEmail: input.userEmail,
    entryDate: input.entryDate,
    kind: input.kind,
    hours: input.hours,
    existing,
  });

  const status: TimeOffStatus = input.autoApprove ? "approved" : "pending";
  const reviewedBy = input.autoApprove ? input.actorEmail.toLowerCase() : null;
  const rows = await query<{ id: string }>(
    `INSERT INTO time_off_entries (
       user_email, entry_date, kind, hours, notes, created_by,
       status, reviewed_by, reviewed_at, review_notes
     )
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, CASE WHEN $7 = 'approved' THEN now() ELSE NULL END, '')
     ON CONFLICT (user_email, entry_date) DO UPDATE
       SET kind = EXCLUDED.kind,
           hours = EXCLUDED.hours,
           notes = EXCLUDED.notes,
           status = EXCLUDED.status,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at,
           review_notes = '',
           updated_at = now()
     RETURNING id`,
    [
      input.userEmail.toLowerCase(),
      input.entryDate,
      input.kind,
      input.hours,
      (input.notes || "").trim(),
      input.actorEmail.toLowerCase(),
      status,
      reviewedBy,
    ]
  );
  const saved = await getTimeOffEntryById(String(rows[0].id));
  if (!saved) throw new Error("Failed to save time off request");
  const teamId = await getTeamIdForUser(input.userEmail);
  const bankAfter = deductsFromTimeOffBank(saved.kind)
    ? await getTimeOffBank(input.userEmail, yearFromDate(saved.entry_date))
    : null;
  await logTimeClockAudit({
    actorEmail: input.actorEmail,
    subjectEmail: input.userEmail,
    teamId: teamId || null,
    action: existing ? "time_off.updated" : "time_off.requested",
    entityType: "time_off",
    entityId: saved.id,
    before: existing
      ? {
          entry_date: existing.entry_date,
          kind: existing.kind,
          hours: existing.hours,
          notes: existing.notes,
          status: existing.status,
        }
      : {},
    after: {
      entry_date: saved.entry_date,
      kind: saved.kind,
      hours: saved.hours,
      notes: saved.notes,
      status: saved.status,
      bank_remaining: bankAfter?.remaining_hours,
    },
  });
  if (
    saved.status === "pending" &&
    (!existing || existing.status !== "pending")
  ) {
    await notifyTimeOffPending(saved);
  }
  return saved;
}

export async function reviewTimeOffEntry(input: {
  id: string;
  approve: boolean;
  reviewerEmail: string;
  notes?: string;
}): Promise<TimeOffEntry> {
  requirePostgres();
  const existing = await getTimeOffEntryById(input.id);
  if (!existing) throw new Error("Time off request not found");
  if (existing.status !== "pending") {
    throw new Error("This request has already been reviewed");
  }
  if (existing.user_email.toLowerCase() === input.reviewerEmail.toLowerCase()) {
    throw new Error("You cannot approve or deny your own time-off request");
  }
  await query(
    `UPDATE time_off_entries
     SET status = $2,
         reviewed_by = $3,
         reviewed_at = now(),
         review_notes = $4,
         updated_at = now()
     WHERE id = $1`,
    [
      input.id,
      input.approve ? "approved" : "denied",
      input.reviewerEmail.toLowerCase(),
      (input.notes || "").trim(),
    ]
  );
  const saved = await getTimeOffEntryById(input.id);
  if (!saved) throw new Error("Time off request not found");
  const teamId = await getTeamIdForUser(existing.user_email);
  const bankAfter = deductsFromTimeOffBank(saved.kind)
    ? await getTimeOffBank(existing.user_email, yearFromDate(saved.entry_date))
    : null;
  await logTimeClockAudit({
    actorEmail: input.reviewerEmail,
    subjectEmail: existing.user_email,
    teamId: teamId || null,
    action: input.approve ? "time_off.approved" : "time_off.denied",
    entityType: "time_off",
    entityId: saved.id,
    before: { status: existing.status, hours: existing.hours, kind: existing.kind },
    after: {
      status: saved.status,
      review_notes: saved.review_notes,
      bank_remaining: bankAfter?.remaining_hours,
    },
  });
  return saved;
}

export async function deleteTimeOffEntry(
  id: string,
  userEmail: string,
  actorEmail: string,
  opts?: { asManager?: boolean }
): Promise<void> {
  requirePostgres();
  const existing = await getTimeOffEntryById(id);
  if (!existing || existing.user_email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new Error("Time off entry not found");
  }
  if (existing.status === "approved" && !opts?.asManager) {
    throw new Error(
      "Approved time off can only be removed by a supervisor or admin"
    );
  }
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

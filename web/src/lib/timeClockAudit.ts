import "server-only";

import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";
import type { TimeClockAuditEntry } from "@/lib/timeClockTypes";
import { allowlist } from "@/lib/sqlAllowlist";

const usePostgres = () => process.env.DB_BACKEND?.trim().toLowerCase() === "postgres";

function requirePostgres() {
  if (!usePostgres()) {
    throw new Error("Time clock audit requires DB_BACKEND=postgres");
  }
}

function rowToAudit(row: QueryResultRow): TimeClockAuditEntry {
  return {
    id: String(row.id),
    actor_email: row.actor_email ? String(row.actor_email) : null,
    actor_name: row.actor_name ? String(row.actor_name) : undefined,
    action: String(row.action),
    entity_type: String(row.entity_type),
    entity_id: row.entity_id ? String(row.entity_id) : null,
    subject_email: row.subject_email ? String(row.subject_email) : null,
    subject_name: row.subject_name ? String(row.subject_name) : undefined,
    team_id: row.team_id ? String(row.team_id) : null,
    team_name: row.team_name ? String(row.team_name) : undefined,
    before_data: (row.before_data as Record<string, unknown>) || {},
    after_data: (row.after_data as Record<string, unknown>) || {},
    metadata: (row.metadata as Record<string, unknown>) || {},
    created_at: new Date(row.created_at as Date).toISOString(),
  };
}

export async function logTimeClockAudit(input: {
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  subjectEmail?: string | null;
  teamId?: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  requirePostgres();
  await query(
    `INSERT INTO time_clock_audit_log (
       actor_email, action, entity_type, entity_id,
       subject_email, team_id, before_data, after_data, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
    [
      input.actorEmail?.toLowerCase() || null,
      input.action,
      input.entityType,
      input.entityId || null,
      input.subjectEmail?.toLowerCase() || null,
      input.teamId || null,
      JSON.stringify(input.before || {}),
      JSON.stringify(input.after || {}),
      JSON.stringify(input.metadata || {}),
    ]
  );
}

export type ListAuditLogOpts = {
  limit?: number;
  offset?: number;
  subjectEmail?: string | null;
  teamId?: string | null;
  teamIds?: string[] | null;
  allowedSubjectEmails?: string[] | null;
  action?: string;
  from?: string;
  to?: string;
};

export async function listTimeClockAuditLog(
  opts: ListAuditLogOpts = {}
): Promise<{ entries: TimeClockAuditEntry[]; total: number }> {
  requirePostgres();
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts.subjectEmail) {
    clauses.push(`a.subject_email = $${idx++}`);
    params.push(opts.subjectEmail.toLowerCase());
  }
  if (opts.teamId) {
    clauses.push(`a.team_id = $${idx++}::uuid`);
    params.push(opts.teamId);
  }
  const teamScope = allowlist(opts.teamIds);
  if (teamScope === "none") {
    clauses.push("FALSE");
  } else if (teamScope !== "all") {
    clauses.push(`a.team_id = ANY($${idx++}::uuid[])`);
    params.push(teamScope);
  }
  const emailScope = allowlist(opts.allowedSubjectEmails);
  if (emailScope === "none") {
    clauses.push("FALSE");
  } else if (emailScope !== "all") {
    clauses.push(`a.subject_email = ANY($${idx++}::citext[])`);
    params.push(emailScope.map((e) => String(e).toLowerCase()));
  }
  if (opts.action) {
    clauses.push(`a.action = $${idx++}`);
    params.push(opts.action);
  }
  if (opts.from) {
    clauses.push(`a.created_at >= $${idx++}::timestamptz`);
    params.push(opts.from);
  }
  if (opts.to) {
    clauses.push(`a.created_at < $${idx++}::timestamptz`);
    params.push(opts.to);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);

  const countRows = await query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM time_clock_audit_log a ${where}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);

  const rows = await query(
    `SELECT a.*,
            actor.name AS actor_name,
            subject.name AS subject_name,
            t.name AS team_name
     FROM time_clock_audit_log a
     LEFT JOIN users actor ON actor.email = a.actor_email
     LEFT JOIN users subject ON subject.email = a.subject_email
     LEFT JOIN time_clock_teams t ON t.id = a.team_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return { entries: rows.map(rowToAudit), total };
}

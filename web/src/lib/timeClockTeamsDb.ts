import "server-only";

import { randomUUID } from "crypto";
import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";
import { logTimeClockAudit } from "@/lib/timeClockAudit";
import type { TimeClockTeam } from "@/lib/timeClockTypes";
import { allowlist } from "@/lib/sqlAllowlist";

const usePostgres = () => process.env.DB_BACKEND?.trim().toLowerCase() === "postgres";

function requirePostgres() {
  if (!usePostgres()) {
    throw new Error("Time clock teams require DB_BACKEND=postgres");
  }
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function teamFromRow(row: QueryResultRow): TimeClockTeam {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    supervisor_email: row.supervisor_email ? String(row.supervisor_email) : null,
    supervisor_name: row.supervisor_name ? String(row.supervisor_name) : undefined,
    active: Boolean(row.active),
    member_count: Number(row.member_count || 0),
    created_at: new Date(row.created_at as Date).toISOString(),
    updated_at: new Date(row.updated_at as Date).toISOString(),
    members: Array.isArray(row.members) ? row.members : undefined,
  };
}

export async function listTimeClockTeams(opts?: {
  activeOnly?: boolean;
  teamIds?: string[] | null;
}): Promise<TimeClockTeam[]> {
  requirePostgres();
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (opts?.activeOnly !== false) {
    clauses.push("t.active = true");
  }
  const teamScope = allowlist(opts?.teamIds);
  if (teamScope === "none") {
    clauses.push("FALSE");
  } else if (teamScope !== "all") {
    clauses.push(`t.id = ANY($${idx++}::uuid[])`);
    params.push(teamScope);
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await query(
    `SELECT t.*,
            sup.name AS supervisor_name,
            COUNT(m.user_email)::int AS member_count
     FROM time_clock_teams t
     LEFT JOIN users sup ON sup.email = t.supervisor_email
     LEFT JOIN time_clock_team_members m ON m.team_id = t.id
     ${where}
     GROUP BY t.id, sup.name
     ORDER BY t.name ASC`,
    params
  );
  return rows.map(teamFromRow);
}

export async function getTimeClockTeam(id: string): Promise<TimeClockTeam | null> {
  requirePostgres();
  const rows = await query(
    `SELECT t.*,
            sup.name AS supervisor_name,
            COUNT(m.user_email)::int AS member_count
     FROM time_clock_teams t
     LEFT JOIN users sup ON sup.email = t.supervisor_email
     LEFT JOIN time_clock_team_members m ON m.team_id = t.id
     WHERE t.id = $1
     GROUP BY t.id, sup.name`,
    [id]
  );
  if (!rows[0]) return null;
  const members = await listTeamMembers(id);
  const team = teamFromRow(rows[0]);
  team.members = members;
  return team;
}

/** Org-wide teams used by Call QA and Time Clock. */
export async function listTimeClockTeamsWithMembers(opts?: {
  activeOnly?: boolean;
  teamIds?: string[] | null;
}): Promise<TimeClockTeam[]> {
  const teams = await listTimeClockTeams(opts);
  return Promise.all(teams.map(async (team) => (await getTimeClockTeam(team.id)) || team));
}

export async function listTeamMembers(teamId: string): Promise<
  Array<{ user_email: string; user_name: string; role: string }>
> {
  requirePostgres();
  const rows = await query(
    `SELECT m.user_email, u.name AS user_name, u.role
     FROM time_clock_team_members m
     JOIN users u ON u.email = m.user_email
     WHERE m.team_id = $1
     ORDER BY u.name ASC`,
    [teamId]
  );
  return rows.map((row) => ({
    user_email: String(row.user_email),
    user_name: String(row.user_name || row.user_email),
    role: String(row.role || "Agent"),
  }));
}

export async function listTeamsForSupervisor(supervisorEmail: string): Promise<TimeClockTeam[]> {
  requirePostgres();
  const rows = await query(
    `SELECT t.*,
            sup.name AS supervisor_name,
            COUNT(m.user_email)::int AS member_count
     FROM time_clock_teams t
     LEFT JOIN users sup ON sup.email = t.supervisor_email
     LEFT JOIN time_clock_team_members m ON m.team_id = t.id
     WHERE t.active = true
       AND t.supervisor_email = $1
     GROUP BY t.id, sup.name
     ORDER BY t.name ASC`,
    [supervisorEmail.toLowerCase()]
  );
  return rows.map(teamFromRow);
}

export async function getTeamForUser(userEmail: string): Promise<TimeClockTeam | null> {
  requirePostgres();
  const rows = await query(
    `SELECT t.*,
            sup.name AS supervisor_name,
            COUNT(m2.user_email)::int AS member_count
     FROM time_clock_team_members m
     JOIN time_clock_teams t ON t.id = m.team_id
     LEFT JOIN users sup ON sup.email = t.supervisor_email
     LEFT JOIN time_clock_team_members m2 ON m2.team_id = t.id
     WHERE m.user_email = $1
     GROUP BY t.id, sup.name`,
    [userEmail.toLowerCase()]
  );
  return rows[0] ? teamFromRow(rows[0]) : null;
}

export async function listTeamMemberEmails(teamIds: string[]): Promise<string[]> {
  if (!teamIds.length) return [];
  requirePostgres();
  const rows = await query<{ user_email: string }>(
    `SELECT DISTINCT user_email
     FROM time_clock_team_members
     WHERE team_id = ANY($1::uuid[])`,
    [teamIds]
  );
  return rows.map((r) => String(r.user_email).toLowerCase());
}

export async function listVisibleTimeClockUserEmails(
  teamIds: string[] | null
): Promise<string[] | null> {
  if (teamIds === null) {
    requirePostgres();
    const rows = await query<{ email: string }>(
      `SELECT u.email
       FROM users u
       WHERE u.active = true
         AND (
           u.role IN ('Admin', 'Supervisor')
           OR EXISTS (
             SELECT 1 FROM unnest(COALESCE(u.modules, ARRAY[]::text[])) AS m(mod)
             WHERE m.mod = 'time_clock'
           )
         )`
    );
    return rows.map((r) => String(r.email).toLowerCase());
  }
  return listTeamMemberEmails(teamIds);
}

export async function createTimeClockTeam(input: {
  name: string;
  slug?: string;
  supervisorEmail?: string | null;
  actorEmail: string;
}): Promise<TimeClockTeam> {
  requirePostgres();
  const name = input.name.trim();
  if (!name) throw new Error("Team name is required");
  let slug = (input.slug || slugify(name)).trim().toLowerCase();
  if (!slug) slug = `team-${randomUUID().slice(0, 8)}`;

  const rows = await query(
    `INSERT INTO time_clock_teams (name, slug, supervisor_email)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, slug, input.supervisorEmail?.toLowerCase() || null]
  );
  const team = await getTimeClockTeam(String(rows[0].id));
  if (!team) throw new Error("Failed to create team");

  await logTimeClockAudit({
    actorEmail: input.actorEmail,
    action: "team.created",
    entityType: "team",
    entityId: team.id,
    teamId: team.id,
    after: { name: team.name, slug: team.slug, supervisor_email: team.supervisor_email },
  });
  return team;
}

export async function updateTimeClockTeam(input: {
  teamId: string;
  name?: string;
  supervisorEmail?: string | null;
  active?: boolean;
  actorEmail: string;
}): Promise<TimeClockTeam> {
  requirePostgres();
  const before = await getTimeClockTeam(input.teamId);
  if (!before) throw new Error("Team not found");

  const rows = await query(
    `UPDATE time_clock_teams
     SET name = COALESCE($2, name),
         supervisor_email = CASE WHEN $3::boolean THEN $4 ELSE supervisor_email END,
         active = COALESCE($5, active),
         updated_at = now()
     WHERE id = $1
     RETURNING id`,
    [
      input.teamId,
      input.name?.trim() || null,
      input.supervisorEmail !== undefined,
      input.supervisorEmail?.toLowerCase() || null,
      input.active ?? null,
    ]
  );
  if (!rows[0]) throw new Error("Team not found");
  const team = await getTimeClockTeam(input.teamId);
  if (!team) throw new Error("Team not found");

  await logTimeClockAudit({
    actorEmail: input.actorEmail,
    action: "team.updated",
    entityType: "team",
    entityId: team.id,
    teamId: team.id,
    before: {
      name: before.name,
      supervisor_email: before.supervisor_email,
      active: before.active,
    },
    after: {
      name: team.name,
      supervisor_email: team.supervisor_email,
      active: team.active,
    },
  });
  return team;
}

export async function setTeamMember(input: {
  teamId: string;
  userEmail: string;
  actorEmail: string;
}): Promise<void> {
  requirePostgres();
  const team = await getTimeClockTeam(input.teamId);
  if (!team) throw new Error("Team not found");
  const email = input.userEmail.toLowerCase();

  const existing = await query(
    `SELECT team_id FROM time_clock_team_members WHERE user_email = $1`,
    [email]
  );
  const previousTeamId = existing[0] ? String(existing[0].team_id) : null;

  await query(`DELETE FROM time_clock_team_members WHERE user_email = $1`, [email]);
  await query(
    `INSERT INTO time_clock_team_members (team_id, user_email) VALUES ($1, $2)`,
    [input.teamId, email]
  );

  await logTimeClockAudit({
    actorEmail: input.actorEmail,
    action: "team.member_assigned",
    entityType: "team_member",
    entityId: email,
    subjectEmail: email,
    teamId: input.teamId,
    before: { team_id: previousTeamId },
    after: { team_id: input.teamId, team_name: team.name },
  });
}

export async function removeTeamMember(input: {
  userEmail: string;
  actorEmail: string;
}): Promise<void> {
  requirePostgres();
  const email = input.userEmail.toLowerCase();
  const rows = await query(
    `DELETE FROM time_clock_team_members
     WHERE user_email = $1
     RETURNING team_id`,
    [email]
  );
  if (!rows[0]) return;

  await logTimeClockAudit({
    actorEmail: input.actorEmail,
    action: "team.member_removed",
    entityType: "team_member",
    entityId: email,
    subjectEmail: email,
    teamId: String(rows[0].team_id),
    before: { team_id: String(rows[0].team_id) },
    after: {},
  });
}

export async function getTeamIdForUser(userEmail: string): Promise<string | null> {
  requirePostgres();
  const rows = await query<{ team_id: string }>(
    `SELECT team_id FROM time_clock_team_members WHERE user_email = $1`,
    [userEmail.toLowerCase()]
  );
  return rows[0] ? String(rows[0].team_id) : null;
}

export async function listSupervisorsForUser(
  userEmail: string
): Promise<Array<{ email: string; name: string }>> {
  requirePostgres();
  const rows = await query<{ email: string; name: string }>(
    `SELECT DISTINCT lower(t.supervisor_email::text) AS email,
            coalesce(nullif(sup.name, ''), t.supervisor_email::text) AS name
     FROM time_clock_team_members m
     JOIN time_clock_teams t ON t.id = m.team_id
     LEFT JOIN users sup ON sup.email = t.supervisor_email
     WHERE m.user_email = $1
       AND t.active = true
       AND t.supervisor_email IS NOT NULL`,
    [userEmail.toLowerCase()]
  );
  return rows
    .map((row) => ({
      email: String(row.email || "").toLowerCase(),
      name: String(row.name || row.email),
    }))
    .filter((row) => row.email.includes("@"));
}

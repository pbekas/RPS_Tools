import { NextResponse } from "next/server";
import {
  apiRequireAdmin,
  apiRequireTeamManager,
} from "@/lib/requireAccess";
import { listUsers } from "@/lib/database";
import {
  createTimeClockTeam,
  listTimeClockTeamsWithMembers,
} from "@/lib/timeClockTeamsDb";

export async function GET() {
  const { error, access } = await apiRequireTeamManager();
  if (error) return error;
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [teams, users, allTeams] = await Promise.all([
      listTimeClockTeamsWithMembers({
        activeOnly: false,
        teamIds: access.isAdmin ? null : access.teamIds,
      }),
      listUsers(),
      access.isAdmin
        ? Promise.resolve([])
        : listTimeClockTeamsWithMembers({ activeOnly: true, teamIds: null }),
    ]);
    const assigned = new Set(
      (access.isAdmin ? teams : allTeams).flatMap((team) =>
        (team.members || []).map((member) => member.user_email.toLowerCase())
      )
    );
    const allowed = new Set(
      access.isAdmin
        ? users.map((user) => user.email.toLowerCase())
        : [
            ...(access.visibleUserEmails || []),
            ...users
              .filter(
                (user) =>
                  user.active !== false &&
                  !assigned.has(user.email.toLowerCase())
              )
              .map((user) => user.email.toLowerCase()),
          ]
    );
    return NextResponse.json({
      teams,
      users: users
        .filter(
          (user) =>
            user.active !== false && allowed.has(user.email.toLowerCase())
        )
        .map((user) => ({
          email: user.email,
          name: user.name || user.email,
          role: user.role || "Agent",
        })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list teams" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { session, error } = await apiRequireAdmin();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const slug = body.slug ? String(body.slug).trim() : undefined;
  const supervisorEmail = body.supervisor_email
    ? String(body.supervisor_email).trim().toLowerCase()
    : null;

  if (!name) {
    return NextResponse.json({ error: "Team name is required" }, { status: 400 });
  }

  try {
    const team = await createTimeClockTeam({
      name,
      slug,
      supervisorEmail,
      actorEmail: session.user.email!,
    });
    return NextResponse.json({ team });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create team" },
      { status: 400 }
    );
  }
}

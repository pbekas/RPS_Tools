import { NextResponse } from "next/server";
import {
  apiRequireAdmin,
  apiRequireTimeClockManager,
} from "@/lib/requireAccess";
import {
  createTimeClockTeam,
  listTimeClockTeams,
} from "@/lib/timeClockTeamsDb";
import { listUsersWithTimeClockAccess } from "@/lib/timeClockDb";

export async function GET() {
  const { session, error, access } = await apiRequireTimeClockManager();
  if (error) return error;

  try {
    const teams = await listTimeClockTeams({
      activeOnly: false,
      teamIds: access!.teamIds,
    });
    const users = await listUsersWithTimeClockAccess();
    return NextResponse.json({ teams, users });
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

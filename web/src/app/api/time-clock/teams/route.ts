import { NextResponse } from "next/server";
import { apiRequireAdmin } from "@/lib/requireAccess";
import { listUsers } from "@/lib/database";
import {
  createTimeClockTeam,
  listTimeClockTeamsWithMembers,
} from "@/lib/timeClockTeamsDb";

export async function GET() {
  const { error } = await apiRequireAdmin();
  if (error) return error;

  try {
    const [teams, users] = await Promise.all([
      listTimeClockTeamsWithMembers({ activeOnly: false, teamIds: null }),
      listUsers(),
    ]);
    return NextResponse.json({
      teams,
      users: users
        .filter((user) => user.active !== false)
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

import { NextResponse } from "next/server";
import { apiRequireAdmin } from "@/lib/requireAccess";
import {
  getTimeClockTeam,
  removeTeamMember,
  setTeamMember,
  updateTimeClockTeam,
} from "@/lib/timeClockTeamsDb";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { error } = await apiRequireAdmin();
  if (error) return error;
  const { id } = await context.params;
  try {
    const team = await getTimeClockTeam(id);
    if (!team) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ team });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load team" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const { session, error } = await apiRequireAdmin();
  if (error) return error;
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "update");

  try {
    if (action === "assign_member") {
      await setTeamMember({
        teamId: id,
        userEmail: String(body.user_email || ""),
        actorEmail: session.user.email!,
      });
      const team = await getTimeClockTeam(id);
      return NextResponse.json({ team });
    }
    if (action === "remove_member") {
      await removeTeamMember({
        userEmail: String(body.user_email || ""),
        actorEmail: session.user.email!,
      });
      const team = await getTimeClockTeam(id);
      return NextResponse.json({ team });
    }

    const team = await updateTimeClockTeam({
      teamId: id,
      name: body.name ? String(body.name) : undefined,
      supervisorEmail:
        body.supervisor_email !== undefined
          ? body.supervisor_email
            ? String(body.supervisor_email)
            : null
          : undefined,
      active: typeof body.active === "boolean" ? body.active : undefined,
      actorEmail: session.user.email!,
    });
    return NextResponse.json({ team });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 }
    );
  }
}

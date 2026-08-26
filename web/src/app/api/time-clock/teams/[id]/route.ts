import { NextResponse } from "next/server";
import { apiRequireTeamManager } from "@/lib/requireAccess";
import {
  getTeamIdForUser,
  getTimeClockTeam,
  removeTeamMember,
  setTeamMember,
  updateTimeClockTeam,
} from "@/lib/timeClockTeamsDb";
import type { TimeClockAccess } from "@/lib/timeClockAccess";

type RouteContext = { params: Promise<{ id: string }> };

function canManageTeamMembers(access: TimeClockAccess, teamId: string): boolean {
  if (access.isAdmin) return true;
  return (access.teamIds || []).includes(teamId);
}

export async function GET(_req: Request, context: RouteContext) {
  const { error, access } = await apiRequireTeamManager();
  if (error) return error;
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  if (!canManageTeamMembers(access, id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
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
  const { session, error, access } = await apiRequireTeamManager();
  if (error) return error;
  if (!session || !access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "update");

  try {
    if (action === "assign_member" || action === "remove_member") {
      if (!canManageTeamMembers(access, id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const email = String(body.user_email || "").trim().toLowerCase();
      if (!email) {
        return NextResponse.json({ error: "user_email is required" }, { status: 400 });
      }
      const current = await getTimeClockTeam(id);
      if (!current) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (action === "assign_member") {
        if (!access.isAdmin) {
          const existingTeamId = await getTeamIdForUser(email);
          if (existingTeamId && existingTeamId !== id) {
            return NextResponse.json(
              { error: "That person is already on another team" },
              { status: 403 }
            );
          }
        }
        await setTeamMember({
          teamId: id,
          userEmail: email,
          actorEmail: session.user.email!,
        });
      } else {
        const onTeam = (current.members || []).some(
          (member) => member.user_email.toLowerCase() === email
        );
        if (!onTeam) {
          return NextResponse.json(
            { error: "That person is not on this team" },
            { status: 400 }
          );
        }
        await removeTeamMember({
          userEmail: email,
          actorEmail: session.user.email!,
        });
      }
      const team = await getTimeClockTeam(id);
      return NextResponse.json({ team });
    }

    if (!access.isAdmin) {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
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

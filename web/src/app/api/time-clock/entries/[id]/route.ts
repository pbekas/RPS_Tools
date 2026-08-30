import { NextResponse } from "next/server";
import { canViewTimeClockUser, resolveTimeClockAccess } from "@/lib/timeClockAccess";
import { apiRequireModule } from "@/lib/requireAccess";
import {
  createEditRequest,
  getTimeEntry,
  managerEditTimeEntry,
  updateEntryNotes,
} from "@/lib/timeClockDb";
import { listTimeClockAuditForEntry } from "@/lib/timeClockAudit";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: RouteContext) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { id } = await context.params;
  const access = await resolveTimeClockAccess(session!.user);
  const wantHistory = new URL(req.url).searchParams.get("history") === "1";

  try {
    const entry = await getTimeEntry(id);
    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (!canViewTimeClockUser(access, entry.user_email)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (!wantHistory) {
      return NextResponse.json({ entry });
    }
    if (!access.isManager) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const history = await listTimeClockAuditForEntry(id, {
      teamIds: access.teamIds,
      allowedSubjectEmails: access.visibleUserEmails,
    });
    return NextResponse.json({ entry, history });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load entry" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, context: RouteContext) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const access = await resolveTimeClockAccess(session!.user);
  const email = session!.user!.email!;

  try {
    if (typeof body.clock_in === "string") {
      if (!access.isManager) {
        return NextResponse.json({ error: "Manager access required" }, { status: 403 });
      }
      const existing = await getTimeEntry(id);
      if (!existing) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      if (!canViewTimeClockUser(access, existing.user_email)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const entry = await managerEditTimeEntry({
        entryId: id,
        actorEmail: email,
        clockIn: body.clock_in,
        clockOut:
          body.clock_out === undefined || body.clock_out === null || body.clock_out === ""
            ? null
            : String(body.clock_out),
        notes: typeof body.notes === "string" ? body.notes : existing.notes,
        reason: typeof body.reason === "string" ? body.reason : "",
      });
      return NextResponse.json({ entry });
    }
    if (typeof body.notes === "string") {
      const existing = await getTimeEntry(id);
      if (!existing) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const asManager =
        access.isManager && canViewTimeClockUser(access, existing.user_email);
      if (
        !asManager &&
        existing.user_email.toLowerCase() !== email.toLowerCase()
      ) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const entry = await updateEntryNotes(id, email, body.notes, asManager);
      return NextResponse.json({ entry });
    }
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 }
    );
  }
}

export async function POST(req: Request, context: RouteContext) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { id } = await context.params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  if (action !== "request_edit") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const request = await createEditRequest({
      entryId: id,
      requestedBy: session!.user!.email!,
      proposedClockIn: String(body.proposed_clock_in || ""),
      proposedClockOut: body.proposed_clock_out ? String(body.proposed_clock_out) : null,
      proposedNotes: typeof body.proposed_notes === "string" ? body.proposed_notes : "",
      reason: typeof body.reason === "string" ? body.reason : "",
    });
    return NextResponse.json({ request });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Edit request failed" },
      { status: 400 }
    );
  }
}

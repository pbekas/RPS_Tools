import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import {
  createEditRequest,
  getTimeEntry,
  updateEntryNotes,
} from "@/lib/timeClockDb";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteContext) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { id } = await context.params;
  try {
    const entry = await getTimeEntry(id);
    if (!entry) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const admin = isAdmin(session!.user);
    if (!admin && entry.user_email.toLowerCase() !== session!.user!.email!.toLowerCase()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ entry });
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
  const admin = isAdmin(session!.user);
  const email = session!.user!.email!;

  try {
    if (typeof body.notes === "string") {
      const entry = await updateEntryNotes(id, email, body.notes, admin);
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

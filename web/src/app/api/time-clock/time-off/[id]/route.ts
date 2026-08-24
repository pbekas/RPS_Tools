import { NextResponse } from "next/server";
import { canViewTimeClockUser, resolveTimeClockAccess } from "@/lib/timeClockAccess";
import { apiRequireModule } from "@/lib/requireAccess";
import {
  deleteTimeOffEntry,
  getTimeOffBank,
  getTimeOffEntryById,
  reviewTimeOffEntry,
} from "@/lib/timeOffDb";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: Request, context: RouteContext) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const access = await resolveTimeClockAccess(session!.user!);
  if (!access.isManager) {
    return NextResponse.json({ error: "Manager access required" }, { status: 403 });
  }

  const { id } = await context.params;
  const existing = await getTimeOffEntryById(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!canViewTimeClockUser(access, existing.user_email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const notes = typeof body.review_notes === "string" ? body.review_notes : "";
  if (action !== "approve" && action !== "deny") {
    return NextResponse.json({ error: "action must be approve or deny" }, { status: 400 });
  }

  try {
    const entry = await reviewTimeOffEntry({
      id,
      approve: action === "approve",
      reviewerEmail: session!.user!.email!,
      notes,
    });
    const bank = await getTimeOffBank(
      existing.user_email,
      Number(existing.entry_date.slice(0, 4))
    );
    return NextResponse.json({ entry, bank });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Review failed" },
      { status: 400 }
    );
  }
}

export async function DELETE(_req: Request, context: RouteContext) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { id } = await context.params;
  const access = await resolveTimeClockAccess(session!.user!);
  const existing = await getTimeOffEntryById(id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userEmail = existing.user_email.toLowerCase();
  if (!canViewTimeClockUser(access, userEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!access.isManager && userEmail !== session!.user!.email!.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteTimeOffEntry(id, userEmail, session!.user!.email!, {
      asManager: access.isManager,
    });
    const bank = await getTimeOffBank(userEmail, Number(existing.entry_date.slice(0, 4)));
    return NextResponse.json({ ok: true, bank });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 400 }
    );
  }
}

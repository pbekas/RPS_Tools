import { NextResponse } from "next/server";
import { canViewTimeClockUser, resolveTimeClockAccess } from "@/lib/timeClockAccess";
import { apiRequireModule } from "@/lib/requireAccess";
import { deleteTimeOffEntry } from "@/lib/timeOffDb";
import { query } from "@/lib/postgres";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, context: RouteContext) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { id } = await context.params;
  const access = await resolveTimeClockAccess(session!.user!);

  const rows = await query<{ user_email: string }>(
    `SELECT user_email FROM time_off_entries WHERE id = $1`,
    [id]
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userEmail = String(rows[0].user_email).toLowerCase();
  if (!canViewTimeClockUser(access, userEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!access.isManager && userEmail !== session!.user!.email!.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteTimeOffEntry(id, userEmail, session!.user!.email!);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 400 }
    );
  }
}

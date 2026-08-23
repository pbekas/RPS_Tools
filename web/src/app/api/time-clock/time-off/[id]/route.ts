import { NextResponse } from "next/server";
import { canViewTimeClockUser, resolveTimeClockAccess } from "@/lib/timeClockAccess";
import { apiRequireModule } from "@/lib/requireAccess";
import { deleteTimeOffEntry, getTimeOffBank } from "@/lib/timeOffDb";
import { query } from "@/lib/postgres";

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, context: RouteContext) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { id } = await context.params;
  const access = await resolveTimeClockAccess(session!.user!);

  const rows = await query<{ user_email: string; entry_date: Date | string }>(
    `SELECT user_email, entry_date FROM time_off_entries WHERE id = $1`,
    [id]
  );
  if (!rows[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const userEmail = String(rows[0].user_email).toLowerCase();
  const entryDate =
    rows[0].entry_date instanceof Date
      ? rows[0].entry_date.toISOString().slice(0, 10)
      : String(rows[0].entry_date).slice(0, 10);
  if (!canViewTimeClockUser(access, userEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!access.isManager && userEmail !== session!.user!.email!.toLowerCase()) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await deleteTimeOffEntry(id, userEmail, session!.user!.email!);
    const bank = await getTimeOffBank(userEmail, Number(entryDate.slice(0, 4)));
    return NextResponse.json({ ok: true, bank });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 400 }
    );
  }
}

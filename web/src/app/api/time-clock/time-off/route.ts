import { NextResponse } from "next/server";
import { canViewTimeClockUser, resolveTimeClockAccess } from "@/lib/timeClockAccess";
import { apiRequireModule } from "@/lib/requireAccess";
import { getEffectiveTimezone } from "@/lib/timeClockDb";
import { weekRangeFromStart } from "@/lib/timeClockFormat";
import {
  getTimeOffBank,
  isTimeOffKind,
  listTimeOffEntries,
  upsertTimeOffEntry,
} from "@/lib/timeOffDb";

export async function GET(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get("week_start");
  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");
  const requestedUser = searchParams.get("userEmail");
  const access = await resolveTimeClockAccess(session!.user!);
  const userEmail =
    access.isManager && requestedUser
      ? requestedUser.toLowerCase()
      : session!.user!.email!.toLowerCase();

  if (!canViewTimeClockUser(access, userEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    let from = fromDate;
    let to = toDate;
    if (weekStart) {
      const userTz = await getEffectiveTimezone(userEmail);
      const range = weekRangeFromStart(weekStart, userTz);
      from = weekStart;
      to = range.week_end;
    }
    if (!from || !to) {
      return NextResponse.json(
        { error: "week_start or from/to date range is required" },
        { status: 400 }
      );
    }
    const entries = await listTimeOffEntries(userEmail, from, to);
    const year = Number((from || "").slice(0, 4)) || new Date().getFullYear();
    const bank = await getTimeOffBank(userEmail, year);
    return NextResponse.json({ entries, bank });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load time off" },
      { status: 400 }
    );
  }
}

export async function POST(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const access = await resolveTimeClockAccess(session!.user!);
  const requestedUser =
    typeof body.user_email === "string" ? body.user_email.toLowerCase() : "";
  const userEmail =
    access.isManager && requestedUser
      ? requestedUser
      : session!.user!.email!.toLowerCase();

  if (!canViewTimeClockUser(access, userEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const entryDate = String(body.entry_date || "").slice(0, 10);
  const kind = String(body.kind || "pto");
  const hours = Number(body.hours ?? 8);
  const notes = typeof body.notes === "string" ? body.notes : "";

  if (!entryDate) {
    return NextResponse.json({ error: "entry_date is required" }, { status: 400 });
  }
  if (!isTimeOffKind(kind)) {
    return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
  }

  try {
    const entry = await upsertTimeOffEntry({
      userEmail,
      entryDate,
      kind,
      hours,
      notes,
      actorEmail: session!.user!.email!,
    });
    const bank = await getTimeOffBank(userEmail, Number(entryDate.slice(0, 4)));
    return NextResponse.json({ entry, bank });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 400 }
    );
  }
}

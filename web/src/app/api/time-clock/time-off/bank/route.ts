import { NextResponse } from "next/server";
import { canViewTimeClockUser, resolveTimeClockAccess } from "@/lib/timeClockAccess";
import {
  apiRequireModule,
  apiRequireTimeClockManager,
} from "@/lib/requireAccess";
import {
  getTimeOffBank,
  listTimeOffBanks,
  setTimeOffBankAllotment,
} from "@/lib/timeOffDb";

export async function GET(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") || new Date().getFullYear());
  const view = searchParams.get("view");
  const requestedUser = searchParams.get("userEmail");
  const access = await resolveTimeClockAccess(session!.user!);

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  try {
    if (view === "team") {
      if (!access.isManager) {
        return NextResponse.json({ error: "Manager access required" }, { status: 403 });
      }
      const banks = await listTimeOffBanks(year, access.visibleUserEmails);
      return NextResponse.json({ banks, year });
    }

    const userEmail =
      access.isManager && requestedUser
        ? requestedUser.toLowerCase()
        : session!.user!.email!.toLowerCase();

    if (!canViewTimeClockUser(access, userEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bank = await getTimeOffBank(userEmail, year);
    return NextResponse.json({ bank });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load bank" },
      { status: 400 }
    );
  }
}

export async function PATCH(req: Request) {
  const { session, error, access } = await apiRequireTimeClockManager();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const userEmail = String(body.user_email || "").toLowerCase();
  const year = Number(body.year || new Date().getFullYear());
  const allottedHours = Number(body.allotted_hours);
  const notes = typeof body.notes === "string" ? body.notes : "";

  if (!userEmail) {
    return NextResponse.json({ error: "user_email is required" }, { status: 400 });
  }
  if (!canViewTimeClockUser(access!, userEmail)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const bank = await setTimeOffBankAllotment({
      userEmail,
      year,
      allottedHours,
      notes,
      actorEmail: session!.user!.email!,
    });
    return NextResponse.json({ bank });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 }
    );
  }
}

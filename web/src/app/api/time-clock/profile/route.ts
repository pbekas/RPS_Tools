import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import {
  getTimeClockProfile,
  setUserTimezone,
} from "@/lib/timeClockDb";
import { isValidTimeClockTimezone } from "@/lib/timeClockTimezones";

export async function GET() {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  try {
    const profile = await getTimeClockProfile(session!.user!.email!.toLowerCase());
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load profile" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const timezone = typeof body.timezone === "string" ? body.timezone.trim() : "";
  if (!timezone || !isValidTimeClockTimezone(timezone)) {
    return NextResponse.json({ error: "Invalid timezone" }, { status: 400 });
  }

  try {
    const email = session!.user!.email!.toLowerCase();
    await setUserTimezone(email, timezone);
    const profile = await getTimeClockProfile(email);
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 400 }
    );
  }
}

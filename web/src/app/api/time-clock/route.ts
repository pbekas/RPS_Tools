import { NextResponse } from "next/server";
import { apiRequireModule } from "@/lib/requireAccess";
import {
  clockIn,
  clockOut,
  getPunchStatus,
  getTimeClockSettings,
} from "@/lib/timeClockDb";

export async function GET() {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  try {
    const [status, settings] = await Promise.all([
      getPunchStatus(session!.user!.email!),
      getTimeClockSettings(),
    ]);
    return NextResponse.json({ status, settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load status" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const email = session!.user!.email!.toLowerCase();
  const notes = typeof body.notes === "string" ? body.notes : "";

  try {
    if (action === "clock_in") {
      const entry = await clockIn(email);
      const status = await getPunchStatus(email);
      return NextResponse.json({ entry, status });
    }
    if (action === "clock_out") {
      const entry = await clockOut(email, notes);
      const status = await getPunchStatus(email);
      return NextResponse.json({ entry, status });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 400 }
    );
  }
}

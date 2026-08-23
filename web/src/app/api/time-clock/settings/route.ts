import { NextResponse } from "next/server";
import { apiRequireAdmin, apiRequireModule } from "@/lib/requireAccess";
import {
  getTimeClockSettings,
  updateTimeClockSettings,
} from "@/lib/timeClockDb";

export async function GET() {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  try {
    const settings = await getTimeClockSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load settings" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await apiRequireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const patch: {
    max_open_hours?: number;
    reminder_enabled?: boolean;
    timezone?: string;
  } = {};

  if (body.max_open_hours != null) {
    const hours = Number(body.max_open_hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
      return NextResponse.json({ error: "Invalid max_open_hours" }, { status: 400 });
    }
    patch.max_open_hours = hours;
  }
  if (typeof body.reminder_enabled === "boolean") {
    patch.reminder_enabled = body.reminder_enabled;
  }
  if (typeof body.timezone === "string" && body.timezone.trim()) {
    patch.timezone = body.timezone.trim();
  }

  try {
    const settings = await updateTimeClockSettings(patch, session!.user!.email!);
    return NextResponse.json({ settings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Update failed" },
      { status: 500 }
    );
  }
}

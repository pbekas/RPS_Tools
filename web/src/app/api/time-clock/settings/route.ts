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
    remind_clock_in_enabled?: boolean;
    remind_clock_in_after?: string;
    remind_clock_out_enabled?: boolean;
    remind_clock_out_after?: string;
    remind_timesheet_enabled?: boolean;
    remind_timesheet_weekday?: number;
    remind_timesheet_after?: string;
    pay_period_anchor_date?: string;
    pay_period_length_days?: number;
    default_annual_pto_hours?: number;
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
  if (typeof body.remind_clock_in_enabled === "boolean") {
    patch.remind_clock_in_enabled = body.remind_clock_in_enabled;
  }
  if (typeof body.remind_clock_in_after === "string" && /^\d{2}:\d{2}$/.test(body.remind_clock_in_after)) {
    patch.remind_clock_in_after = body.remind_clock_in_after;
  }
  if (typeof body.remind_clock_out_enabled === "boolean") {
    patch.remind_clock_out_enabled = body.remind_clock_out_enabled;
  }
  if (typeof body.remind_clock_out_after === "string" && /^\d{2}:\d{2}$/.test(body.remind_clock_out_after)) {
    patch.remind_clock_out_after = body.remind_clock_out_after;
  }
  if (typeof body.remind_timesheet_enabled === "boolean") {
    patch.remind_timesheet_enabled = body.remind_timesheet_enabled;
  }
  if (body.remind_timesheet_weekday != null) {
    const weekday = Number(body.remind_timesheet_weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return NextResponse.json({ error: "Invalid remind_timesheet_weekday" }, { status: 400 });
    }
    patch.remind_timesheet_weekday = weekday;
  }
  if (typeof body.remind_timesheet_after === "string" && /^\d{2}:\d{2}$/.test(body.remind_timesheet_after)) {
    patch.remind_timesheet_after = body.remind_timesheet_after;
  }
  if (typeof body.pay_period_anchor_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.pay_period_anchor_date)) {
    patch.pay_period_anchor_date = body.pay_period_anchor_date;
  }
  if (body.pay_period_length_days != null) {
    const days = Number(body.pay_period_length_days);
    if (!Number.isInteger(days) || days < 7 || days > 31) {
      return NextResponse.json({ error: "Invalid pay_period_length_days" }, { status: 400 });
    }
    patch.pay_period_length_days = days;
  }
  if (body.default_annual_pto_hours != null) {
    const hours = Number(body.default_annual_pto_hours);
    if (!Number.isFinite(hours) || hours < 0 || hours > 2000) {
      return NextResponse.json({ error: "Invalid default_annual_pto_hours" }, { status: 400 });
    }
    patch.default_annual_pto_hours = hours;
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

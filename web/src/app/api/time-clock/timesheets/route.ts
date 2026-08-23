import { NextResponse } from "next/server";
import { canViewTimeClockUser, resolveTimeClockAccess } from "@/lib/timeClockAccess";
import {
  apiRequireModule,
  apiRequireTimeClockManager,
} from "@/lib/requireAccess";
import {
  getWeeklyTimesheetDetail,
  listSubmittedTimesheets,
  reviewWeeklyTimesheet,
  submitWeeklyTimesheet,
} from "@/lib/timeClockDb";

export async function GET(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get("week_start");
  const view = searchParams.get("view");
  const access = await resolveTimeClockAccess(session!.user);

  try {
    if (view === "pending") {
      if (!access.isManager) {
        return NextResponse.json({ error: "Manager access required" }, { status: 403 });
      }
      const timesheets = await listSubmittedTimesheets(100, access.visibleUserEmails);
      return NextResponse.json({ timesheets });
    }

    if (!weekStart) {
      return NextResponse.json({ error: "week_start is required" }, { status: 400 });
    }

    const requestedUser = searchParams.get("userEmail");
    const userEmail =
      access.isManager && requestedUser
        ? requestedUser.toLowerCase()
        : session!.user!.email!.toLowerCase();

    if (!canViewTimeClockUser(access, userEmail)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const timesheet = await getWeeklyTimesheetDetail(userEmail, weekStart);
    return NextResponse.json({ timesheet });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load timesheet" },
      { status: 400 }
    );
  }
}

export async function POST(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const weekStart = String(body.week_start || "");

  if (!weekStart) {
    return NextResponse.json({ error: "week_start is required" }, { status: 400 });
  }

  try {
    if (action === "submit") {
      const timesheet = await submitWeeklyTimesheet(
        session!.user!.email!.toLowerCase(),
        weekStart
      );
      return NextResponse.json({ timesheet });
    }

    if (action === "approve" || action === "reject") {
      const managerResult = await apiRequireTimeClockManager();
      if (managerResult.error) return managerResult.error;
      const userEmail = String(body.user_email || "").toLowerCase();
      if (!userEmail) {
        return NextResponse.json({ error: "user_email is required" }, { status: 400 });
      }
      if (!canViewTimeClockUser(managerResult.access!, userEmail)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const timesheet = await reviewWeeklyTimesheet({
        userEmail,
        weekStart,
        reviewerEmail: session!.user!.email!,
        approve: action === "approve",
        reviewNotes: typeof body.review_notes === "string" ? body.review_notes : "",
      });
      return NextResponse.json({ timesheet });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed" },
      { status: 400 }
    );
  }
}

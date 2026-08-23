import { NextResponse } from "next/server";
import { canViewTimeClockUser } from "@/lib/timeClockAccess";
import { apiRequireModule, apiRequireTimeClockManager } from "@/lib/requireAccess";
import { listEditRequests, reviewEditRequest } from "@/lib/timeClockDb";

export async function GET(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const managerResult = await apiRequireTimeClockManager();
  const access = managerResult.access;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;

  try {
    if (access?.isManager) {
      const requests = await listEditRequests({
        status,
        userEmails: access.visibleUserEmails,
        limit: 100,
      });
      return NextResponse.json({ requests });
    }
    const requests = await listEditRequests({
      status,
      userEmail: session!.user!.email!,
      limit: 100,
    });
    return NextResponse.json({ requests });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list requests" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const { session, error, access } = await apiRequireTimeClockManager();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const requestId = String(body.request_id || "");

  if (!requestId) {
    return NextResponse.json({ error: "request_id required" }, { status: 400 });
  }

  try {
    if (action === "approve" || action === "reject") {
      const pending = await listEditRequests({ limit: 200 });
      const target = pending.find((r) => r.id === requestId);
      if (!target) {
        return NextResponse.json({ error: "Request not found" }, { status: 404 });
      }
      const subject = target.entry?.user_email || target.requested_by;
      if (!canViewTimeClockUser(access!, subject)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      const request = await reviewEditRequest({
        requestId,
        reviewerEmail: session!.user!.email!,
        approve: action === "approve",
        reviewNotes: typeof body.review_notes === "string" ? body.review_notes : "",
      });
      return NextResponse.json({ request });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Review failed" },
      { status: 400 }
    );
  }
}

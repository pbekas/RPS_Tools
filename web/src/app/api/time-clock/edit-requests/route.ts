import { NextResponse } from "next/server";
import { apiRequireAdmin, apiRequireModule } from "@/lib/requireAccess";
import { isAdmin } from "@/lib/permissions";
import { listEditRequests, reviewEditRequest } from "@/lib/timeClockDb";

export async function GET(req: Request) {
  const { session, error } = await apiRequireModule("time_clock");
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const admin = isAdmin(session!.user);

  try {
    const requests = await listEditRequests({
      status,
      userEmail: admin ? null : session!.user!.email!,
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
  const { session, error } = await apiRequireAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const requestId = String(body.request_id || "");

  if (!requestId) {
    return NextResponse.json({ error: "request_id required" }, { status: 400 });
  }

  try {
    if (action === "approve" || action === "reject") {
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

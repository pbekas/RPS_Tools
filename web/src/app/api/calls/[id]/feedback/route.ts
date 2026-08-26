import { NextResponse } from "next/server";
import { saveManagerReview } from "@/lib/database";
import { apiRequireCallQaManageCall } from "@/lib/requireAccess";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { session, error } = await apiRequireCallQaManageCall(id);
  if (error) return error;
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  await saveManagerReview({
    callId: id,
    managerFeedback: String(body.manager_feedback || ""),
    managerNotes: String(body.manager_notes || ""),
    reviewerEmail: session.user.email!,
    reviewerName: session.user.name || session.user.email!,
  });
  return NextResponse.json({ ok: true });
}

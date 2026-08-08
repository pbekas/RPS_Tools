import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { saveManagerReview } from "@/lib/database";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const { id } = await context.params;
  const body = await req.json();
  await saveManagerReview({
    callId: id,
    managerFeedback: String(body.manager_feedback || ""),
    managerNotes: String(body.manager_notes || ""),
    reviewerEmail: session.user.email,
    reviewerName: session.user.name || session.user.email,
  });
  return NextResponse.json({ ok: true });
}

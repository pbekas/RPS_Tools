import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listCalls } from "@/lib/firestore";
import { buildIssueHeatmap } from "@/lib/qa";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(searchParams.get("days")) || 14));
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const calls = await listCalls({
    status: "complete",
    limit: 500,
    sinceMs,
  });

  return NextResponse.json({
    days,
    call_count: calls.length,
    heatmap: buildIssueHeatmap(calls),
  });
}

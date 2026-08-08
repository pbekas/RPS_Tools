import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { PollerError, pollerJson } from "@/lib/poller";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  _req: Request,
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
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing call id" }, { status: 400 });
  }

  try {
    const result = await pollerJson<{
      status: string;
      call_id: string;
      quality_score?: number;
      has_critical_flags?: boolean;
    }>(`/ops/reanalyze/${encodeURIComponent(id)}`, { method: "POST" });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PollerError) {
      return NextResponse.json({ error: err.detail }, { status: err.status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Re-analyze failed" },
      { status: 500 }
    );
  }
}

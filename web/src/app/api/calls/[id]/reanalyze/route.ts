import { NextResponse } from "next/server";
import { PollerError, pollerJson } from "@/lib/poller";
import { apiRequireCallQaManageCall } from "@/lib/requireAccess";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Missing call id" }, { status: 400 });
  }
  const { error } = await apiRequireCallQaManageCall(id);
  if (error) return error;

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

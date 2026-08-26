import { NextResponse } from "next/server";
import { listCalls, listUsers } from "@/lib/database";
import { buildIssueHeatmap, filterMappedQaCalls } from "@/lib/qa";
import { apiRequireCallQaManager } from "@/lib/requireAccess";

export async function GET(req: Request) {
  const { error, scope } = await apiRequireCallQaManager();
  if (error) return error;
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const days = Math.min(90, Math.max(1, Number(searchParams.get("days")) || 14));
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const [rawCalls, users] = await Promise.all([
    listCalls({
      status: "complete",
      limit: 500,
      sinceMs,
      agentEmails: scope.agentEmails,
    }),
    listUsers(),
  ]);
  const calls = filterMappedQaCalls(rawCalls, users);

  return NextResponse.json({
    days,
    call_count: calls.length,
    heatmap: buildIssueHeatmap(calls),
  });
}

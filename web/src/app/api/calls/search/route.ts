import { NextResponse } from "next/server";
import { searchCalls } from "@/lib/database";
import { apiRequireCallQaManager } from "@/lib/requireAccess";

export async function GET(req: Request) {
  const { error, scope } = await apiRequireCallQaManager();
  if (error) return error;
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const days = Number(searchParams.get("days") || "30");
  const fromMs = Number(searchParams.get("fromMs") || "");
  const toMs = Number(searchParams.get("toMs") || "");
  const q = searchParams.get("q");
  const status = searchParams.get("status");
  const agent = searchParams.get("agent");
  const hasRecordingParam = searchParams.get("hasRecording");
  const limit = Math.min(Number(searchParams.get("limit") || "100"), 200);
  const offset = Math.max(0, Number(searchParams.get("offset") || "0"));

  let hasRecording: boolean | null = null;
  if (hasRecordingParam === "1" || hasRecordingParam === "true") hasRecording = true;
  if (hasRecordingParam === "0" || hasRecordingParam === "false") hasRecording = false;

  const calls = await searchCalls({
    limit: limit + 1,
    offset,
    days:
      Number.isFinite(fromMs) && fromMs > 0
        ? null
        : Number.isFinite(days) && days > 0
          ? Math.min(days, 365)
          : 30,
    fromMs: Number.isFinite(fromMs) && fromMs > 0 ? fromMs : null,
    toMs: Number.isFinite(toMs) && toMs > 0 ? toMs : null,
    q,
    status: status || "complete",
    agentEmail: agent || null,
    agentEmails: scope.agentEmails,
    hasRecording,
    requireMinDuration: false,
  });
  const hasMore = calls.length > limit;
  return NextResponse.json({
    calls: hasMore ? calls.slice(0, limit) : calls,
    hasMore,
    offset,
    limit,
  });
}

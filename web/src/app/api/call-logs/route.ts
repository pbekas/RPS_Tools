import { NextResponse } from "next/server";
import { listCallLogs, listUsers, summarizeCallLogs } from "@/lib/database";
import { filterCallLogsForPeople } from "@/lib/callLogs";
import { apiRequireCallQaManager } from "@/lib/requireAccess";
import { canViewCallAgent } from "@/lib/orgTeamAccess";

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
  const result = searchParams.get("result");
  const direction = searchParams.get("direction");
  const recordedParam = searchParams.get("recorded");
  const missedOnly = searchParams.get("missed") === "1";
  const unrecordedOnly = searchParams.get("unrecorded") === "1";
  const missingQaOnly = searchParams.get("missingQa") === "1";
  const limit = Math.min(Number(searchParams.get("limit") || "100"), 200);
  const offset = Math.max(0, Number(searchParams.get("offset") || "0"));

  let recorded: boolean | null = null;
  if (recordedParam === "true" || recordedParam === "1") recorded = true;
  if (recordedParam === "false" || recordedParam === "0") recorded = false;

  const rawLogs = await listCallLogs({
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
    result,
    direction,
    recorded,
    missedOnly,
    unrecordedOnly,
    missingQaOnly,
  });
  const people = scope.agentEmails
    ? (await listUsers()).filter((user) => canViewCallAgent(scope, user.email))
    : null;
  const scoped = filterCallLogsForPeople(rawLogs, people);
  const hasMore = scoped.length > limit;
  const logs = hasMore ? scoped.slice(0, limit) : scoped;
  const stats = summarizeCallLogs(logs);
  return NextResponse.json({ logs, stats, hasMore, offset, limit });
}

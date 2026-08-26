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
  const days = Number(searchParams.get("days") || "7");
  const result = searchParams.get("result");
  const direction = searchParams.get("direction");
  const recordedParam = searchParams.get("recorded");
  const missedOnly = searchParams.get("missed") === "1";
  const unrecordedOnly = searchParams.get("unrecorded") === "1";
  const limit = Math.min(Number(searchParams.get("limit") || "300"), 1000);

  let recorded: boolean | null = null;
  if (recordedParam === "true" || recordedParam === "1") recorded = true;
  if (recordedParam === "false" || recordedParam === "0") recorded = false;

  const rawLogs = await listCallLogs({
    limit,
    days: Number.isFinite(days) && days > 0 ? days : 7,
    result,
    direction,
    recorded,
    missedOnly,
    unrecordedOnly,
  });
  const people = scope.agentEmails
    ? (await listUsers()).filter((user) => canViewCallAgent(scope, user.email))
    : null;
  const logs = filterCallLogsForPeople(rawLogs, people);
  const stats = summarizeCallLogs(logs);
  return NextResponse.json({ logs, stats });
}

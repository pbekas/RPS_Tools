import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listCallLogs, summarizeCallLogs } from "@/lib/database";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if ((session.user.role || "").toLowerCase() !== "admin") {
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

  const logs = await listCallLogs({
    limit,
    days: Number.isFinite(days) && days > 0 ? days : 7,
    result,
    direction,
    recorded,
    missedOnly,
    unrecordedOnly,
  });
  const stats = summarizeCallLogs(logs);
  return NextResponse.json({ logs, stats });
}

import { NextResponse } from "next/server";
import { listApprovalHistory } from "@/lib/approvalHistory";
import { canViewTimeClockUser } from "@/lib/timeClockAccess";
import { getTimeClockSettings } from "@/lib/timeClockDb";
import { apiRequireTimeClockManager } from "@/lib/requireAccess";
import type { ApprovalHistoryType } from "@/lib/timeClockTypes";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const TYPES = new Set(["all", "timesheet", "edit", "timeoff"]);
const STATUSES = new Set(["all", "approved", "denied"]);

export async function GET(req: Request) {
  const { error, access } = await apiRequireTimeClockManager();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const typeRaw = searchParams.get("type") || "all";
  const statusRaw = searchParams.get("status") || "all";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const person = (searchParams.get("person") || "").trim().toLowerCase();

  if (!TYPES.has(typeRaw)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }
  if (!STATUSES.has(statusRaw)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (!YMD.test(from) || !YMD.test(to)) {
    return NextResponse.json(
      { error: "from and to dates are required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }
  if (person && !canViewTimeClockUser(access!, person)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const settings = await getTimeClockSettings();
    const items = await listApprovalHistory({
      type: typeRaw as "all" | ApprovalHistoryType,
      personEmail: person || null,
      status: statusRaw as "all" | "approved" | "denied",
      from: from <= to ? from : to,
      to: from <= to ? to : from,
      userEmails: access!.visibleUserEmails,
      timezone: settings.timezone,
    });
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load history" },
      { status: 500 }
    );
  }
}

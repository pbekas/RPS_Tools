import { NextResponse } from "next/server";
import { apiRequireTimeClockManager } from "@/lib/requireAccess";
import { listTimeClockAuditLog } from "@/lib/timeClockAudit";

export async function GET(req: Request) {
  const { error, access } = await apiRequireTimeClockManager();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || 100);
  const offset = Number(searchParams.get("offset") || 0);
  const subjectEmail = searchParams.get("subjectEmail");
  const teamId = searchParams.get("teamId");
  const action = searchParams.get("action") || undefined;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  try {
    const result = await listTimeClockAuditLog({
      limit,
      offset,
      subjectEmail,
      teamId: teamId || undefined,
      teamIds: access!.teamIds,
      allowedSubjectEmails: access!.visibleUserEmails,
      action,
      from,
      to,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load audit log" },
      { status: 500 }
    );
  }
}

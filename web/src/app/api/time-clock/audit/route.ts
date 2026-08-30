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
  const actionsRaw = searchParams.get("actions");
  const actions = actionsRaw
    ? actionsRaw.split(",").map((value) => value.trim()).filter(Boolean)
    : undefined;
  const entityId = searchParams.get("entityId") || undefined;
  const from = searchParams.get("from") || undefined;
  const to = searchParams.get("to") || undefined;

  if (subjectEmail && access!.visibleUserEmails) {
    const allowed = access!.visibleUserEmails.map((email) => email.toLowerCase());
    if (!allowed.includes(subjectEmail.toLowerCase())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const result = await listTimeClockAuditLog({
      limit,
      offset,
      subjectEmail,
      teamId: teamId || undefined,
      teamIds: access!.teamIds,
      allowedSubjectEmails: access!.visibleUserEmails,
      action,
      actions,
      entityId,
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

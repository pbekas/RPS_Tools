import { NextResponse } from "next/server";
import { assignCallAgent } from "@/lib/database";
import { apiRequireCallQaManageCall } from "@/lib/requireAccess";
import { canViewCallAgent } from "@/lib/orgTeamAccess";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const { error, scope } = await apiRequireCallQaManageCall(id);
  if (error) return error;
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const agentEmail = String(body.agent_email || "").trim().toLowerCase();
  if (agentEmail && !canViewCallAgent(scope, agentEmail)) {
    return NextResponse.json({ error: "Agent is outside your team" }, { status: 403 });
  }
  try {
    const call = await assignCallAgent({
      callId: id,
      agentEmail: body.agent_email,
      agentName: body.agent_name,
    });
    return NextResponse.json({ ok: true, call });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Assign failed" },
      { status: 400 }
    );
  }
}

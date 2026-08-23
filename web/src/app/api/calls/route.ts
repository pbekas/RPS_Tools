import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { listCalls } from "@/lib/database";
import { canViewCallAgent, resolveCallQaScope } from "@/lib/orgTeamAccess";

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scope = await resolveCallQaScope(session.user);
  const { searchParams } = new URL(req.url);
  const agent = (searchParams.get("agent") || "").toLowerCase();

  let agentEmails = scope.agentEmails;
  let agentEmail: string | null | undefined;
  if (agent) {
    if (!canViewCallAgent(scope, agent)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    agentEmails = null;
    agentEmail = agent;
  }

  const calls = await listCalls({
    agentEmail,
    agentEmails,
    status: "complete",
    limit: 100,
  });
  return NextResponse.json({ calls });
}

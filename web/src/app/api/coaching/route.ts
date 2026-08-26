import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { generateCoachingForAgent } from "@/lib/coaching";
import { pickReviewSampleIds } from "@/lib/coachingQueue";
import {
  getUser,
  listCalls,
  listMetricsForAgent,
  listUsers,
} from "@/lib/database";
import { canViewCallAgent, resolveCallQaScope } from "@/lib/orgTeamAccess";
import { apiRequireCallQaManager } from "@/lib/requireAccess";

async function sampleForAgent(email: string): Promise<string[]> {
  const calls = await listCalls({
    agentEmail: email,
    status: "complete",
    limit: 40,
    requireMinDuration: true,
  });
  return pickReviewSampleIds(calls, 3);
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scope = await resolveCallQaScope(session.user);
  const { searchParams } = new URL(req.url);
  const requested = (searchParams.get("agent") || "").toLowerCase();
  const email =
    requested && canViewCallAgent(scope, requested)
      ? requested
      : session.user.email.toLowerCase();

  const user = await getUser(email);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  const [metrics, sampleCallIds, agents] = await Promise.all([
    listMetricsForAgent(email, 8),
    sampleForAgent(email),
    scope.canViewTeam
      ? listUsers().then((rows) =>
          rows.filter((u) => canViewCallAgent(scope, u.email))
        )
      : Promise.resolve([]),
  ]);
  return NextResponse.json({ user, metrics, agents, sampleCallIds });
}

export async function POST(req: Request) {
  const { session, error, scope } = await apiRequireCallQaManager();
  if (error) return error;
  if (!session || !scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const agent = String(body.agent || body.email || "").trim().toLowerCase();
  if (!agent) {
    return NextResponse.json({ error: "agent required" }, { status: 400 });
  }
  if (!canViewCallAgent(scope, agent)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await generateCoachingForAgent(agent);
    const metrics = await listMetricsForAgent(agent, 8);
    return NextResponse.json({ ok: true, ...result, metrics });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Coaching failed" },
      { status: 500 }
    );
  }
}

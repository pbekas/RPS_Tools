import { NextResponse } from "next/server";
import { listCalls, listUsers } from "@/lib/database";
import {
  buildQaSample,
  filterMappedQaCalls,
  isQaEligibleDuration,
} from "@/lib/qa";
import { apiRequireCallQaManager } from "@/lib/requireAccess";
import { canViewCallAgent } from "@/lib/orgTeamAccess";

export async function POST(req: Request) {
  const { error, scope } = await apiRequireCallQaManager();
  if (error) return error;
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const days = Math.min(90, Math.max(1, Number(body.days) || 14));
  const perAgent = Math.min(20, Math.max(1, Number(body.per_agent) || 3));
  const unknownCount = scope.isAdmin
    ? Math.min(30, Math.max(0, Number(body.unknown_count) || 5))
    : 0;
  const unreviewedOnly = body.unreviewed_only !== false;
  const overweightFails = body.overweight_fails !== false;
  const includeUnknown = scope.isAdmin && body.include_unknown === true;
  const requested: string[] | null = Array.isArray(body.agent_emails)
    ? body.agent_emails.map((e: string) => String(e).toLowerCase())
    : null;
  const agentEmails =
    requested && requested.length
      ? requested.filter((email) => canViewCallAgent(scope, email))
      : scope.agentEmails;

  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const [rawCalls, users] = await Promise.all([
    listCalls({
      status: "complete",
      limit: 500,
      sinceMs,
      agentEmails,
    }),
    listUsers(),
  ]);
  const calls = filterMappedQaCalls(rawCalls, users);
  const eligible = calls.filter((c) => isQaEligibleDuration(c.duration_seconds));

  const { sample, buckets } = buildQaSample(eligible, {
    perAgent,
    unknownCount,
    unreviewedOnly,
    overweightFails,
    agentEmails,
    includeUnknown,
  });

  return NextResponse.json({
    days,
    pool_size: eligible.length,
    sample,
    buckets,
    ids: sample.map((c) => c.id),
  });
}

import { redirect } from "next/navigation";
import {
  isFirestoreQuotaError,
  listCallLogs,
  listCalls,
  listUsers,
} from "@/lib/database";
import { CallOps } from "@/components/CallOps";
import { QuotaNotice } from "@/components/QuotaNotice";
import { buildCoachingQueue } from "@/lib/coachingQueue";
import { filterCallLogsForPeople } from "@/lib/callLogs";
import {
  buildAgentScorecard,
  filterCallsSince,
  mappedScorecardRows,
  summarizeAuditedCalls,
} from "@/lib/scorecard";
import { requireCallQaManager } from "@/lib/requireAccess";
import { canViewCallAgent } from "@/lib/orgTeamAccess";

type Props = {
  searchParams?: Promise<{ days?: string }> | { days?: string };
};

export default async function OpsPage({ searchParams }: Props) {
  const { scope } = await requireCallQaManager();

  const params = await Promise.resolve(searchParams || {});
  const daysRaw = Number(params.days || "7");
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 7;
  const sinceMs = Date.now() - days * 86_400_000;

  try {
    const [rawLogs, callsRaw, users] = await Promise.all([
      listCallLogs({ limit: 15000, days }),
      listCalls({
        status: "complete",
        limit: 800,
        sinceMs,
        agentEmails: scope.agentEmails,
      }),
      listUsers(),
    ]);
    const teamUsers = scope.agentEmails
      ? users.filter((user) => canViewCallAgent(scope, user.email))
      : users;
    const logs = filterCallLogsForPeople(
      rawLogs,
      scope.agentEmails ? teamUsers : null
    );
    const calls = filterCallsSince(callsRaw, sinceMs);
    const scorecard = buildAgentScorecard({ logs, calls, users: teamUsers });
    const scorecardRows = mappedScorecardRows(scorecard.rows);
    const auditedCalls = summarizeAuditedCalls(calls, teamUsers);
    const coachingQueue = buildCoachingQueue({
      rows: scorecardRows,
      calls,
    });
    const qaAnswerSecondsByCallId: Record<string, number | null> = {};
    for (const call of calls) {
      const sec = call.time_to_answer_seconds;
      if (typeof sec === "number" && Number.isFinite(sec) && sec >= 0) {
        qaAnswerSecondsByCallId[call.id] = sec;
      }
    }

    return (
      <CallOps
        logs={logs}
        days={days}
        scorecardRows={scorecardRows}
        scorecardTeam={scorecard.team}
        coachingQueue={coachingQueue}
        auditedCalls={auditedCalls}
        qaAnswerSecondsByCallId={qaAnswerSecondsByCallId}
      />
    );
  } catch (err) {
    if (isFirestoreQuotaError(err)) {
      return <QuotaNotice detail={err instanceof Error ? err.message : undefined} />;
    }
    throw err;
  }
}

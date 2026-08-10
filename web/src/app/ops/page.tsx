import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import {
  isFirestoreQuotaError,
  listCallLogs,
  listCalls,
  listUsers,
} from "@/lib/database";
import { CallOps } from "@/components/CallOps";
import { QuotaNotice } from "@/components/QuotaNotice";
import { buildCoachingQueue } from "@/lib/coachingQueue";
import {
  buildAgentScorecard,
  filterCallsSince,
  mappedScorecardRows,
} from "@/lib/scorecard";

type Props = {
  searchParams?: Promise<{ days?: string }> | { days?: string };
};

export default async function OpsPage({ searchParams }: Props) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
  if ((session.user.role || "").toLowerCase() !== "admin") redirect("/");

  const params = await Promise.resolve(searchParams || {});
  const daysRaw = Number(params.days || "7");
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 7;
  const sinceMs = Date.now() - days * 86_400_000;

  try {
    const [logs, callsRaw, users] = await Promise.all([
      listCallLogs({ limit: 15000, days }),
      listCalls({ status: "complete", limit: 800, sinceMs }),
      listUsers(),
    ]);
    const calls = filterCallsSince(callsRaw, sinceMs);
    const scorecard = buildAgentScorecard({ logs, calls, users });
    const scorecardRows = mappedScorecardRows(scorecard.rows);
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

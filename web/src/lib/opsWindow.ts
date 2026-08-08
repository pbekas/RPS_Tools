import {
  listCallLogs,
  listCalls,
  listUsers,
} from "@/lib/database";
import { buildCoachingQueue } from "@/lib/coachingQueue";
import { buildAgentScorecard, filterCallsSince } from "@/lib/scorecard";
import type { CallLogDoc } from "@/lib/callLogs";
import type { CoachingQueueEntry } from "@/lib/coachingQueue";
import type { AgentScorecardRow } from "@/lib/scorecard";

export type OpsWindowData = {
  days: number;
  logs: CallLogDoc[];
  scorecardRows: AgentScorecardRow[];
  scorecardTeam: AgentScorecardRow;
  coachingQueue: {
    needsHelp: CoachingQueueEntry[];
    rockStars: CoachingQueueEntry[];
  };
  qaAnswerSecondsByCallId: Record<string, number | null>;
};

export function parseDaysParam(raw: string | undefined, fallback = 7): number {
  const n = Number(raw || String(fallback));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 90);
}

/** Shared CDR + scorecard window for Call ops and Reporting. */
export async function loadOpsWindowData(days: number): Promise<OpsWindowData> {
  const sinceMs = Date.now() - days * 86_400_000;
  const [logs, callsRaw, users] = await Promise.all([
    listCallLogs({ limit: 15000, days }),
    listCalls({ status: "complete", limit: 800, sinceMs }),
    listUsers(),
  ]);
  const calls = filterCallsSince(callsRaw, sinceMs);
  const scorecard = buildAgentScorecard({ logs, calls, users });
  const coachingQueue = buildCoachingQueue({
    rows: scorecard.rows,
    calls,
  });
  const qaAnswerSecondsByCallId: Record<string, number | null> = {};
  for (const call of calls) {
    const sec = call.time_to_answer_seconds;
    if (typeof sec === "number" && Number.isFinite(sec) && sec >= 0) {
      qaAnswerSecondsByCallId[call.id] = sec;
    }
  }
  return {
    days,
    logs,
    scorecardRows: scorecard.rows,
    scorecardTeam: scorecard.team,
    coachingQueue,
    qaAnswerSecondsByCallId,
  };
}

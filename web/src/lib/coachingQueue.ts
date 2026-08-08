/** Coaching queue from scorecard tiers + QA rule fails (client-safe). */

import type { CallDoc } from "@/lib/firestore";
import { hasFailedRules } from "@/lib/qa";
import type { AgentScorecardRow, ScorecardTier } from "@/lib/scorecard";

export type FailedRuleStat = {
  ruleId: string;
  label: string;
  fails: number;
};

export type CoachingQueueEntry = {
  key: string;
  email: string | null;
  name: string;
  tier: Extract<ScorecardTier, "rock_star" | "coach">;
  cdrCalls: number;
  qaCalls: number;
  answerRate: number;
  missRate: number;
  avgQuality: number | null;
  avgEmpathy: number | null;
  fcrRate: number | null;
  criticalFlags: number;
  reasons: string[];
  topFailedRules: FailedRuleStat[];
  /** Up to 3 call IDs for a focused review sample. */
  sampleCallIds: string[];
};

function pctLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function callsForAgent(calls: CallDoc[], email: string | null): CallDoc[] {
  if (!email) return [];
  const needle = email.trim().toLowerCase();
  return calls.filter(
    (c) => (c.agent_email || "").trim().toLowerCase() === needle
  );
}

export function topFailedRulesForCalls(
  calls: CallDoc[],
  limit = 3
): FailedRuleStat[] {
  const map = new Map<string, FailedRuleStat>();
  for (const call of calls) {
    for (const r of call.rule_results || []) {
      if (r.passed) continue;
      const ruleId = r.rule_id || r.label || "unknown_rule";
      const cur = map.get(ruleId);
      if (cur) {
        cur.fails += 1;
      } else {
        map.set(ruleId, {
          ruleId,
          label: r.label || ruleId,
          fails: 1,
        });
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => b.fails - a.fails || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Prefer flagged / failed / lower-quality calls for a short review sample. */
export function pickReviewSampleIds(
  calls: CallDoc[],
  count = 3
): string[] {
  if (!calls.length || count <= 0) return [];
  const scored = calls.map((c) => {
    let w = 1;
    if (hasFailedRules(c)) w += 3;
    const flags = (c.critical_flags || []).filter(
      (f) => f.triggered !== false
    ).length;
    w += flags * 2;
    if (typeof c.quality_score === "number" && c.quality_score < 7) w += 2;
    if (typeof c.ai_empathy_score === "number" && c.ai_empathy_score < 6.5) {
      w += 1;
    }
    return { id: c.id, w: w * (0.5 + Math.random()) };
  });
  scored.sort((a, b) => b.w - a.w);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const row of scored) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
    if (ids.length >= count) break;
  }
  return ids;
}

export function coachingReasonsForRow(
  row: AgentScorecardRow,
  topFailedRules: FailedRuleStat[]
): string[] {
  const missRate = row.cdrCalls ? row.missedBucket / row.cdrCalls : 0;
  const reasons: string[] = [];

  if (row.tier === "rock_star") {
    if (row.cdrCalls >= 3) {
      reasons.push(`Answer rate ${pctLabel(row.answerRate)}`);
    }
    if (row.avgQuality != null) {
      reasons.push(`Quality ${row.avgQuality.toFixed(1)}`);
    }
    if (row.criticalFlags === 0 && row.qaCalls > 0) {
      reasons.push("No critical flags");
    }
    if (row.fcrRate != null && row.fcrRate >= 0.75) {
      reasons.push(`FCR ${pctLabel(row.fcrRate)}`);
    }
    return reasons.slice(0, 4);
  }

  if (row.cdrCalls >= 3 && missRate >= 0.15) {
    reasons.push(`Miss rate ${pctLabel(missRate)}`);
  }
  if (row.avgQuality != null && row.avgQuality < 7.5) {
    reasons.push(`Quality ${row.avgQuality.toFixed(1)}`);
  }
  if (row.avgEmpathy != null && row.avgEmpathy < 6.5) {
    reasons.push(`Empathy ${row.avgEmpathy.toFixed(1)}`);
  }
  if (row.criticalFlags >= 1) {
    reasons.push(
      `${row.criticalFlags} critical flag${row.criticalFlags === 1 ? "" : "s"}`
    );
  }
  if (row.fcrRate != null && row.qaCalls >= 3 && row.fcrRate < 0.6) {
    reasons.push(`FCR ${pctLabel(row.fcrRate)}`);
  }
  for (const rule of topFailedRules.slice(0, 2)) {
    reasons.push(`Rule fail: ${rule.label} (${rule.fails})`);
  }
  if (!reasons.length) {
    reasons.push("Below team baseline this window");
  }
  return reasons.slice(0, 5);
}

function toEntry(
  row: AgentScorecardRow,
  calls: CallDoc[]
): CoachingQueueEntry | null {
  if (row.tier !== "rock_star" && row.tier !== "coach") return null;
  const agentCalls = callsForAgent(calls, row.email);
  const topFailedRules = topFailedRulesForCalls(agentCalls, 3);
  const sampleCallIds = pickReviewSampleIds(agentCalls, 3);
  return {
    key: row.key,
    email: row.email,
    name: row.name,
    tier: row.tier,
    cdrCalls: row.cdrCalls,
    qaCalls: row.qaCalls,
    answerRate: row.answerRate,
    missRate: row.cdrCalls ? row.missedBucket / row.cdrCalls : 0,
    avgQuality: row.avgQuality,
    avgEmpathy: row.avgEmpathy,
    fcrRate: row.fcrRate,
    criticalFlags: row.criticalFlags,
    reasons: coachingReasonsForRow(row, topFailedRules),
    topFailedRules,
    sampleCallIds,
  };
}

export function buildCoachingQueue(input: {
  rows: AgentScorecardRow[];
  calls: CallDoc[];
}): { needsHelp: CoachingQueueEntry[]; rockStars: CoachingQueueEntry[] } {
  const needsHelp: CoachingQueueEntry[] = [];
  const rockStars: CoachingQueueEntry[] = [];

  for (const row of input.rows) {
    const entry = toEntry(row, input.calls);
    if (!entry) continue;
    if (entry.tier === "coach") needsHelp.push(entry);
    else rockStars.push(entry);
  }

  needsHelp.sort((a, b) => {
    const aScore =
      a.missRate * 10 +
      a.criticalFlags * 2 +
      (a.avgQuality == null ? 5 : 10 - a.avgQuality) +
      a.topFailedRules.reduce((n, r) => n + r.fails, 0);
    const bScore =
      b.missRate * 10 +
      b.criticalFlags * 2 +
      (b.avgQuality == null ? 5 : 10 - b.avgQuality) +
      b.topFailedRules.reduce((n, r) => n + r.fails, 0);
    return bScore - aScore || a.name.localeCompare(b.name);
  });

  rockStars.sort(
    (a, b) =>
      b.answerRate - a.answerRate ||
      (b.avgQuality || 0) - (a.avgQuality || 0) ||
      a.name.localeCompare(b.name)
  );

  return { needsHelp, rockStars };
}

/** Compact signal block for Bedrock coaching prompts. */
export function formatCoachingSignals(entry: {
  tier: ScorecardTier | string;
  answerRate: number;
  missRate: number;
  cdrCalls: number;
  qaCalls: number;
  avgQuality: number | null;
  avgEmpathy: number | null;
  fcrRate: number | null;
  criticalFlags: number;
  reasons: string[];
  topFailedRules: FailedRuleStat[];
}): string {
  const lines = [
    `Scorecard tier: ${entry.tier}`,
    `CDR calls: ${entry.cdrCalls} · Answer ${pctLabel(entry.answerRate)} · Miss ${pctLabel(entry.missRate)}`,
    `QA calls: ${entry.qaCalls} · Quality ${entry.avgQuality?.toFixed(1) ?? "n/a"} · Empathy ${entry.avgEmpathy?.toFixed(1) ?? "n/a"} · FCR ${entry.fcrRate != null ? pctLabel(entry.fcrRate) : "n/a"}`,
    `Critical flags: ${entry.criticalFlags}`,
  ];
  if (entry.reasons.length) {
    lines.push(`Why this window: ${entry.reasons.join("; ")}`);
  }
  if (entry.topFailedRules.length) {
    lines.push(
      `Top failed QA rules: ${entry.topFailedRules
        .map((r) => `${r.label} (${r.fails})`)
        .join(", ")}`
    );
  } else {
    lines.push("Top failed QA rules: (none in window)");
  }
  return lines.join("\n");
}

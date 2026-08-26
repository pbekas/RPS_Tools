import type { CallDoc } from "@/lib/database";

export const QUEUE_STORAGE_KEY = "rps_qa_queue_v1";

/** Calls at or under this length are usually IVR-only / no live interaction. */
export const MIN_CALL_DURATION_SECONDS = 30;

export function isQaEligibleDuration(durationSeconds?: number | null): boolean {
  return (durationSeconds || 0) > MIN_CALL_DURATION_SECONDS;
}

export function isMappedAgentUser(user: {
  email?: string | null;
  role?: string | null;
  provisional?: boolean;
  active?: boolean;
}): boolean {
  const email = (user.email || "").trim().toLowerCase();
  if (!email || user.active === false) return false;
  if (user.provisional || email.startsWith("unmapped.")) return false;
  return (user.role || "Agent").toLowerCase() === "agent";
}

export function mappedAgentEmails(
  users: Array<{
    email?: string | null;
    role?: string | null;
    provisional?: boolean;
    active?: boolean;
  }>
): Set<string> {
  return new Set(
    users
      .filter(isMappedAgentUser)
      .map((user) => (user.email || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isMappedQaCall(
  call: { agent_email?: string | null },
  mappedEmails: Set<string>
): boolean {
  const email = (call.agent_email || "").trim().toLowerCase();
  return !!email && mappedEmails.has(email);
}

export function filterMappedQaCalls<T extends { agent_email?: string | null }>(
  calls: T[],
  users: Array<{
    email?: string | null;
    role?: string | null;
    provisional?: boolean;
    active?: boolean;
  }>
): T[] {
  const emails = mappedAgentEmails(users);
  return calls.filter((call) => isMappedQaCall(call, emails));
}

export type AgentBucketKey = string; // email or "__unknown__"

export type SampleCall = Pick<
  CallDoc,
  | "id"
  | "agent_name"
  | "agent_email"
  | "call_date"
  | "topic"
  | "quality_score"
  | "ai_empathy_score"
  | "auto_failed"
  | "rule_results"
  | "manager_feedback"
  | "reviewed_at"
>;

export type SampleOpts = {
  perAgent: number;
  unknownCount: number;
  unreviewedOnly: boolean;
  overweightFails: boolean;
  agentEmails?: string[] | null; // null/empty = all known agents
  includeUnknown: boolean;
};

export type HeatmapCell = {
  agentKey: string;
  agentLabel: string;
  ruleId: string;
  ruleLabel: string;
  fails: number;
  passes: number;
  total: number;
  /** Pass rate 0–1 (high = good). */
  rate: number;
};

export type HeatmapData = {
  agents: Array<{ key: string; label: string }>;
  rules: Array<{ id: string; label: string }>;
  cells: HeatmapCell[];
  /** Max pass rate observed (for legend scaling); usually near 1. */
  maxRate: number;
};

export function agentBucketKey(call: {
  agent_email?: string | null;
  agent_name?: string;
}): AgentBucketKey {
  const email = (call.agent_email || "").trim().toLowerCase();
  if (email) return email;
  return "__unknown__";
}

export function agentBucketLabel(call: {
  agent_email?: string | null;
  agent_name?: string;
}): string {
  const email = (call.agent_email || "").trim();
  if (email) return call.agent_name || email;
  return call.agent_name?.trim()
    ? `Unknown · ${call.agent_name}`
    : "Unknown / unassigned";
}

export function isReviewed(call: {
  reviewed_at?: string | null;
  manager_feedback?: string;
}): boolean {
  return !!(call.reviewed_at || (call.manager_feedback || "").trim());
}

export function hasFailedRules(call: {
  auto_failed?: boolean;
  rule_results?: Array<{ passed?: boolean }>;
}): boolean {
  return !!(
    call.auto_failed ||
    (call.rule_results || []).some((r) => !r.passed)
  );
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function weightedPick<T extends { id: string }>(
  pool: T[],
  count: number,
  weightFn: (item: T) => number
): T[] {
  if (count <= 0 || pool.length === 0) return [];
  if (pool.length <= count) return shuffle(pool);

  const scored = pool.map((item) => ({
    item,
    w: Math.max(0.1, weightFn(item)) * Math.random(),
  }));
  scored.sort((a, b) => b.w - a.w);
  return scored.slice(0, count).map((s) => s.item);
}

export function buildQaSample(
  calls: SampleCall[],
  opts: SampleOpts
): { sample: SampleCall[]; buckets: Record<string, number> } {
  let pool = [...calls];
  if (opts.unreviewedOnly) {
    pool = pool.filter((c) => !isReviewed(c));
  }

  const byBucket = new Map<string, SampleCall[]>();
  for (const c of pool) {
    const key = agentBucketKey(c);
    const list = byBucket.get(key) || [];
    list.push(c);
    byBucket.set(key, list);
  }

  const sample: SampleCall[] = [];
  const buckets: Record<string, number> = {};
  const selected = new Set<string>();

  const weight = (c: SampleCall) => {
    if (!opts.overweightFails) return 1;
    return hasFailedRules(c) ? 3 : 1;
  };

  const knownKeys = [...byBucket.keys()].filter((k) => k !== "__unknown__");
  const targetAgents =
    opts.agentEmails && opts.agentEmails.length
      ? knownKeys.filter((k) =>
          opts.agentEmails!.map((e) => e.toLowerCase()).includes(k)
        )
      : knownKeys;

  for (const key of targetAgents) {
    const picked = weightedPick(byBucket.get(key) || [], opts.perAgent, weight);
    for (const c of picked) {
      if (!selected.has(c.id)) {
        selected.add(c.id);
        sample.push(c);
      }
    }
    buckets[key] = picked.length;
  }

  if (opts.includeUnknown) {
    const unknownPool = byBucket.get("__unknown__") || [];
    const picked = weightedPick(unknownPool, opts.unknownCount, weight);
    for (const c of picked) {
      if (!selected.has(c.id)) {
        selected.add(c.id);
        sample.push(c);
      }
    }
    buckets.__unknown__ = picked.length;
  }

  return { sample: shuffle(sample), buckets };
}

export function buildIssueHeatmap(calls: CallDoc[]): HeatmapData {
  const agentMeta = new Map<string, string>();
  const ruleMeta = new Map<string, string>();
  const totals = new Map<string, number>(); // agentKey
  const fails = new Map<string, number>(); // `${agentKey}||${ruleId}`
  const scored = new Map<string, number>(); // `${agentKey}||${ruleId}` — calls with this rule

  for (const call of calls) {
    const aKey = agentBucketKey(call);
    if (!agentMeta.has(aKey)) agentMeta.set(aKey, agentBucketLabel(call));
    totals.set(aKey, (totals.get(aKey) || 0) + 1);

    const rules = call.rule_results || [];
    for (const r of rules) {
      const ruleId = r.rule_id || r.label || "unknown_rule";
      if (!ruleMeta.has(ruleId)) {
        ruleMeta.set(ruleId, r.label || ruleId);
      }
      const cellKey = `${aKey}||${ruleId}`;
      scored.set(cellKey, (scored.get(cellKey) || 0) + 1);
      if (!r.passed) {
        fails.set(cellKey, (fails.get(cellKey) || 0) + 1);
      }
    }
  }

  const agents = [...agentMeta.entries()]
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => {
      if (a.key === "__unknown__") return 1;
      if (b.key === "__unknown__") return -1;
      return a.label.localeCompare(b.label);
    });

  const rules = [...ruleMeta.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const cells: HeatmapCell[] = [];
  let maxRate = 0;
  for (const agent of agents) {
    for (const rule of rules) {
      const cellKey = `${agent.key}||${rule.id}`;
      const n = scored.get(cellKey) || 0;
      const failCount = fails.get(cellKey) || 0;
      const passCount = Math.max(0, n - failCount);
      const rate = n > 0 ? passCount / n : 0;
      maxRate = Math.max(maxRate, rate);
      cells.push({
        agentKey: agent.key,
        agentLabel: agent.label,
        ruleId: rule.id,
        ruleLabel: rule.label,
        fails: failCount,
        passes: passCount,
        total: n,
        rate,
      });
    }
  }

  return { agents, rules, cells, maxRate: maxRate || 1 };
}

export type QaTeamRating = {
  key: string;
  name: string;
  email: string | null;
  calls: number;
  avgQuality: number | null;
  avgEmpathy: number | null;
  fcrRate: number | null;
  failCount: number;
  criticalCount: number;
};

function ratingFromCalls(
  key: string,
  name: string,
  email: string | null,
  calls: CallDoc[]
): QaTeamRating {
  let qualitySum = 0;
  let qualityN = 0;
  let empathySum = 0;
  let empathyN = 0;
  let fcrN = 0;
  let failCount = 0;
  let criticalCount = 0;
  for (const call of calls) {
    if (typeof call.quality_score === "number") {
      qualitySum += call.quality_score;
      qualityN += 1;
    }
    if (typeof call.ai_empathy_score === "number") {
      empathySum += call.ai_empathy_score;
      empathyN += 1;
    }
    if (call.fcr) fcrN += 1;
    if (call.auto_failed || (call.rule_results || []).some((r) => !r.passed)) {
      failCount += 1;
    }
    if (call.has_critical_flags || (call.critical_flags || []).length) {
      criticalCount += 1;
    }
  }
  const n = calls.length;
  return {
    key,
    name,
    email,
    calls: n,
    avgQuality: qualityN ? qualitySum / qualityN : null,
    avgEmpathy: empathyN ? empathySum / empathyN : null,
    fcrRate: n ? fcrN / n : null,
    failCount,
    criticalCount,
  };
}

export function buildQaTeamRatings(
  calls: CallDoc[],
  users: Array<{
    email?: string | null;
    name?: string | null;
    role?: string | null;
    provisional?: boolean;
    active?: boolean;
  }>
): { team: QaTeamRating; agents: QaTeamRating[] } {
  const byEmail = new Map<string, CallDoc[]>();
  for (const call of calls) {
    const email = (call.agent_email || "").trim().toLowerCase();
    if (!email) continue;
    const rows = byEmail.get(email) || [];
    rows.push(call);
    byEmail.set(email, rows);
  }

  const agents: QaTeamRating[] = [];
  const seen = new Set<string>();
  for (const user of users.filter(isMappedAgentUser)) {
    const email = (user.email || "").trim().toLowerCase();
    if (!email) continue;
    seen.add(email);
    agents.push(
      ratingFromCalls(
        email,
        user.name || email,
        email,
        byEmail.get(email) || []
      )
    );
  }
  for (const [email, rows] of byEmail) {
    if (seen.has(email)) continue;
    agents.push(
      ratingFromCalls(email, rows[0]?.agent_name || email, email, rows)
    );
  }
  agents.sort(
    (a, b) =>
      (b.avgQuality ?? -1) - (a.avgQuality ?? -1) ||
      b.calls - a.calls ||
      a.name.localeCompare(b.name)
  );

  return {
    team: ratingFromCalls("team", "Team", null, calls),
    agents,
  };
}

export type StoredQueue = {
  createdAt: string;
  ids: string[];
  cursor: number;
};

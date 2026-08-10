/** Unified agent scorecard: join CDR ops metrics with QA quality signals. */

import type { CallLogDoc } from "@/lib/callLogs";
import {
  isMissedResult,
  normalizeResult,
  partyFromLog,
} from "@/lib/callLogs";
import type { CallDoc, UserDoc } from "@/lib/firestore";
import { toMillis } from "@/lib/format";

export type ScorecardTier =
  | "rock_star"
  | "solid"
  | "coach"
  | "unmapped"
  | "baseline";

export type AgentScorecardRow = {
  key: string;
  name: string;
  email: string | null;
  extension: string | null;
  /** CDR party keys that roll into this row (for log filtering). */
  partyKeys: string[];
  cdrCalls: number;
  answered: number;
  missedBucket: number;
  answerRate: number;
  talkSeconds: number;
  qaCalls: number;
  avgQuality: number | null;
  avgEmpathy: number | null;
  fcrRate: number | null;
  criticalFlags: number;
  tier: ScorecardTier;
};

function namesMatch(a: string, b: string): boolean {
  const left = (a || "").trim().toLowerCase();
  const right = (b || "").trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const leftParts = left.split(/\s+/);
  const rightParts = right.split(/\s+/);
  if (leftParts.length === 1 && leftParts[0] === rightParts[0]) return true;
  if (rightParts.length === 1 && rightParts[0] === leftParts[0]) return true;
  return left.includes(right) || right.includes(left);
}

function emailLocalName(email: string): string {
  return email
    .split("@")[0]
    .replace(/^unmapped\./, "")
    .replace(/\./g, " ")
    .trim();
}

function criticalFlagCount(call: CallDoc): number {
  return (call.critical_flags || []).filter((f) => f.triggered !== false).length;
}

type Identity = {
  key: string;
  name: string;
  email: string | null;
  extension: string | null;
};

function isScorecardUser(u: UserDoc): boolean {
  const email = (u.email || "").trim().toLowerCase();
  if (!email || u.active === false) return false;
  if (email.startsWith("unmapped.") || u.provisional) return false;
  if ((u.role || "Agent").toLowerCase() === "admin") return false;
  return true;
}

function buildUserIndex(users: UserDoc[]): {
  byEmail: Map<string, UserDoc>;
  candidates: Array<{ email: string; name: string; local: string }>;
} {
  const byEmail = new Map<string, UserDoc>();
  const candidates: Array<{ email: string; name: string; local: string }> = [];
  for (const u of users) {
    if (!isScorecardUser(u)) continue;
    const email = (u.email || "").trim().toLowerCase();
    byEmail.set(email, u);
    candidates.push({
      email,
      name: (u.name || "").trim(),
      local: emailLocalName(email),
    });
  }
  return { byEmail, candidates };
}

/** Resolve a CDR party to a known users-table agent, or null if unmapped. */
function resolveIdentity(
  party: ReturnType<typeof partyFromLog>,
  log: CallLogDoc,
  callsById: Map<string, CallDoc>,
  byEmail: Map<string, UserDoc>,
  candidates: Array<{ email: string; name: string; local: string }>
): Identity | null {
  const matchedId = (log.matched_call_id || "").trim();
  if (matchedId) {
    const call = callsById.get(matchedId);
    const email = (call?.agent_email || "").trim().toLowerCase();
    if (email && byEmail.has(email)) {
      const user = byEmail.get(email)!;
      return {
        key: `email:${email}`,
        name: (user.name || call?.agent_name || "").trim() || party.name,
        email,
        extension: party.extension,
      };
    }
  }

  for (const c of candidates) {
    if (
      namesMatch(party.name, c.name) ||
      namesMatch(party.name, c.local) ||
      (party.user && namesMatch(party.user, c.local))
    ) {
      return {
        key: `email:${c.email}`,
        name: c.name || party.name,
        email: c.email,
        extension: party.extension,
      };
    }
  }

  return null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function assignTier(rows: AgentScorecardRow[]): void {
  const eligible = rows.filter((r) => r.cdrCalls >= 3 || r.qaCalls >= 2);
  const answerRates = eligible
    .filter((r) => r.cdrCalls >= 3)
    .map((r) => r.answerRate);
  const qualities = eligible
    .filter((r) => r.avgQuality != null)
    .map((r) => r.avgQuality as number);
  const ansMed = median(answerRates) ?? 0.9;
  const qMed = median(qualities) ?? 7.5;

  for (const row of rows) {
    const thin = row.cdrCalls < 3 && row.qaCalls < 2;
    if (thin) {
      row.tier = "solid";
      continue;
    }

    const lowAccess = row.cdrCalls >= 3 && row.answerRate < Math.min(0.85, ansMed - 0.05);
    const lowQuality =
      row.avgQuality != null && row.avgQuality < Math.min(7, qMed - 0.5);
    const lowEmpathy = row.avgEmpathy != null && row.avgEmpathy < 6.5;
    const flagHeavy = row.criticalFlags >= 2;
    const lowFcr = row.fcrRate != null && row.qaCalls >= 3 && row.fcrRate < 0.6;

    if (lowAccess || lowQuality || lowEmpathy || flagHeavy || lowFcr) {
      row.tier = "coach";
      continue;
    }

    const highAccess = row.cdrCalls >= 3 && row.answerRate >= Math.max(0.9, ansMed);
    const highQuality =
      row.avgQuality != null && row.avgQuality >= Math.max(8, qMed);
    const clean = row.criticalFlags === 0;
    if (highAccess && highQuality && clean) {
      row.tier = "rock_star";
      continue;
    }

    row.tier = "solid";
  }
}

export function buildAgentScorecard(input: {
  logs: CallLogDoc[];
  calls: CallDoc[];
  users: UserDoc[];
}): { rows: AgentScorecardRow[]; team: AgentScorecardRow } {
  const { byEmail, candidates } = buildUserIndex(input.users);
  const callsById = new Map(
    input.calls.map((c) => [c.id, c] as const)
  );

  type Acc = {
    key: string;
    name: string;
    email: string | null;
    extension: string | null;
    partyKeys: Set<string>;
    cdrCalls: number;
    answered: number;
    missedBucket: number;
    talkSeconds: number;
    qaCalls: number;
    qualitySum: number;
    qualityN: number;
    empathySum: number;
    empathyN: number;
    fcrYes: number;
    fcrN: number;
    criticalFlags: number;
  };

  const map = new Map<string, Acc>();

  function ensure(id: Identity): Acc {
    let row = map.get(id.key);
    if (!row) {
      const user = id.email ? byEmail.get(id.email) : undefined;
      row = {
        key: id.key,
        name: (user?.name || id.name || id.email || "Unknown").trim(),
        email: id.email,
        extension: id.extension,
        partyKeys: new Set(),
        cdrCalls: 0,
        answered: 0,
        missedBucket: 0,
        talkSeconds: 0,
        qaCalls: 0,
        qualitySum: 0,
        qualityN: 0,
        empathySum: 0,
        empathyN: 0,
        fcrYes: 0,
        fcrN: 0,
        criticalFlags: 0,
      };
      map.set(id.key, row);
    } else if (id.extension && !row.extension) {
      row.extension = id.extension;
    }
    return row;
  }

  for (const log of input.logs) {
    const party = partyFromLog(log);
    const identity = resolveIdentity(
      party,
      log,
      callsById,
      byEmail,
      candidates
    );
    if (!identity) continue;
    const row = ensure(identity);
    row.partyKeys.add(party.key);
    row.cdrCalls += 1;
    row.talkSeconds += Math.max(0, Number(log.length_seconds || 0));
    const result = normalizeResult(log.result).toLowerCase();
    if (result === "answered" || result === "connected") {
      row.answered += 1;
    } else if (isMissedResult(log.result) || log.is_missed) {
      row.missedBucket += 1;
    }
  }

  for (const call of input.calls) {
    const email = (call.agent_email || "").trim().toLowerCase();
    const name = (call.agent_name || "").trim() || email || "Unknown";
    let identityEmail: string | null = null;

    if (email && byEmail.has(email)) {
      identityEmail = email;
    } else {
      // Attach unnamed / provisional QA only when it matches a users-table agent.
      const match = candidates.find(
        (c) => namesMatch(name, c.name) || namesMatch(name, c.local)
      );
      if (match) identityEmail = match.email;
    }
    if (!identityEmail) continue;

    const row = ensure({
      key: `email:${identityEmail}`,
      name,
      email: identityEmail,
      extension: null,
    });
    row.qaCalls += 1;
    row.criticalFlags += criticalFlagCount(call);
    if (typeof call.quality_score === "number") {
      row.qualitySum += call.quality_score;
      row.qualityN += 1;
    }
    if (typeof call.ai_empathy_score === "number") {
      row.empathySum += call.ai_empathy_score;
      row.empathyN += 1;
    }
    if (typeof call.fcr === "boolean") {
      row.fcrN += 1;
      if (call.fcr) row.fcrYes += 1;
    }
  }

  const rows: AgentScorecardRow[] = [...map.values()]
    .filter(
      (r) =>
        !!r.email &&
        byEmail.has(r.email) &&
        (r.cdrCalls > 0 || r.qaCalls > 0)
    )
    .map((r) => ({
      key: r.key,
      name: r.name,
      email: r.email,
      extension: r.extension,
      partyKeys: [...r.partyKeys],
      cdrCalls: r.cdrCalls,
      answered: r.answered,
      missedBucket: r.missedBucket,
      answerRate: r.cdrCalls ? r.answered / r.cdrCalls : 0,
      talkSeconds: r.talkSeconds,
      qaCalls: r.qaCalls,
      avgQuality: r.qualityN ? r.qualitySum / r.qualityN : null,
      avgEmpathy: r.empathyN ? r.empathySum / r.empathyN : null,
      fcrRate: r.fcrN ? r.fcrYes / r.fcrN : null,
      criticalFlags: r.criticalFlags,
      tier: "solid" as ScorecardTier,
    }))
    .sort(
      (a, b) =>
        b.talkSeconds - a.talkSeconds ||
        b.cdrCalls - a.cdrCalls ||
        (b.avgQuality || 0) - (a.avgQuality || 0)
    );

  assignTier(rows);

  const teamCdr = rows.reduce((n, r) => n + r.cdrCalls, 0);
  const teamAns = rows.reduce((n, r) => n + r.answered, 0);
  const teamMiss = rows.reduce((n, r) => n + r.missedBucket, 0);
  const teamTalk = rows.reduce((n, r) => n + r.talkSeconds, 0);
  const teamQa = rows.reduce((n, r) => n + r.qaCalls, 0);
  const teamFlags = rows.reduce((n, r) => n + r.criticalFlags, 0);
  const qVals = rows.filter((r) => r.avgQuality != null).map((r) => r.avgQuality!);
  const eVals = rows.filter((r) => r.avgEmpathy != null).map((r) => r.avgEmpathy!);
  const fVals = rows.filter((r) => r.fcrRate != null && r.qaCalls > 0);
  const fcrYes = fVals.reduce(
    (n, r) => n + (r.fcrRate || 0) * r.qaCalls,
    0
  );
  const fcrN = fVals.reduce((n, r) => n + r.qaCalls, 0);

  const team: AgentScorecardRow = {
    key: "team",
    name: "Team",
    email: null,
    extension: null,
    partyKeys: [],
    cdrCalls: teamCdr,
    answered: teamAns,
    missedBucket: teamMiss,
    answerRate: teamCdr ? teamAns / teamCdr : 0,
    talkSeconds: teamTalk,
    qaCalls: teamQa,
    avgQuality: qVals.length
      ? qVals.reduce((a, b) => a + b, 0) / qVals.length
      : null,
    avgEmpathy: eVals.length
      ? eVals.reduce((a, b) => a + b, 0) / eVals.length
      : null,
    fcrRate: fcrN ? fcrYes / fcrN : null,
    criticalFlags: teamFlags,
    tier: "baseline",
  };

  return { rows, team };
}

export function scorecardTierLabel(tier: ScorecardTier): string {
  switch (tier) {
    case "rock_star":
      return "Rock star";
    case "coach":
      return "Coach";
    case "unmapped":
      return "Unmapped";
    case "baseline":
      return "Baseline";
    default:
      return "Solid";
  }
}

export function filterLogsForScorecardRow(
  logs: CallLogDoc[],
  row: AgentScorecardRow | null
): CallLogDoc[] {
  if (!row || row.key === "team") return logs;
  const keys = new Set(row.partyKeys);
  if (!keys.size) return [];
  return logs.filter((log) => keys.has(partyFromLog(log).key));
}

/** Convenience: keep calls inside the ops day window. */
export function filterCallsSince(calls: CallDoc[], sinceMs: number): CallDoc[] {
  return calls.filter((c) => toMillis(c.call_date) >= sinceMs);
}

/** Unified agent scorecard: join CDR ops metrics with QA quality signals.

Identity rules:
  - Prefer users.extension ↔ CDR party extension (known staff only).
  - Fall back to matched QA agent_email when that user exists.
  - Everything else rolls into a single Unknown bucket — never invent agents.
*/

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

const UNKNOWN_KEY = "unknown";

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

function buildUserIndex(users: UserDoc[]): {
  byEmail: Map<string, UserDoc>;
  byExtension: Map<string, UserDoc>;
  candidates: Array<{ email: string; name: string; local: string }>;
} {
  const byEmail = new Map<string, UserDoc>();
  const byExtension = new Map<string, UserDoc>();
  const candidates: Array<{ email: string; name: string; local: string }> = [];
  for (const u of users) {
    if (u.active === false) continue;
    // Provisional / auto-created shells are not scorecard agents.
    if (u.provisional) continue;
    const email = (u.email || "").trim().toLowerCase();
    if (!email) continue;
    byEmail.set(email, u);
    const ext = String(u.extension || "").trim();
    if (ext) byExtension.set(ext, u);
    candidates.push({
      email,
      name: (u.name || "").trim(),
      local: emailLocalName(email),
    });
  }
  return { byEmail, byExtension, candidates };
}

function unknownIdentity(extension: string | null = null): Identity {
  return {
    key: UNKNOWN_KEY,
    name: "Unknown",
    email: null,
    extension,
  };
}

function resolveIdentity(
  party: ReturnType<typeof partyFromLog>,
  log: CallLogDoc,
  callsById: Map<string, CallDoc>,
  byEmail: Map<string, UserDoc>,
  byExtension: Map<string, UserDoc>
): Identity {
  const ext = (party.extension || "").trim();
  if (ext && byExtension.has(ext)) {
    const user = byExtension.get(ext)!;
    return {
      key: `email:${user.email}`,
      name: (user.name || "").trim() || party.name,
      email: user.email,
      extension: ext,
    };
  }

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
        extension: (user.extension || ext || null) as string | null,
      };
    }
  }

  // No known staff extension / mapped user → single Unknown bucket.
  return unknownIdentity(ext || null);
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
    if (!row.email || row.key === UNKNOWN_KEY) {
      row.tier = "unmapped";
      continue;
    }
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
  const { byEmail, byExtension, candidates } = buildUserIndex(input.users);
  const callsById = new Map(input.calls.map((c) => [c.id, c] as const));

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
        extension: (user?.extension || id.extension || null) as string | null,
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
    const identity = resolveIdentity(party, log, callsById, byEmail, byExtension);
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
    let identity: Identity;

    if (email && byEmail.has(email)) {
      const user = byEmail.get(email)!;
      identity = {
        key: `email:${email}`,
        name: (user.name || name).trim(),
        email,
        extension: (user.extension || null) as string | null,
      };
    } else {
      const match = candidates.find(
        (c) => namesMatch(name, c.name) || namesMatch(name, c.local)
      );
      if (match && byEmail.has(match.email)) {
        const user = byEmail.get(match.email)!;
        // Only attach by name when the user has a known extension (staff).
        if (String(user.extension || "").trim()) {
          identity = {
            key: `email:${match.email}`,
            name: (user.name || name).trim(),
            email: match.email,
            extension: user.extension || null,
          };
        } else {
          identity = unknownIdentity();
        }
      } else {
        identity = unknownIdentity();
      }
    }

    const row = ensure(identity);
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
    .filter((r) => r.cdrCalls > 0 || r.qaCalls > 0)
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
    .sort((a, b) => {
      // Keep Unknown at the bottom.
      if (a.key === UNKNOWN_KEY && b.key !== UNKNOWN_KEY) return 1;
      if (b.key === UNKNOWN_KEY && a.key !== UNKNOWN_KEY) return -1;
      return (
        b.talkSeconds - a.talkSeconds ||
        b.cdrCalls - a.cdrCalls ||
        (b.avgQuality || 0) - (a.avgQuality || 0)
      );
    });

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
  const fcrYes = fVals.reduce((n, r) => n + (r.fcrRate || 0) * r.qaCalls, 0);
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
      return "Unknown";
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
  if (row.key === UNKNOWN_KEY) {
    // Unknown = any log whose party does not map to a known extension row's parties
    // Use partyKeys collected during build.
    const keys = new Set(row.partyKeys);
    if (!keys.size) return [];
    return logs.filter((log) => keys.has(partyFromLog(log).key));
  }
  const keys = new Set(row.partyKeys);
  if (!keys.size) return [];
  return logs.filter((log) => keys.has(partyFromLog(log).key));
}

/** Convenience: keep calls inside the ops day window. */
export function filterCallsSince(calls: CallDoc[], sinceMs: number): CallDoc[] {
  return calls.filter((c) => toMillis(c.call_date) >= sinceMs);
}

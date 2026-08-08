/** Client-safe CDR helpers (no firebase-admin). */

export type CallLogDoc = {
  id: string;
  direction?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  result?: string | null;
  recorded?: boolean | null;
  length_seconds?: number;
  start?: string | null;
  end?: string | null;
  source_user?: string | null;
  source_user_full_name?: string | null;
  source_extension?: string | null;
  destination_user?: string | null;
  destination_user_full_name?: string | null;
  destination_extension?: string | null;
  custom_tag?: string | null;
  in_network?: boolean | null;
  international?: boolean | null;
  is_missed?: boolean;
  is_unrecorded?: boolean;
  matched_call_id?: string | null;
  /** Telephony ring time (seconds). Null until Vonage/ACD exposes it. */
  ring_seconds?: number | null;
  /** Telephony wait / speed-of-answer (seconds). Null until available. */
  wait_seconds?: number | null;
  /** Queue wait (seconds). Null until available. */
  queue_seconds?: number | null;
  answered_at?: string | null;
  has_telephony_wait?: boolean | null;
  synced_at?: string | null;
};

export type CallLogStats = {
  total: number;
  missed: number;
  unrecorded: number;
  answered: number;
  answeredRate: number;
  avgTalkSeconds: number;
  withQa: number;
  totalTalkSeconds: number;
};

export type PersonTalkRow = {
  key: string;
  name: string;
  user: string | null;
  extension: string | null;
  calls: number;
  talkSeconds: number;
  answered: number;
  missed: number;
  abandoned: number;
  voicemail: number;
};

export type ResultBreakdownRow = {
  result: string;
  count: number;
  talkSeconds: number;
};

export function isMissedResult(result?: string | null): boolean {
  const text = (result || "").trim().toLowerCase();
  if (!text) return false;
  return text !== "answered" && text !== "connected";
}

export function normalizeResult(result?: string | null): string {
  const text = (result || "").trim();
  return text || "Unknown";
}

export function isAbandonedResult(result?: string | null): boolean {
  return normalizeResult(result).toLowerCase().includes("abandon");
}

export function partyFromLog(log: CallLogDoc): {
  key: string;
  name: string;
  user: string | null;
  extension: string | null;
} {
  const direction = (log.direction || "").toLowerCase();
  const preferDest = direction === "inbound" || direction === "extension";

  const destName = (log.destination_user_full_name || "").trim() || null;
  const srcName = (log.source_user_full_name || "").trim() || null;
  const destUser = (log.destination_user || "").trim() || null;
  const srcUser = (log.source_user || "").trim() || null;
  const destExt = (log.destination_extension || "").trim() || null;
  const srcExt = (log.source_extension || "").trim() || null;

  const name = preferDest ? destName || srcName : srcName || destName;
  const user = preferDest ? destUser || srcUser : srcUser || destUser;
  const extension = preferDest ? destExt || srcExt : srcExt || destExt;

  const displayName = name || user || (extension ? `Ext ${extension}` : "Unknown");
  const key = (user || extension || displayName).toLowerCase();
  return { key, name: displayName, user, extension };
}

export function summarizeCallLogs(logs: CallLogDoc[]): CallLogStats {
  const total = logs.length;
  let missed = 0;
  let unrecorded = 0;
  let answered = 0;
  let talkSum = 0;
  let talkN = 0;
  let withQa = 0;
  let totalTalkSeconds = 0;
  for (const log of logs) {
    const isMissed = !!(log.is_missed || isMissedResult(log.result));
    if (isMissed) missed += 1;
    else answered += 1;
    if (log.recorded === false || log.is_unrecorded) unrecorded += 1;
    if (log.matched_call_id) withQa += 1;
    const len = Number(log.length_seconds || 0);
    totalTalkSeconds += Math.max(0, len);
    if (len > 0) {
      talkSum += len;
      talkN += 1;
    }
  }
  return {
    total,
    missed,
    unrecorded,
    answered,
    answeredRate: total ? answered / total : 0,
    avgTalkSeconds: talkN ? talkSum / talkN : 0,
    withQa,
    totalTalkSeconds,
  };
}

export function talkTimeByPerson(logs: CallLogDoc[]): PersonTalkRow[] {
  const map = new Map<string, PersonTalkRow>();
  for (const log of logs) {
    const party = partyFromLog(log);
    const existing = map.get(party.key) || {
      key: party.key,
      name: party.name,
      user: party.user,
      extension: party.extension,
      calls: 0,
      talkSeconds: 0,
      answered: 0,
      missed: 0,
      abandoned: 0,
      voicemail: 0,
    };
    existing.calls += 1;
    existing.talkSeconds += Math.max(0, Number(log.length_seconds || 0));
    const result = normalizeResult(log.result).toLowerCase();
    if (result === "answered" || result === "connected") existing.answered += 1;
    else if (result.includes("abandon")) existing.abandoned += 1;
    else if (result.includes("voicemail")) existing.voicemail += 1;
    else if (isMissedResult(log.result)) existing.missed += 1;
    map.set(party.key, existing);
  }
  return [...map.values()].sort(
    (a, b) => b.talkSeconds - a.talkSeconds || b.calls - a.calls
  );
}

export function resultBreakdown(logs: CallLogDoc[]): ResultBreakdownRow[] {
  const map = new Map<string, ResultBreakdownRow>();
  for (const log of logs) {
    const result = normalizeResult(log.result);
    const existing = map.get(result) || { result, count: 0, talkSeconds: 0 };
    existing.count += 1;
    existing.talkSeconds += Math.max(0, Number(log.length_seconds || 0));
    map.set(result, existing);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import {
  getFirestore,
  Firestore,
  Query,
  DocumentData,
  Timestamp,
} from "firebase-admin/firestore";
import fs from "fs";
import { isQaEligibleDuration } from "@/lib/qa";
import type { CallLogDoc } from "@/lib/callLogs";
import { isMissedResult } from "@/lib/callLogs";

export type { CallLogDoc, CallLogStats } from "@/lib/callLogs";
export { summarizeCallLogs } from "@/lib/callLogs";

export function isFirestoreQuotaError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /RESOURCE_EXHAUSTED|Quota exceeded/i.test(message);
}

let app: App | undefined;
let db: Firestore | undefined;

function loadServiceAccount(): Record<string, string> {
  const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (path && fs.existsSync(path)) {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  }
  if (raw) {
    return JSON.parse(raw);
  }
  throw new Error(
    "Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT for the web app."
  );
}

export function getDb(): Firestore {
  if (db) return db;
  if (!getApps().length) {
    const sa = loadServiceAccount();
    app = initializeApp({
      credential: cert(sa as Parameters<typeof cert>[0]),
      projectId: sa.project_id,
    });
  } else {
    app = getApps()[0];
  }
  db = getFirestore(app);
  return db;
}

export type CallTopic = {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
};

export type TopicSet = {
  version: string;
  name: string;
  description?: string;
  topics: CallTopic[];
};

export type QaRule = {
  id: string;
  label: string;
  description?: string;
  category?: string;
  weight?: number;
  auto_fail?: boolean;
  pass_criteria?: string;
  active?: boolean;
};

export type QaRuleset = {
  version: string;
  name: string;
  description?: string;
  auto_fail_quality_cap?: number;
  empathy_pass_threshold?: number;
  transfer_soft_limit?: number;
  transfer_auto_fail_at?: number;
  rules: QaRule[];
};

export async function getCallTopics(): Promise<TopicSet> {
  const snap = await getDb().collection("call_topics").doc("current").get();
  if (!snap.exists) {
    return {
      version: "v1",
      name: "Call Topics",
      description: "",
      topics: [],
    };
  }
  const data = serializeDoc<TopicSet & { id: string }>(snap.id, snap.data());
  return {
    version: String(data.version || "v1"),
    name: String(data.name || "Call Topics"),
    description: String(data.description || ""),
    topics: Array.isArray(data.topics) ? data.topics : [],
  };
}

export async function saveCallTopics(topicset: TopicSet): Promise<TopicSet> {
  const now = new Date();
  const payload = {
    version: topicset.version || "v1",
    name: topicset.name || "Call Topics",
    description: topicset.description || "",
    topics: topicset.topics,
    updated_at: now,
  };
  await getDb().collection("call_topics").doc("current").set(payload, { merge: true });
  await getDb()
    .collection("call_topics")
    .doc(payload.version)
    .set(payload, { merge: true });
  return getCallTopics();
}

export async function upsertCallTopic(input: {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
}): Promise<TopicSet> {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new Error("Topic id must be lowercase letters, numbers, underscores");
  }
  const label = input.label.trim();
  if (!label) throw new Error("Label is required");

  const current = await getCallTopics();
  const topics = [...current.topics];
  const idx = topics.findIndex((t) => t.id === id);
  const row: CallTopic = {
    id,
    label,
    description: (input.description || "").trim(),
    active: input.active !== false,
  };
  if (idx >= 0) topics[idx] = { ...topics[idx], ...row };
  else topics.push(row);

  return saveCallTopics({ ...current, topics });
}

export async function setCallTopicActive(
  id: string,
  active: boolean
): Promise<TopicSet> {
  const current = await getCallTopics();
  const topics = current.topics.map((t) =>
    t.id === id ? { ...t, active } : t
  );
  return saveCallTopics({ ...current, topics });
}

export type CallFlag = {
  id: string;
  label: string;
  description?: string;
  severity?: string;
  active?: boolean;
};

export type FlagSet = {
  version: string;
  name: string;
  description?: string;
  flags: CallFlag[];
};

export async function getCallFlags(): Promise<FlagSet> {
  const snap = await getDb().collection("call_flags").doc("current").get();
  if (!snap.exists) {
    return {
      version: "v1",
      name: "Critical Call Flags",
      description: "",
      flags: [],
    };
  }
  const data = serializeDoc<FlagSet & { id: string }>(snap.id, snap.data());
  return {
    version: String(data.version || "v1"),
    name: String(data.name || "Critical Call Flags"),
    description: String(data.description || ""),
    flags: Array.isArray(data.flags) ? data.flags : [],
  };
}

export async function saveCallFlags(flagset: FlagSet): Promise<FlagSet> {
  const now = new Date();
  const payload = {
    version: flagset.version || "v1",
    name: flagset.name || "Critical Call Flags",
    description: flagset.description || "",
    flags: flagset.flags,
    updated_at: now,
  };
  await getDb().collection("call_flags").doc("current").set(payload, { merge: true });
  await getDb()
    .collection("call_flags")
    .doc(payload.version)
    .set(payload, { merge: true });
  return getCallFlags();
}

export async function upsertCallFlag(input: {
  id: string;
  label: string;
  description?: string;
  severity?: string;
  active?: boolean;
}): Promise<FlagSet> {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new Error("Flag id must be lowercase letters, numbers, underscores");
  }
  const label = input.label.trim();
  if (!label) throw new Error("Label is required");

  const current = await getCallFlags();
  const flags = [...current.flags];
  const idx = flags.findIndex((f) => f.id === id);
  const row: CallFlag = {
    id,
    label,
    description: (input.description || "").trim(),
    severity: (input.severity || "critical").trim() || "critical",
    active: input.active !== false,
  };
  if (idx >= 0) flags[idx] = { ...flags[idx], ...row };
  else flags.push(row);

  return saveCallFlags({ ...current, flags });
}

export async function setCallFlagActive(
  id: string,
  active: boolean
): Promise<FlagSet> {
  const current = await getCallFlags();
  const flags = current.flags.map((f) => (f.id === id ? { ...f, active } : f));
  return saveCallFlags({ ...current, flags });
}

export async function getQaRules(): Promise<QaRuleset> {
  const snap = await getDb().collection("qa_rules").doc("current").get();
  if (!snap.exists) {
    return {
      version: "v1",
      name: "QA Rules",
      description: "",
      auto_fail_quality_cap: 4,
      empathy_pass_threshold: 7,
      transfer_soft_limit: 1,
      transfer_auto_fail_at: 3,
      rules: [],
    };
  }
  const data = serializeDoc<QaRuleset & { id: string }>(snap.id, snap.data());
  return {
    version: String(data.version || "v1"),
    name: String(data.name || "QA Rules"),
    description: String(data.description || ""),
    auto_fail_quality_cap:
      typeof data.auto_fail_quality_cap === "number"
        ? data.auto_fail_quality_cap
        : 4,
    empathy_pass_threshold:
      typeof data.empathy_pass_threshold === "number"
        ? data.empathy_pass_threshold
        : 7,
    transfer_soft_limit:
      typeof data.transfer_soft_limit === "number" ? data.transfer_soft_limit : 1,
    transfer_auto_fail_at:
      typeof data.transfer_auto_fail_at === "number"
        ? data.transfer_auto_fail_at
        : 3,
    rules: Array.isArray(data.rules) ? data.rules : [],
  };
}

export async function saveQaRules(ruleset: QaRuleset): Promise<QaRuleset> {
  const now = new Date();
  const payload = {
    version: ruleset.version || "v1",
    name: ruleset.name || "QA Rules",
    description: ruleset.description || "",
    auto_fail_quality_cap: ruleset.auto_fail_quality_cap ?? 4,
    empathy_pass_threshold: ruleset.empathy_pass_threshold ?? 7,
    transfer_soft_limit: ruleset.transfer_soft_limit ?? 1,
    transfer_auto_fail_at: ruleset.transfer_auto_fail_at ?? 3,
    rules: ruleset.rules,
    updated_at: now,
  };
  await getDb().collection("qa_rules").doc("current").set(payload, { merge: true });
  await getDb().collection("qa_rules").doc(payload.version).set(payload, { merge: true });
  return getQaRules();
}

export async function upsertQaRule(input: {
  id: string;
  label: string;
  description?: string;
  category?: string;
  weight?: number;
  auto_fail?: boolean;
  pass_criteria?: string;
  active?: boolean;
}): Promise<QaRuleset> {
  const id = input.id.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(id)) {
    throw new Error("Rule id must be lowercase letters, numbers, underscores");
  }
  const label = input.label.trim();
  if (!label) throw new Error("Label is required");

  const current = await getQaRules();
  const rules = [...current.rules];
  const idx = rules.findIndex((r) => r.id === id);
  const row: QaRule = {
    id,
    label,
    description: (input.description || "").trim(),
    category: (input.category || "Process").trim() || "Process",
    weight:
      typeof input.weight === "number" && !Number.isNaN(input.weight)
        ? input.weight
        : 1,
    auto_fail: !!input.auto_fail,
    pass_criteria: (input.pass_criteria || "").trim(),
    active: input.active !== false,
  };
  if (idx >= 0) rules[idx] = { ...rules[idx], ...row };
  else rules.push(row);

  return saveQaRules({ ...current, rules });
}

export async function setQaRuleActive(
  id: string,
  active: boolean
): Promise<QaRuleset> {
  const current = await getQaRules();
  const rules = current.rules.map((r) =>
    r.id === id ? { ...r, active } : r
  );
  return saveQaRules({ ...current, rules });
}

export async function updateQaRulesetMeta(input: {
  name?: string;
  description?: string;
  auto_fail_quality_cap?: number;
  empathy_pass_threshold?: number;
  transfer_soft_limit?: number;
  transfer_auto_fail_at?: number;
}): Promise<QaRuleset> {
  const current = await getQaRules();
  return saveQaRules({
    ...current,
    name: input.name?.trim() || current.name,
    description:
      input.description !== undefined
        ? input.description.trim()
        : current.description,
    auto_fail_quality_cap:
      typeof input.auto_fail_quality_cap === "number"
        ? input.auto_fail_quality_cap
        : current.auto_fail_quality_cap,
    empathy_pass_threshold:
      typeof input.empathy_pass_threshold === "number"
        ? input.empathy_pass_threshold
        : current.empathy_pass_threshold,
    transfer_soft_limit:
      typeof input.transfer_soft_limit === "number"
        ? input.transfer_soft_limit
        : current.transfer_soft_limit,
    transfer_auto_fail_at:
      typeof input.transfer_auto_fail_at === "number"
        ? input.transfer_auto_fail_at
        : current.transfer_auto_fail_at,
  });
}

export type CallDoc = {
  id: string;
  agent_name?: string;
  agent_email?: string | null;
  patient_name?: string | null;
  doctor_name?: string | null;
  call_date?: string | null;
  duration_seconds?: number;
  time_to_answer_seconds?: number | null;
  topic?: string;
  topic_id?: string;
  ai_empathy_score?: number;
  ai_name_stated?: boolean;
  ai_summary?: string;
  transcript?: Array<{ speaker?: string; text?: string; timestamp?: string }>;
  /** Source-language turns when transcript was translated to English. */
  transcript_original?: Array<{ speaker?: string; text?: string; timestamp?: string }>;
  /** BCP-47-ish primary language of the source transcript (e.g. "es", "en"). */
  transcript_language?: string | null;
  transcript_translated?: boolean;
  /** Amazon Transcribe LanguageCode when available (e.g. "es-US"). */
  stt_language?: string | null;
  transfer_count?: number;
  fcr?: boolean;
  quality_score?: number;
  rule_results?: Array<{
    rule_id?: string;
    label?: string;
    category?: string;
    passed?: boolean;
    score_1_to_10?: number | null;
    evidence?: string;
    evidence_timestamp?: string;
    evidence_turn_index?: number | null;
    notes?: string;
    auto_fail?: boolean;
    weight?: number;
  }>;
  ruleset_version?: string;
  auto_failed?: boolean;
  auto_fail_rules?: string[];
  critical_flags?: Array<{
    flag_id?: string;
    label?: string;
    severity?: string;
    triggered?: boolean;
    evidence?: string;
    evidence_timestamp?: string;
    evidence_turn_index?: number | null;
    notes?: string;
  }>;
  has_critical_flags?: boolean;
  flagset_version?: string;
  sentiment_label?: "positive" | "neutral" | "negative" | "mixed" | string;
  sentiment_score?: number | null;
  sentiment_notes?: string;
  manager_feedback?: string;
  manager_notes?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  recording_url?: string;
  recording_storage_uri?: string;
  original_filename?: string;
  status?: string;
  vonage_caller_id?: string | null;
  vonage_cnam?: string | null;
  vonage_direction?: string | null;
};

export type UserDoc = {
  email: string;
  name?: string;
  role?: string;
  rolling_ai_feedback?: string;
  last_coaching_at?: string | null;
  provisional?: boolean;
  active?: boolean;
  /** VBC extension number used to identify this agent on CDRs. */
  extension?: string | null;
};

function serializeValue(value: unknown): unknown {
  if (value == null) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeValue(v);
    }
    return out;
  }
  return value;
}

function serializeDoc<T>(id: string, data: DocumentData | undefined): T {
  return { id, ...(serializeValue(data || {}) as Record<string, unknown>) } as unknown as T;
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value instanceof Date) return value.getTime();
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  const anyVal = value as { _seconds?: number; seconds?: number };
  if (typeof anyVal._seconds === "number") return anyVal._seconds * 1000;
  if (typeof anyVal.seconds === "number") return anyVal.seconds * 1000;
  return 0;
}

export async function getUser(email: string): Promise<UserDoc | null> {
  const snap = await getDb().collection("users").doc(email.toLowerCase()).get();
  if (!snap.exists) return null;
  return serializeDoc<UserDoc>(snap.id, snap.data());
}

export async function upsertUser(input: {
  email: string;
  name: string;
  role: string;
  provisional?: boolean;
}): Promise<UserDoc> {
  const ref = getDb().collection("users").doc(input.email.toLowerCase());
  const existing = await ref.get();
  const now = new Date();
  if (existing.exists) {
    const updates: Record<string, unknown> = {
      name: input.name,
      role: input.role,
      updated_at: now,
    };
    if (input.provisional !== undefined) updates.provisional = input.provisional;
    await ref.update(updates);
  } else {
    await ref.set({
      email: input.email.toLowerCase(),
      name: input.name,
      role: input.role,
      rolling_ai_feedback: "",
      active: true,
      provisional: !!input.provisional,
      created_at: now,
      updated_at: now,
    });
  }
  const calls = await getDb()
    .collection("calls")
    .where("agent_email", "==", input.email.toLowerCase())
    .limit(500)
    .get();
  if (!calls.empty) {
    const batch = getDb().batch();
    let pending = 0;
    for (const doc of calls.docs) {
      if (doc.get("agent_name") !== input.name) {
        batch.update(doc.ref, { agent_name: input.name, updated_at: now });
        pending += 1;
      }
    }
    if (pending > 0) await batch.commit();
  }
  const snap = await ref.get();
  return serializeDoc<UserDoc>(snap.id, snap.data());
}

export async function listCalls(opts?: {
  agentEmail?: string | null;
  limit?: number;
  status?: string;
  sinceMs?: number | null;
  /** Default true: only calls longer than 30 seconds. */
  requireMinDuration?: boolean;
}): Promise<CallDoc[]> {
  const limit = opts?.limit ?? 100;
  const requireMinDuration = opts?.requireMinDuration !== false;
  let query: Query = getDb().collection("calls");
  if (opts?.agentEmail) {
    query = query.where("agent_email", "==", opts.agentEmail.toLowerCase());
  }
  if (opts?.status) {
    query = query.where("status", "==", opts.status);
  }
  query = query.orderBy("call_date", "desc").limit(requireMinDuration ? Math.min(limit * 3, 400) : limit);
  try {
    const snap = await query.get();
    let rows = snap.docs.map((d) => serializeDoc<CallDoc>(d.id, d.data()));
    if (opts?.sinceMs) {
      rows = rows.filter((r) => toMillis(r.call_date) >= opts.sinceMs!);
    }
    if (requireMinDuration) {
      rows = rows.filter((r) => isQaEligibleDuration(r.duration_seconds));
    }
    return rows.slice(0, limit);
  } catch (err) {
    if (isFirestoreQuotaError(err)) throw err;
    const snap = await getDb().collection("calls").limit(Math.min(limit * 2, 200)).get();
    let rows = snap.docs.map((d) => serializeDoc<CallDoc>(d.id, d.data()));
    if (opts?.agentEmail) {
      rows = rows.filter(
        (r) => (r.agent_email || "").toLowerCase() === opts.agentEmail!.toLowerCase()
      );
    }
    if (opts?.status) {
      rows = rows.filter((r) => r.status === opts.status);
    }
    if (opts?.sinceMs) {
      rows = rows.filter((r) => toMillis(r.call_date) >= opts.sinceMs!);
    }
    if (requireMinDuration) {
      rows = rows.filter((r) => isQaEligibleDuration(r.duration_seconds));
    }
    rows.sort((a, b) => toMillis(b.call_date) - toMillis(a.call_date));
    return rows.slice(0, limit);
  }
}

export async function listCallLogs(opts?: {
  limit?: number;
  days?: number | null;
  result?: string | null;
  recorded?: boolean | null;
  direction?: string | null;
  missedOnly?: boolean;
  unrecordedOnly?: boolean;
}): Promise<CallLogDoc[]> {
  // Keep reads small — Ops loads this on every refresh.
  const limit = Math.min(Math.max(opts?.limit ?? 200, 1), 20000);
  const days = opts?.days && opts.days > 0 ? opts.days : null;
  const cutoff = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000) : null;

  let rows: CallLogDoc[] = [];
  try {
    let query: Query = getDb().collection("call_logs");
    if (cutoff) {
      query = query.where("start", ">=", cutoff);
    }
    query = query.orderBy("start", "desc").limit(limit);
    const snap = await query.get();
    rows = snap.docs.map((d) => serializeDoc<CallLogDoc>(d.id, d.data()));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Avoid a second huge scan when quota is already exhausted.
    if (isFirestoreQuotaError(err) || /RESOURCE_EXHAUSTED|Quota exceeded/i.test(message)) {
      throw err;
    }
    // Fallback: recent docs only (no orderBy), then sort in memory.
    const snap = await getDb()
      .collection("call_logs")
      .limit(Math.min(limit, 300))
      .get();
    rows = snap.docs.map((d) => serializeDoc<CallLogDoc>(d.id, d.data()));
    rows.sort((a, b) => toMillis(b.start) - toMillis(a.start));
    if (cutoff) {
      const cutoffMs = cutoff.getTime();
      rows = rows.filter((r) => {
        const ms = toMillis(r.start);
        return !ms || ms >= cutoffMs;
      });
    }
  }

  if (opts?.result) {
    const needle = opts.result.trim().toLowerCase();
    rows = rows.filter((r) => (r.result || "").trim().toLowerCase() === needle);
  }
  if (opts?.recorded !== undefined && opts?.recorded !== null) {
    rows = rows.filter((r) => r.recorded === opts.recorded);
  }
  if (opts?.direction) {
    const needle = opts.direction.trim().toLowerCase();
    rows = rows.filter((r) => (r.direction || "").trim().toLowerCase() === needle);
  }
  if (opts?.missedOnly) {
    rows = rows.filter((r) => r.is_missed || isMissedResult(r.result));
  }
  if (opts?.unrecordedOnly) {
    rows = rows.filter((r) => r.recorded === false || r.is_unrecorded);
  }
  return rows.slice(0, limit);
}

export async function listUsers(): Promise<UserDoc[]> {
  const snap = await getDb().collection("users").limit(200).get();
  return snap.docs
    .map((d) => serializeDoc<UserDoc>(d.id, d.data()))
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}

export async function setUserActive(email: string, active: boolean): Promise<UserDoc> {
  const ref = getDb().collection("users").doc(email.toLowerCase());
  const snap = await ref.get();
  if (!snap.exists) throw new Error("User not found");
  await ref.update({ active, updated_at: new Date() });
  const next = await ref.get();
  return serializeDoc<UserDoc>(next.id, next.data());
}

/**
 * Move a provisional agent identity onto a real Workspace email.
 * Updates the user record and remaps calls that used the provisional email.
 */
export async function linkProvisionalAgent(input: {
  provisionalEmail: string;
  realEmail: string;
  name?: string;
}): Promise<{ user: UserDoc; remappedCalls: number }> {
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();
  const from = input.provisionalEmail.trim().toLowerCase();
  const to = input.realEmail.trim().toLowerCase();
  if (!from.startsWith("unmapped.")) {
    throw new Error("Source must be a provisional unmapped.* agent");
  }
  if (!to.endsWith(`@${domain}`)) {
    throw new Error(`Real email must be @${domain}`);
  }

  const provisional = await getUser(from);
  if (!provisional) throw new Error("Provisional agent not found");

  const name = (input.name || provisional.name || to.split("@")[0]).trim();
  const user = await upsertUser({
    email: to,
    name,
    role: provisional.role || "Agent",
    provisional: false,
  });

  // Remap calls pointing at the provisional identity
  const snap = await getDb()
    .collection("calls")
    .where("agent_email", "==", from)
    .limit(500)
    .get();
  const batch = getDb().batch();
  let count = 0;
  const now = new Date();
  for (const doc of snap.docs) {
    batch.update(doc.ref, {
      agent_email: to,
      agent_name: name,
      updated_at: now,
    });
    count += 1;
  }
  if (count) await batch.commit();

  // Soft-deactivate provisional placeholder
  await getDb()
    .collection("users")
    .doc(from)
    .update({
      active: false,
      provisional: true,
      linked_to: to,
      updated_at: now,
    });

  return { user, remappedCalls: count };
}

export async function getCall(id: string): Promise<CallDoc | null> {
  const snap = await getDb().collection("calls").doc(id).get();
  if (!snap.exists) return null;
  return serializeDoc<CallDoc>(snap.id, snap.data());
}

export async function saveManagerReview(input: {
  callId: string;
  managerFeedback: string;
  managerNotes: string;
  reviewerEmail: string;
  reviewerName: string;
}): Promise<void> {
  const call = await getCall(input.callId);
  if (!call) throw new Error("Call not found");
  const now = new Date();
  await getDb()
    .collection("calls")
    .doc(input.callId)
    .update({
      manager_feedback: input.managerFeedback,
      manager_notes: input.managerNotes,
      reviewed_by: input.reviewerEmail,
      reviewed_at: now,
      updated_at: now,
    });
  if (input.managerFeedback.trim()) {
    await getDb().collection("feedback").add({
      call_id: input.callId,
      agent_email: call.agent_email || null,
      agent_name: call.agent_name || "",
      author_email: input.reviewerEmail.toLowerCase(),
      author_name: input.reviewerName,
      text: input.managerFeedback.trim(),
      call_date: call.call_date || null,
      topic: call.topic || null,
      created_at: now,
    });
  }
}

function slugifyAgentName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "") || "unknown"
  );
}

/** diana / diana.lopez @ releviumpain.com */
export function suggestedAgentEmail(name: string): string {
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();
  return `${slugifyAgentName(name)}@${domain}`;
}

export function provisionalAgentEmail(name: string): string {
  return suggestedAgentEmail(name);
}

export type UnmappedAgentRow = {
  agent_name: string;
  suggested_email: string;
  current_email?: string | null;
  call_count: number;
  mapped: boolean;
  provisional: boolean;
  user_exists: boolean;
};

function namesMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const lp = left.split(/\s+/);
  const rp = right.split(/\s+/);
  if (lp.length === 1 && lp[0] === rp[0]) return true;
  if (rp.length === 1 && rp[0] === lp[0]) return true;
  return left.includes(right) || right.includes(left);
}

export async function discoverUnmappedAgents(
  callLimit = 400
): Promise<UnmappedAgentRow[]> {
  const [calls, users] = await Promise.all([
    listCalls({ status: "complete", limit: callLimit, requireMinDuration: false }),
    listUsers(),
  ]);
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const byName = new Map<string, UnmappedAgentRow>();

  for (const call of calls) {
    const name = (call.agent_name || "").trim();
    const email = (call.agent_email || "").trim().toLowerCase();
    if (!name || /^unknown$/i.test(name)) continue;
    const key = name.toLowerCase();
    let row = byName.get(key);
    if (!row) {
      const suggested = suggestedAgentEmail(name);
      const user = (email && byEmail.get(email)) || byEmail.get(suggested);
      const mapped = !!(
        email &&
        byEmail.has(email) &&
        !byEmail.get(email)?.provisional &&
        !email.startsWith("unmapped.")
      );
      row = {
        agent_name: name,
        suggested_email: suggested,
        current_email: email || null,
        call_count: 0,
        mapped,
        provisional: !!(
          user?.provisional ||
          (email || suggested).startsWith("unmapped.")
        ),
        user_exists: !!user,
      };
      byName.set(key, row);
    }
    row.call_count += 1;
    if (email && !row.current_email) row.current_email = email;
  }

  for (const u of users) {
    const email = u.email.toLowerCase();
    if (!(u.provisional || email.startsWith("unmapped."))) continue;
    const name = (u.name || email.split("@")[0]).trim();
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      existing.provisional = true;
      existing.user_exists = true;
      existing.current_email = email;
      continue;
    }
    byName.set(key, {
      agent_name: name,
      suggested_email: suggestedAgentEmail(name),
      current_email: email,
      call_count: 0,
      mapped: false,
      provisional: true,
      user_exists: true,
    });
  }

  return [...byName.values()].sort(
    (a, b) => b.call_count - a.call_count || a.agent_name.localeCompare(b.agent_name)
  );
}

export async function importAndMapAgent(input: {
  agentName: string;
  email?: string | null;
  role?: string;
}): Promise<{ user: UserDoc; remappedCalls: number; email: string; name: string }> {
  const cleaned = (input.agentName || "").trim();
  if (!cleaned || /^unknown$/i.test(cleaned)) {
    throw new Error("Agent name is required");
  }
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();
  const target = (input.email || suggestedAgentEmail(cleaned)).trim().toLowerCase();
  if (!target.endsWith(`@${domain}`)) {
    throw new Error(`Email must be @${domain}`);
  }

  const user = await upsertUser({
    email: target,
    name: cleaned,
    role: input.role || "Agent",
    provisional: false,
  });

  const calls = await listCalls({
    status: "complete",
    limit: 500,
    requireMinDuration: false,
  });
  const now = new Date();
  let remappedCalls = 0;
  for (const call of calls) {
    const name = (call.agent_name || "").trim();
    const cur = (call.agent_email || "").trim().toLowerCase();
    if (!namesMatch(cleaned, name)) continue;
    if (cur && cur === target) {
      await getDb()
        .collection("calls")
        .doc(call.id)
        .update({ agent_name: cleaned, updated_at: now });
      continue;
    }
    if (cur && !cur.startsWith("unmapped.") && cur !== target) continue;
    await getDb()
      .collection("calls")
      .doc(call.id)
      .update({
        agent_email: target,
        agent_name: cleaned,
        updated_at: now,
      });
    remappedCalls += 1;
  }

  return { user, remappedCalls, email: target, name: cleaned };
}

export async function assignCallAgent(input: {
  callId: string;
  agentEmail?: string | null;
  agentName?: string | null;
  createName?: string | null;
  createEmail?: string | null;
}): Promise<CallDoc> {
  const call = await getCall(input.callId);
  if (!call) throw new Error("Call not found");

  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();
  let email = (input.agentEmail || "").trim().toLowerCase();
  let name = (input.agentName || "").trim();

  if (input.createName?.trim()) {
    name = input.createName.trim();
    const provided = (input.createEmail || "").trim().toLowerCase();
    email = provided || suggestedAgentEmail(name);
    if (!email.endsWith(`@${domain}`)) {
      throw new Error(`Email must be @${domain}`);
    }
    await upsertUser({
      email,
      name,
      role: "Agent",
      provisional: false,
    });
  } else if (email) {
    const user = await getUser(email);
    if (user) {
      name = user.name || name || email;
    } else if (!name) {
      throw new Error("Unknown agent email");
    }
  } else {
    throw new Error("Select an agent or create one");
  }

  const now = new Date();
  await getDb()
    .collection("calls")
    .doc(input.callId)
    .update({
      agent_email: email,
      agent_name: name,
      updated_at: now,
    });

  const updated = await getCall(input.callId);
  if (!updated) throw new Error("Call update failed");
  return updated;
}

export type MetricDoc = {
  id: string;
  agent_email?: string;
  agent_name?: string;
  week_start?: string;
  week_end?: string;
  call_count?: number;
  avg_empathy_score?: number;
  avg_quality_score?: number;
  fcr_rate?: number;
  avg_transfers?: number;
  total_talk_time_seconds?: number;
};

export async function setRollingFeedback(
  email: string,
  feedback: string
): Promise<UserDoc> {
  const ref = getDb().collection("users").doc(email.toLowerCase());
  const snap = await ref.get();
  if (!snap.exists) throw new Error("User not found");
  await ref.update({
    rolling_ai_feedback: feedback,
    last_coaching_at: new Date(),
    updated_at: new Date(),
  });
  const next = await ref.get();
  return serializeDoc<UserDoc>(next.id, next.data());
}

export async function listMetricsForAgent(
  agentEmail: string,
  limit = 8
): Promise<MetricDoc[]> {
  try {
    const snap = await getDb()
      .collection("metrics")
      .where("agent_email", "==", agentEmail.toLowerCase())
      .orderBy("week_start", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => serializeDoc<MetricDoc>(d.id, d.data()));
  } catch {
    const snap = await getDb().collection("metrics").limit(200).get();
    return snap.docs
      .map((d) => serializeDoc<MetricDoc>(d.id, d.data()))
      .filter((m) => (m.agent_email || "").toLowerCase() === agentEmail.toLowerCase())
      .sort((a, b) => String(b.week_start || "").localeCompare(String(a.week_start || "")))
      .slice(0, limit);
  }
}

export async function listFeedbackForAgent(
  agentEmail: string,
  limit = 40
): Promise<Array<{ id: string; text?: string; created_at?: string }>> {
  try {
    const snap = await getDb()
      .collection("feedback")
      .where("agent_email", "==", agentEmail.toLowerCase())
      .orderBy("created_at", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) =>
      serializeDoc<{ id: string; text?: string; created_at?: string }>(d.id, d.data())
    );
  } catch {
    return [];
  }
}

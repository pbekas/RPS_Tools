import "server-only";

import { randomUUID } from "crypto";
import type { PoolClient, QueryResultRow } from "pg";
import * as firestore from "@/lib/firestore";
import { query, withTransaction } from "@/lib/postgres";
import { summarizeCallLogs } from "@/lib/callLogs";
import type { CallLogDoc, CallLogStats } from "@/lib/callLogs";

export type {
  CallDoc,
  CallFlag,
  FlagSet,
  MetricDoc,
  QaRule,
  QaRuleset,
  TopicSet,
  CallTopic,
  UnmappedAgentRow,
  UserDoc,
} from "@/lib/firestore";
export type { CallLogDoc, CallLogStats };
export { summarizeCallLogs };

import type {
  CallDoc,
  CallFlag,
  FlagSet,
  MetricDoc,
  QaRule,
  QaRuleset,
  TopicSet,
  CallTopic,
  UnmappedAgentRow,
  UserDoc,
} from "@/lib/firestore";

const usePostgres = () => process.env.DB_BACKEND?.trim().toLowerCase() === "postgres";

export function isFirestoreQuotaError(error: unknown): boolean {
  return !usePostgres() && firestore.isFirestoreQuotaError(error);
}

const NUMERIC_FIELDS = new Set([
  "ai_empathy_score",
  "quality_score",
  "sentiment_score",
  "score_1_to_10",
  "weight",
  "charge",
  "rate",
  "avg_talk_time_seconds",
  "avg_empathy_score",
  "avg_quality_score",
  "fcr_rate",
  "avg_transfers",
]);

function serializePgValue(value: unknown, key = ""): unknown {
  if (value == null) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => serializePgValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        serializePgValue(child, childKey),
      ])
    );
  }
  if (NUMERIC_FIELDS.has(key) && typeof value === "string") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  return value;
}

function serializeRow<T>(row: QueryResultRow): T {
  return serializePgValue(row) as T;
}

function serializeCallRow(row: QueryResultRow): CallDoc {
  const { analysis_raw: analysisRaw, ...columns } = row;
  const raw =
    analysisRaw && typeof analysisRaw === "object" && !Array.isArray(analysisRaw)
      ? (analysisRaw as Record<string, unknown>)
      : {};
  return serializePgValue({ ...raw, ...columns }) as CallDoc;
}

type ConfigKind = "call_topics" | "call_flags" | "qa_rules";

const topicDefaults: TopicSet = {
  version: "v1",
  name: "Call Topics",
  description: "",
  topics: [],
};
const flagDefaults: FlagSet = {
  version: "v1",
  name: "Critical Call Flags",
  description: "",
  flags: [],
};
const ruleDefaults: QaRuleset = {
  version: "v1",
  name: "QA Rules",
  description: "",
  auto_fail_quality_cap: 4,
  empathy_pass_threshold: 7,
  transfer_soft_limit: 1,
  transfer_auto_fail_at: 3,
  rules: [],
};

async function pgGetConfig<T extends TopicSet | FlagSet | QaRuleset>(
  kind: ConfigKind,
  defaults: T,
  client?: PoolClient
): Promise<T> {
  const runner = client
    ? <R extends QueryResultRow>(text: string, values: unknown[]) =>
        client.query<R>(text, values).then((result) => result.rows)
    : query;
  const rows = await runner<{
    version: string;
    name: string;
    description: string;
    payload: Record<string, unknown>;
  }>(
    `SELECT version, name, description, payload
       FROM config_sets
      WHERE kind = $1 AND is_current = true
      LIMIT 1`,
    [kind]
  );
  const row = rows[0];
  if (!row) return { ...defaults };
  return serializePgValue({
    ...defaults,
    ...row.payload,
    version: row.version,
    name: row.name,
    description: row.description,
  }) as T;
}

async function pgSaveConfig<T extends TopicSet | FlagSet | QaRuleset>(
  kind: ConfigKind,
  value: T
): Promise<T> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `config_sets:${kind}`,
    ]);
    await client.query(
      "UPDATE config_sets SET is_current = false, updated_at = now() WHERE kind = $1 AND is_current",
      [kind]
    );
    await client.query(
      `INSERT INTO config_sets
         (kind, version, name, description, payload, is_current, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, true, now())
       ON CONFLICT (kind, version) DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         payload = EXCLUDED.payload,
         is_current = true,
         updated_at = now()`,
      [
        kind,
        value.version || "v1",
        value.name,
        value.description || "",
        JSON.stringify(value),
      ]
    );
    return pgGetConfig(kind, value, client);
  });
}

async function pgMutateConfig<T extends TopicSet | FlagSet | QaRuleset>(
  kind: ConfigKind,
  defaults: T,
  mutate: (current: T) => T
): Promise<T> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `config_sets:${kind}`,
    ]);
    const next = mutate(await pgGetConfig(kind, defaults, client));
    await client.query(
      "UPDATE config_sets SET is_current = false, updated_at = now() WHERE kind = $1 AND is_current",
      [kind]
    );
    await client.query(
      `INSERT INTO config_sets
         (kind, version, name, description, payload, is_current, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, true, now())
       ON CONFLICT (kind, version) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         payload = EXCLUDED.payload, is_current = true, updated_at = now()`,
      [
        kind,
        next.version || "v1",
        next.name,
        next.description || "",
        JSON.stringify(next),
      ]
    );
    return pgGetConfig(kind, next, client);
  });
}

export async function getCallTopics(): Promise<TopicSet> {
  return usePostgres()
    ? pgGetConfig("call_topics", topicDefaults)
    : firestore.getCallTopics();
}

export async function saveCallTopics(value: TopicSet): Promise<TopicSet> {
  return usePostgres()
    ? pgSaveConfig("call_topics", {
        ...value,
        version: value.version || "v1",
        name: value.name || "Call Topics",
        description: value.description || "",
      })
    : firestore.saveCallTopics(value);
}

function validateId(id: string, label: string): string {
  const normalized = id.trim().toLowerCase();
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    throw new Error(`${label} id must be lowercase letters, numbers, underscores`);
  }
  return normalized;
}

export async function upsertCallTopic(input: {
  id: string;
  label: string;
  description?: string;
  active?: boolean;
}): Promise<TopicSet> {
  if (!usePostgres()) return firestore.upsertCallTopic(input);
  const id = validateId(input.id, "Topic");
  const label = input.label.trim();
  if (!label) throw new Error("Label is required");
  return pgMutateConfig("call_topics", topicDefaults, (current) => {
    const row: CallTopic = {
      id,
      label,
      description: (input.description || "").trim(),
      active: input.active !== false,
    };
    const topics = [...current.topics];
    const index = topics.findIndex((topic) => topic.id === id);
    if (index >= 0) topics[index] = { ...topics[index], ...row };
    else topics.push(row);
    return { ...current, topics };
  });
}

export async function setCallTopicActive(id: string, active: boolean): Promise<TopicSet> {
  return usePostgres()
    ? pgMutateConfig("call_topics", topicDefaults, (current) => ({
        ...current,
        topics: current.topics.map((topic) =>
          topic.id === id ? { ...topic, active } : topic
        ),
      }))
    : firestore.setCallTopicActive(id, active);
}

export async function getCallFlags(): Promise<FlagSet> {
  return usePostgres()
    ? pgGetConfig("call_flags", flagDefaults)
    : firestore.getCallFlags();
}

export async function saveCallFlags(value: FlagSet): Promise<FlagSet> {
  return usePostgres()
    ? pgSaveConfig("call_flags", {
        ...value,
        version: value.version || "v1",
        name: value.name || "Critical Call Flags",
        description: value.description || "",
      })
    : firestore.saveCallFlags(value);
}

export async function upsertCallFlag(input: {
  id: string;
  label: string;
  description?: string;
  severity?: string;
  active?: boolean;
}): Promise<FlagSet> {
  if (!usePostgres()) return firestore.upsertCallFlag(input);
  const id = validateId(input.id, "Flag");
  const label = input.label.trim();
  if (!label) throw new Error("Label is required");
  return pgMutateConfig("call_flags", flagDefaults, (current) => {
    const row: CallFlag = {
      id,
      label,
      description: (input.description || "").trim(),
      severity: (input.severity || "critical").trim() || "critical",
      active: input.active !== false,
    };
    const flags = [...current.flags];
    const index = flags.findIndex((flag) => flag.id === id);
    if (index >= 0) flags[index] = { ...flags[index], ...row };
    else flags.push(row);
    return { ...current, flags };
  });
}

export async function setCallFlagActive(id: string, active: boolean): Promise<FlagSet> {
  return usePostgres()
    ? pgMutateConfig("call_flags", flagDefaults, (current) => ({
        ...current,
        flags: current.flags.map((flag) =>
          flag.id === id ? { ...flag, active } : flag
        ),
      }))
    : firestore.setCallFlagActive(id, active);
}

export async function getQaRules(): Promise<QaRuleset> {
  return usePostgres()
    ? pgGetConfig("qa_rules", ruleDefaults)
    : firestore.getQaRules();
}

export async function saveQaRules(value: QaRuleset): Promise<QaRuleset> {
  return usePostgres()
    ? pgSaveConfig("qa_rules", {
        ...ruleDefaults,
        ...value,
        version: value.version || "v1",
        name: value.name || "QA Rules",
        description: value.description || "",
      })
    : firestore.saveQaRules(value);
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
  if (!usePostgres()) return firestore.upsertQaRule(input);
  const id = validateId(input.id, "Rule");
  const label = input.label.trim();
  if (!label) throw new Error("Label is required");
  return pgMutateConfig("qa_rules", ruleDefaults, (current) => {
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
    const rules = [...current.rules];
    const index = rules.findIndex((rule) => rule.id === id);
    if (index >= 0) rules[index] = { ...rules[index], ...row };
    else rules.push(row);
    return { ...current, rules };
  });
}

export async function setQaRuleActive(id: string, active: boolean): Promise<QaRuleset> {
  return usePostgres()
    ? pgMutateConfig("qa_rules", ruleDefaults, (current) => ({
        ...current,
        rules: current.rules.map((rule) =>
          rule.id === id ? { ...rule, active } : rule
        ),
      }))
    : firestore.setQaRuleActive(id, active);
}

export async function updateQaRulesetMeta(input: {
  name?: string;
  description?: string;
  auto_fail_quality_cap?: number;
  empathy_pass_threshold?: number;
  transfer_soft_limit?: number;
  transfer_auto_fail_at?: number;
}): Promise<QaRuleset> {
  if (!usePostgres()) return firestore.updateQaRulesetMeta(input);
  return pgMutateConfig("qa_rules", ruleDefaults, (current) => ({
    ...current,
    name: input.name?.trim() || current.name,
    description:
      input.description === undefined
        ? current.description
        : input.description.trim(),
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
  }));
}

const CALL_SELECT = `
  SELECT c.*,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'rule_id', r.rule_id, 'label', r.label, 'category', r.category,
        'passed', r.passed, 'score_1_to_10', r.score_1_to_10,
        'evidence', r.evidence, 'evidence_timestamp', r.evidence_timestamp,
        'evidence_turn_index', r.evidence_turn_index, 'notes', r.notes,
        'auto_fail', r.auto_fail, 'weight', r.weight
      ) ORDER BY r.rule_id)
      FROM call_rule_results r WHERE r.call_id = c.id
    ), '[]'::jsonb) AS rule_results,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'flag_id', f.flag_id, 'label', f.label, 'severity', f.severity,
        'triggered', f.triggered, 'evidence', f.evidence,
        'evidence_timestamp', f.evidence_timestamp,
        'evidence_turn_index', f.evidence_turn_index, 'notes', f.notes
      ) ORDER BY f.flag_id)
      FROM call_flag_results f WHERE f.call_id = c.id
    ), '[]'::jsonb) AS critical_flags
  FROM calls c`;

export async function listCalls(opts?: {
  agentEmail?: string | null;
  limit?: number;
  status?: string;
  sinceMs?: number | null;
  requireMinDuration?: boolean;
}): Promise<CallDoc[]> {
  if (!usePostgres()) return firestore.listCalls(opts);
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (opts?.agentEmail) {
    values.push(opts.agentEmail.toLowerCase());
    conditions.push(`c.agent_email = $${values.length}`);
  }
  if (opts?.status) {
    values.push(opts.status);
    conditions.push(`c.status = $${values.length}`);
  }
  if (opts?.sinceMs) {
    values.push(new Date(opts.sinceMs));
    conditions.push(`c.call_date >= $${values.length}`);
  }
  if (opts?.requireMinDuration !== false) {
    values.push(30);
    conditions.push(`c.duration_seconds > $${values.length}`);
  }
  values.push(Math.max(1, Math.min(opts?.limit ?? 100, 1000)));
  const rows = await query(
    `${CALL_SELECT}
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY c.call_date DESC
     LIMIT $${values.length}`,
    values
  );
  return rows.map(serializeCallRow);
}

export async function getCall(id: string): Promise<CallDoc | null> {
  if (!usePostgres()) return firestore.getCall(id);
  const rows = await query(`${CALL_SELECT} WHERE c.id = $1 LIMIT 1`, [id]);
  return rows[0] ? serializeCallRow(rows[0]) : null;
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
  if (!usePostgres()) return firestore.listCallLogs(opts);
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (opts?.days && opts.days > 0) {
    values.push(new Date(Date.now() - opts.days * 86_400_000));
    conditions.push(`start_at >= $${values.length}`);
  }
  if (opts?.result) {
    values.push(opts.result.trim().toLowerCase());
    conditions.push(`lower(trim(coalesce(result, ''))) = $${values.length}`);
  }
  if (opts?.recorded != null) {
    values.push(opts.recorded);
    conditions.push(`recorded = $${values.length}`);
  }
  if (opts?.direction) {
    values.push(opts.direction.trim().toLowerCase());
    conditions.push(`lower(trim(coalesce(direction, ''))) = $${values.length}`);
  }
  if (opts?.missedOnly) {
    conditions.push(
      "(is_missed = true OR lower(trim(coalesce(result, ''))) NOT IN ('', 'answered', 'connected'))"
    );
  }
  if (opts?.unrecordedOnly) {
    conditions.push("(recorded = false OR is_unrecorded = true)");
  }
  values.push(Math.max(1, Math.min(opts?.limit ?? 200, 20000)));
  const rows = await query(
    `SELECT id, direction, from_number, to_number, result, recorded,
            length_seconds, start_at AS start, end_at AS "end",
            source_user, source_user_full_name, source_extension,
            destination_user, destination_user_full_name, destination_extension,
            custom_tag, in_network, international, is_missed, is_unrecorded,
            matched_call_id, ring_seconds, wait_seconds, queue_seconds,
            answered_at, synced_at
       FROM call_logs
      ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY start_at DESC NULLS LAST
      LIMIT $${values.length}`,
    values
  );
  return rows.map((row) => serializeRow<CallLogDoc>(row));
}

export async function getUser(email: string): Promise<UserDoc | null> {
  if (!usePostgres()) return firestore.getUser(email);
  const rows = await query("SELECT * FROM users WHERE email = $1 LIMIT 1", [
    email.trim().toLowerCase(),
  ]);
  return rows[0] ? serializeRow<UserDoc>(rows[0]) : null;
}

export async function upsertUser(input: {
  email: string;
  name: string;
  role: string;
  provisional?: boolean;
  modules?: string[];
}): Promise<UserDoc> {
  if (!usePostgres()) return firestore.upsertUser(input);
  const email = input.email.trim().toLowerCase();
  const modules = Array.isArray(input.modules) ? input.modules : null;
  const rows = await query(
    `INSERT INTO users (email, name, role, provisional, modules)
     VALUES ($1, $2, $3, $4, COALESCE($5::text[], '{}'::text[]))
     ON CONFLICT (email) DO UPDATE SET
       name = EXCLUDED.name,
       role = EXCLUDED.role,
       provisional = CASE
         WHEN $6::boolean IS NULL THEN users.provisional
         ELSE EXCLUDED.provisional
       END,
       modules = CASE
         WHEN $5::text[] IS NULL THEN users.modules
         ELSE EXCLUDED.modules
       END,
       updated_at = now()
     RETURNING *`,
    [
      email,
      input.name,
      input.role,
      input.provisional ?? false,
      modules,
      input.provisional ?? null,
    ]
  );
  // Keep call list / QA labels in sync when a display name is corrected.
  await query(
    "UPDATE calls SET agent_name = $2, updated_at = now() WHERE agent_email = $1 AND agent_name IS DISTINCT FROM $2",
    [email, input.name]
  );
  return serializeRow<UserDoc>(rows[0]);
}

export async function listUsers(): Promise<UserDoc[]> {
  if (!usePostgres()) return firestore.listUsers();
  const rows = await query(
    "SELECT * FROM users ORDER BY coalesce(nullif(name, ''), email::text), email LIMIT $1",
    [200]
  );
  return rows.map((row) => serializeRow<UserDoc>(row));
}

export async function setUserActive(email: string, active: boolean): Promise<UserDoc> {
  if (!usePostgres()) return firestore.setUserActive(email, active);
  const rows = await query(
    "UPDATE users SET active = $2, updated_at = now() WHERE email = $1 RETURNING *",
    [email.trim().toLowerCase(), active]
  );
  if (!rows[0]) throw new Error("User not found");
  return serializeRow<UserDoc>(rows[0]);
}

export async function setUserExtension(
  email: string,
  extension: string | null
): Promise<UserDoc> {
  if (!usePostgres()) {
    const existing = await firestore.getUser(email);
    if (!existing) throw new Error("User not found");
    const ext = (extension || "").trim();
    await firestore.getDb()
      .collection("users")
      .doc(email.trim().toLowerCase())
      .update({ extension: ext, updated_at: new Date() });
    return { ...existing, extension: ext };
  }
  const ext = (extension || "").trim();
  if (ext) {
    const clash = await query(
      "SELECT email FROM users WHERE extension = $1 AND email <> $2 LIMIT 1",
      [ext, email.trim().toLowerCase()]
    );
    if (clash[0]) {
      throw new Error(`Extension ${ext} is already mapped to ${clash[0].email}`);
    }
  }
  const rows = await query(
    `UPDATE users SET extension = $2, updated_at = now()
     WHERE email = $1 RETURNING *`,
    [email.trim().toLowerCase(), ext]
  );
  if (!rows[0]) throw new Error("User not found");
  if (ext) {
    await query(
      `INSERT INTO vonage_extensions (extension, mapped_email, source, updated_at)
       VALUES ($1, $2, 'manual', now())
       ON CONFLICT (extension) DO UPDATE SET
         mapped_email = EXCLUDED.mapped_email,
         updated_at = now()`,
      [ext, email.trim().toLowerCase()]
    );
  } else {
    await query(
      `UPDATE vonage_extensions SET mapped_email = NULL, updated_at = now()
       WHERE mapped_email = $1`,
      [email.trim().toLowerCase()]
    );
  }
  return serializeRow<UserDoc>(rows[0]);
}

export type VonageExtensionDoc = {
  extension: string;
  display_name?: string;
  vbc_username?: string;
  vbc_email?: string;
  mapped_email?: string | null;
  source?: string;
};

export async function listVonageExtensions(): Promise<VonageExtensionDoc[]> {
  if (!usePostgres()) return [];
  const rows = await query(
    `SELECT * FROM vonage_extensions
     ORDER BY CASE WHEN mapped_email IS NULL THEN 0 ELSE 1 END, extension`
  );
  return rows.map((row) => serializeRow<VonageExtensionDoc>(row));
}

function slugifyAgentName(name: string): string {
  return (
    name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "") ||
    "unknown"
  );
}

export function suggestedAgentEmail(name: string): string {
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();
  return `${slugifyAgentName(name)}@${domain}`;
}

export function provisionalAgentEmail(name: string): string {
  return suggestedAgentEmail(name);
}

function namesMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const leftParts = left.split(/\s+/);
  const rightParts = right.split(/\s+/);
  return (
    (leftParts.length === 1 && leftParts[0] === rightParts[0]) ||
    (rightParts.length === 1 && rightParts[0] === leftParts[0]) ||
    left.includes(right) ||
    right.includes(left)
  );
}

export async function linkProvisionalAgent(input: {
  provisionalEmail: string;
  realEmail: string;
  name?: string;
}): Promise<{ user: UserDoc; remappedCalls: number }> {
  if (!usePostgres()) return firestore.linkProvisionalAgent(input);
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();
  const from = input.provisionalEmail.trim().toLowerCase();
  const to = input.realEmail.trim().toLowerCase();
  if (!from.startsWith("unmapped.")) {
    throw new Error("Source must be a provisional unmapped.* agent");
  }
  if (!to.endsWith(`@${domain}`)) throw new Error(`Real email must be @${domain}`);
  return withTransaction(async (client) => {
    const provisionalResult = await client.query("SELECT * FROM users WHERE email = $1 FOR UPDATE", [
      from,
    ]);
    if (!provisionalResult.rows[0]) throw new Error("Provisional agent not found");
    const provisional = serializeRow<UserDoc>(provisionalResult.rows[0]);
    const name = (input.name || provisional.name || to.split("@")[0]).trim();
    const userResult = await client.query(
      `INSERT INTO users (email, name, role, provisional)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, role = EXCLUDED.role,
         provisional = false, updated_at = now()
       RETURNING *`,
      [to, name, provisional.role || "Agent"]
    );
    const calls = await client.query(
      "UPDATE calls SET agent_email = $2, agent_name = $3, updated_at = now() WHERE agent_email = $1",
      [from, to, name]
    );
    await client.query(
      `UPDATE users SET active = false, provisional = true,
        linked_to = $2, updated_at = now() WHERE email = $1`,
      [from, to]
    );
    return {
      user: serializeRow<UserDoc>(userResult.rows[0]),
      remappedCalls: calls.rowCount || 0,
    };
  });
}

export async function discoverUnmappedAgents(callLimit = 400): Promise<UnmappedAgentRow[]> {
  if (!usePostgres()) return firestore.discoverUnmappedAgents(callLimit);
  const [calls, users] = await Promise.all([
    listCalls({ status: "complete", limit: callLimit, requireMinDuration: false }),
    listUsers(),
  ]);
  const byEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]));
  const byName = new Map<string, UnmappedAgentRow>();
  for (const call of calls) {
    const name = (call.agent_name || "").trim();
    const email = (call.agent_email || "").trim().toLowerCase();
    if (!name || /^unknown$/i.test(name)) continue;
    const key = name.toLowerCase();
    const suggested = suggestedAgentEmail(name);
    const user = (email && byEmail.get(email)) || byEmail.get(suggested);
    const row = byName.get(key) || {
      agent_name: name,
      suggested_email: suggested,
      current_email: email || null,
      call_count: 0,
      mapped: !!(
        email &&
        byEmail.has(email) &&
        !byEmail.get(email)?.provisional &&
        !email.startsWith("unmapped.")
      ),
      provisional: !!(user?.provisional || (email || suggested).startsWith("unmapped.")),
      user_exists: !!user,
    };
    row.call_count += 1;
    byName.set(key, row);
  }
  for (const user of users) {
    const email = user.email.toLowerCase();
    if (!(user.provisional || email.startsWith("unmapped."))) continue;
    const name = (user.name || email.split("@")[0]).trim();
    const key = name.toLowerCase();
    const row = byName.get(key);
    if (row) {
      row.provisional = true;
      row.user_exists = true;
      row.current_email = email;
    } else {
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
  if (!usePostgres()) return firestore.importAndMapAgent(input);
  const name = input.agentName.trim();
  if (!name || /^unknown$/i.test(name)) throw new Error("Agent name is required");
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();
  const email = (input.email || suggestedAgentEmail(name)).trim().toLowerCase();
  if (!email.endsWith(`@${domain}`)) throw new Error(`Email must be @${domain}`);
  return withTransaction(async (client) => {
    const userResult = await client.query(
      `INSERT INTO users (email, name, role, provisional)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (email) DO UPDATE SET
         name = EXCLUDED.name, role = EXCLUDED.role,
         provisional = false, updated_at = now()
       RETURNING *`,
      [email, name, input.role || "Agent"]
    );
    const candidates = await client.query<{ id: string; agent_name: string; agent_email: string | null }>(
      "SELECT id, agent_name, agent_email::text FROM calls WHERE status = $1 FOR UPDATE",
      ["complete"]
    );
    let remappedCalls = 0;
    for (const call of candidates.rows) {
      const current = (call.agent_email || "").toLowerCase();
      if (!namesMatch(name, call.agent_name)) continue;
      if (current && current !== email && !current.startsWith("unmapped.")) continue;
      await client.query(
        "UPDATE calls SET agent_email = $2, agent_name = $3, updated_at = now() WHERE id = $1",
        [call.id, email, name]
      );
      if (current !== email) remappedCalls += 1;
    }
    return {
      user: serializeRow<UserDoc>(userResult.rows[0]),
      remappedCalls,
      email,
      name,
    };
  });
}

export async function assignCallAgent(input: {
  callId: string;
  agentEmail?: string | null;
  agentName?: string | null;
  createName?: string | null;
  createEmail?: string | null;
}): Promise<CallDoc> {
  if (!usePostgres()) return firestore.assignCallAgent(input);
  const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();
  return withTransaction(async (client) => {
    const call = await client.query("SELECT id FROM calls WHERE id = $1 FOR UPDATE", [
      input.callId,
    ]);
    if (!call.rows[0]) throw new Error("Call not found");
    let email = (input.agentEmail || "").trim().toLowerCase();
    let name = (input.agentName || "").trim();
    if (input.createName?.trim()) {
      name = input.createName.trim();
      email = (input.createEmail || suggestedAgentEmail(name)).trim().toLowerCase();
      if (!email.endsWith(`@${domain}`)) throw new Error(`Email must be @${domain}`);
      await client.query(
        `INSERT INTO users (email, name, role, provisional)
         VALUES ($1, $2, 'Agent', false)
         ON CONFLICT (email) DO UPDATE SET
           name = EXCLUDED.name, provisional = false, updated_at = now()`,
        [email, name]
      );
    } else if (email) {
      const user = await client.query<{ name: string }>(
        "SELECT name FROM users WHERE email = $1",
        [email]
      );
      if (user.rows[0]) name = user.rows[0].name || name || email;
      else if (!name) throw new Error("Unknown agent email");
    } else {
      throw new Error("Select an agent or create one");
    }
    await client.query(
      "UPDATE calls SET agent_email = $2, agent_name = $3, updated_at = now() WHERE id = $1",
      [input.callId, email, name]
    );
    const rows = await client.query(`${CALL_SELECT} WHERE c.id = $1 LIMIT 1`, [
      input.callId,
    ]);
    return serializeCallRow(rows.rows[0]);
  });
}

export async function saveManagerReview(input: {
  callId: string;
  managerFeedback: string;
  managerNotes: string;
  reviewerEmail: string;
  reviewerName: string;
}): Promise<void> {
  if (!usePostgres()) return firestore.saveManagerReview(input);
  await withTransaction(async (client) => {
    const result = await client.query<{
      agent_email: string | null;
      agent_name: string;
      call_date: Date;
      topic: string | null;
    }>(
      `UPDATE calls SET manager_feedback = $2, manager_notes = $3,
         reviewed_by = $4, reviewed_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING agent_email::text, agent_name, call_date, topic`,
      [
        input.callId,
        input.managerFeedback,
        input.managerNotes,
        input.reviewerEmail.toLowerCase(),
      ]
    );
    const call = result.rows[0];
    if (!call) throw new Error("Call not found");
    const text = input.managerFeedback.trim();
    if (text) {
      await client.query(
        `INSERT INTO feedback
          (id, call_id, agent_email, agent_name, author_email, author_name,
           text, call_date, topic)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          input.callId,
          call.agent_email,
          call.agent_name,
          input.reviewerEmail.toLowerCase(),
          input.reviewerName,
          text,
          call.call_date,
          call.topic,
        ]
      );
    }
  });
}

export async function setRollingFeedback(
  email: string,
  feedback: string
): Promise<UserDoc> {
  if (!usePostgres()) return firestore.setRollingFeedback(email, feedback);
  const rows = await query(
    `UPDATE users SET rolling_ai_feedback = $2, last_coaching_at = now(),
       updated_at = now() WHERE email = $1 RETURNING *`,
    [email.trim().toLowerCase(), feedback]
  );
  if (!rows[0]) throw new Error("User not found");
  return serializeRow<UserDoc>(rows[0]);
}

export async function listMetricsForAgent(
  agentEmail: string,
  limit = 8
): Promise<MetricDoc[]> {
  if (!usePostgres()) return firestore.listMetricsForAgent(agentEmail, limit);
  const rows = await query(
    `SELECT id, agent_email::text, agent_name, week_start, week_end, year, week,
            call_count, total_talk_time_seconds, avg_talk_time_seconds,
            avg_empathy_score, avg_quality_score, fcr_rate, avg_transfers,
            updated_at
       FROM weekly_metrics
      WHERE agent_email = $1
      ORDER BY week_start DESC
      LIMIT $2`,
    [agentEmail.trim().toLowerCase(), Math.max(1, Math.min(limit, 100))]
  );
  return rows.map((row) => serializeRow<MetricDoc>(row));
}

export async function listFeedbackForAgent(
  agentEmail: string,
  limit = 40
): Promise<Array<{ id: string; text?: string; created_at?: string }>> {
  if (!usePostgres()) return firestore.listFeedbackForAgent(agentEmail, limit);
  const rows = await query(
    `SELECT id, text, created_at FROM feedback
      WHERE agent_email = $1 ORDER BY created_at DESC LIMIT $2`,
    [agentEmail.trim().toLowerCase(), Math.max(1, Math.min(limit, 200))]
  );
  return rows.map((row) =>
    serializeRow<{ id: string; text?: string; created_at?: string }>(row)
  );
}

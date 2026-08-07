import type { CallDoc } from "./firestore";

type TimeLike =
  | string
  | Date
  | { toMillis: () => number }
  | { _seconds: number }
  | { seconds: number }
  | null
  | undefined;

export function formatCallDate(value: TimeLike): string {
  if (!value) return "—";
  const ms = toMillis(value);
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function formatDuration(seconds?: number | null): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h) return `${h}h ${mm}m ${rem}s`;
  return `${mm}m ${rem}s`;
}

export function toMillis(value: TimeLike): number {
  if (!value) return 0;
  if (typeof value === "string") return Date.parse(value) || 0;
  if (value instanceof Date) return value.getTime();
  if (typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  const anyVal = value as { _seconds?: number; seconds?: number };
  if (typeof anyVal._seconds === "number") return anyVal._seconds * 1000;
  if (typeof anyVal.seconds === "number") return anyVal.seconds * 1000;
  return 0;
}

export function failedRuleLabels(call: CallDoc): string[] {
  return (call.rule_results || [])
    .filter((r) => !r.passed)
    .map((r) => r.label || r.rule_id || "rule");
}

export function criticalFlagLabels(call: CallDoc): string[] {
  return (call.critical_flags || [])
    .filter((f) => f.triggered !== false)
    .map((f) => f.label || f.flag_id || "flag");
}

export function sentimentDisplay(call: CallDoc): {
  label: string;
  score: number | null;
} {
  const label = (call.sentiment_label || "").trim().toLowerCase();
  const score =
    typeof call.sentiment_score === "number" ? call.sentiment_score : null;
  if (!label && score == null) return { label: "", score: null };
  return {
    label: label || "neutral",
    score,
  };
}

/** Best available patient/caller display name for existing + new calls. */
export function resolvePatientName(call: {
  patient_name?: string | null;
  vonage_cnam?: string | null;
  ai_summary?: string;
  transcript?: Array<{ speaker?: string; text?: string }>;
}): string {
  const direct = (call.patient_name || "").trim();
  if (direct && !/^unknown$/i.test(direct)) return direct;

  const cnam = (call.vonage_cnam || "").trim();
  if (cnam && !/^\+?\d[\d\s().-]{6,}$/.test(cnam) && !/^unknown$/i.test(cnam)) {
    return cnam;
  }

  const summary = call.ai_summary || "";
  const fromSummary =
    summary.match(
      /\bPatient\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){0,3})\b/
    ) ||
    summary.match(
      /\b(?:caller|patient)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+){0,3})\b/i
    );
  if (fromSummary?.[1] && !/^unknown$/i.test(fromSummary[1])) {
    return fromSummary[1];
  }

  for (const turn of call.transcript || []) {
    if ((turn.speaker || "").toLowerCase() !== "patient") continue;
    const text = turn.text || "";
    const named =
      text.match(/\b(?:my name is|this is|I am|I'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+)?)/i) ||
      text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z'-]+)?)\s+(?:calling|returning)/);
    if (named?.[1]) return named[1];
  }

  return "Unknown patient";
}

export function resolveAgentLabel(call: {
  agent_name?: string;
  agent_email?: string | null;
}): { name: string; unmapped: boolean } {
  const email = (call.agent_email || "").trim().toLowerCase();
  const provisional = email.startsWith("unmapped.");
  const name = (call.agent_name || "").trim();
  if (name && !/^unknown$/i.test(name)) {
    return { name, unmapped: !email || provisional };
  }
  if (email && !provisional) {
    return { name: email, unmapped: false };
  }
  return { name: "Unassigned agent", unmapped: true };
}

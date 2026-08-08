/** Ops control tower rollups from CDR logs (client-safe). */

import type { CallLogDoc } from "@/lib/callLogs";
import { isMissedResult, normalizeResult } from "@/lib/callLogs";
import { toMillis } from "@/lib/format";

export const OPS_TIMEZONE = "America/Los_Angeles";

export type OutcomeBucket =
  | "answered"
  | "abandoned"
  | "voicemail"
  | "busy"
  | "no_answer"
  | "other";

export type TrendPoint = {
  key: string;
  label: string;
  total: number;
  answered: number;
  missed: number;
  answerRate: number;
  talkSeconds: number;
};

export type DirectionRow = {
  direction: string;
  total: number;
  answered: number;
  missed: number;
  answerRate: number;
  talkSeconds: number;
};

export type OutcomeRow = {
  bucket: OutcomeBucket;
  label: string;
  count: number;
  share: number;
};

export type OpsTower = {
  timezone: string;
  total: number;
  answered: number;
  missed: number;
  answerRate: number;
  missedRate: number;
  inboundTotal: number;
  inboundAnswered: number;
  inboundAnswerRate: number;
  abandonCount: number;
  abandonRate: number;
  withQa: number;
  qaCoverage: number;
  qaCoverageOfAnswered: number;
  unrecorded: number;
  unrecordedRate: number;
  byHour: TrendPoint[];
  byDow: TrendPoint[];
  byDay: TrendPoint[];
  byDirection: DirectionRow[];
  byOutcome: OutcomeRow[];
};

const DOW_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const OUTCOME_LABELS: Record<OutcomeBucket, string> = {
  answered: "Answered",
  abandoned: "Abandoned",
  voicemail: "Voicemail",
  busy: "Busy",
  no_answer: "No answer / missed",
  other: "Other non-answer",
};

function zonedParts(
  ms: number,
  timeZone: string
): { hour: number; dow: string; dayKey: string; dayLabel: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || "";

  const hour = Number(get("hour"));
  const dow = get("weekday");
  const month = get("month");
  const day = get("day");
  const year = get("year");
  const dayKey = `${year}-${month}-${day}`;
  const dayLabel = `${month}/${day}`;
  return {
    hour: Number.isFinite(hour) ? hour : 0,
    dow,
    dayKey,
    dayLabel,
  };
}

export function classifyOutcome(log: CallLogDoc): OutcomeBucket {
  const result = normalizeResult(log.result).toLowerCase();
  if (result === "answered" || result === "connected") return "answered";
  if (result.includes("abandon")) return "abandoned";
  if (result.includes("voicemail") || result.includes("voice mail")) {
    return "voicemail";
  }
  if (result.includes("busy")) return "busy";
  if (
    result.includes("miss") ||
    result.includes("no answer") ||
    result.includes("no-answer") ||
    result.includes("attempt") ||
    !!log.is_missed
  ) {
    return "no_answer";
  }
  if (isMissedResult(log.result)) return "other";
  return "answered";
}

function emptyTrend(key: string, label: string): TrendPoint {
  return {
    key,
    label,
    total: 0,
    answered: 0,
    missed: 0,
    answerRate: 0,
    talkSeconds: 0,
  };
}

function finalizeTrend(point: TrendPoint): TrendPoint {
  return {
    ...point,
    answerRate: point.total ? point.answered / point.total : 0,
  };
}

function bumpTrend(point: TrendPoint, log: CallLogDoc, answered: boolean) {
  point.total += 1;
  if (answered) point.answered += 1;
  else point.missed += 1;
  point.talkSeconds += Math.max(0, Number(log.length_seconds || 0));
}

export function buildOpsTower(
  logs: CallLogDoc[],
  opts?: { timeZone?: string }
): OpsTower {
  const timeZone = opts?.timeZone || OPS_TIMEZONE;

  const byHour = new Map<string, TrendPoint>();
  for (let h = 0; h < 24; h += 1) {
    const key = String(h).padStart(2, "0");
    byHour.set(key, emptyTrend(key, `${key}:00`));
  }

  const byDow = new Map<string, TrendPoint>();
  for (const d of DOW_ORDER) {
    byDow.set(d, emptyTrend(d, d));
  }

  const byDay = new Map<string, TrendPoint>();
  const byDirection = new Map<string, DirectionRow>();
  const outcomeCounts: Record<OutcomeBucket, number> = {
    answered: 0,
    abandoned: 0,
    voicemail: 0,
    busy: 0,
    no_answer: 0,
    other: 0,
  };

  let total = 0;
  let answered = 0;
  let missed = 0;
  let inboundTotal = 0;
  let inboundAnswered = 0;
  let abandonCount = 0;
  let withQa = 0;
  let unrecorded = 0;

  for (const log of logs) {
    total += 1;
    const outcome = classifyOutcome(log);
    outcomeCounts[outcome] += 1;
    const isAnswered = outcome === "answered";
    if (isAnswered) answered += 1;
    else missed += 1;
    if (outcome === "abandoned") abandonCount += 1;
    if (log.matched_call_id) withQa += 1;
    if (log.recorded === false || log.is_unrecorded) unrecorded += 1;

    const direction = (log.direction || "Unknown").trim() || "Unknown";
    const dirKey = direction;
    const dir =
      byDirection.get(dirKey) ||
      ({
        direction: dirKey,
        total: 0,
        answered: 0,
        missed: 0,
        answerRate: 0,
        talkSeconds: 0,
      } satisfies DirectionRow);
    dir.total += 1;
    if (isAnswered) dir.answered += 1;
    else dir.missed += 1;
    dir.talkSeconds += Math.max(0, Number(log.length_seconds || 0));
    byDirection.set(dirKey, dir);

    if (direction.toLowerCase() === "inbound") {
      inboundTotal += 1;
      if (isAnswered) inboundAnswered += 1;
    }

    const ms = toMillis(log.start);
    if (ms) {
      const z = zonedParts(ms, timeZone);
      const hourKey = String(z.hour).padStart(2, "0");
      const hourPoint = byHour.get(hourKey) || emptyTrend(hourKey, `${hourKey}:00`);
      bumpTrend(hourPoint, log, isAnswered);
      byHour.set(hourKey, hourPoint);

      const dowKey = DOW_ORDER.includes(z.dow) ? z.dow : z.dow.slice(0, 3);
      const mappedDow =
        DOW_ORDER.find((d) => d.toLowerCase() === dowKey.toLowerCase()) ||
        z.dow;
      const dowPoint = byDow.get(mappedDow) || emptyTrend(mappedDow, mappedDow);
      bumpTrend(dowPoint, log, isAnswered);
      byDow.set(mappedDow, dowPoint);

      const dayPoint =
        byDay.get(z.dayKey) || emptyTrend(z.dayKey, z.dayLabel);
      bumpTrend(dayPoint, log, isAnswered);
      byDay.set(z.dayKey, dayPoint);
    }
  }

  const byOutcome: OutcomeRow[] = (
    Object.keys(OUTCOME_LABELS) as OutcomeBucket[]
  )
    .map((bucket) => ({
      bucket,
      label: OUTCOME_LABELS[bucket],
      count: outcomeCounts[bucket],
      share: total ? outcomeCounts[bucket] / total : 0,
    }))
    .filter((r) => r.count > 0);

  return {
    timezone: timeZone,
    total,
    answered,
    missed,
    answerRate: total ? answered / total : 0,
    missedRate: total ? missed / total : 0,
    inboundTotal,
    inboundAnswered,
    inboundAnswerRate: inboundTotal ? inboundAnswered / inboundTotal : 0,
    abandonCount,
    abandonRate: total ? abandonCount / total : 0,
    withQa,
    qaCoverage: total ? withQa / total : 0,
    qaCoverageOfAnswered: answered ? withQa / answered : 0,
    unrecorded,
    unrecordedRate: total ? unrecorded / total : 0,
    byHour: [...byHour.values()].map(finalizeTrend),
    byDow: DOW_ORDER.map((d) => finalizeTrend(byDow.get(d) || emptyTrend(d, d))),
    byDay: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, p]) => finalizeTrend(p)),
    byDirection: [...byDirection.values()]
      .map((d) => ({
        ...d,
        answerRate: d.total ? d.answered / d.total : 0,
      }))
      .sort((a, b) => b.total - a.total),
    byOutcome,
  };
}

/** Ops control tower rollups from CDR logs (client-safe). */

import type { CallLogDoc } from "@/lib/callLogs";
import { isEffectiveMiss, isMissedResult, normalizeResult, partyFromLog } from "@/lib/callLogs";
import { toMillis } from "@/lib/format";

export const OPS_TIMEZONE = "America/Los_Angeles";

/** Match Python MIN_CALL_DURATION_SECONDS: QA skips 30s and under. */
export const QA_MIN_DURATION_SECONDS = 30;

/** Default service-level threshold (seconds) once telephony wait exists. */
export const DEFAULT_SERVICE_LEVEL_SECONDS = 20;

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

export type CaptureRow = {
  key: string;
  label: string;
  recordedAnswered: number;
  withQa: number;
  missing: number;
  captureRate: number;
};

export type QaCapture = {
  recordedAnswered: number;
  withQa: number;
  missing: number;
  captureRate: number;
  byDay: CaptureRow[];
  byExtension: CaptureRow[];
};

export type OutcomeRow = {
  bucket: OutcomeBucket;
  label: string;
  count: number;
  share: number;
};

export type SlaProxies = {
  /** True when any CDR has telephony ring/wait/queue (enables real ASA). */
  trueAsaAvailable: boolean;
  telephonyWaitSampleSize: number;
  /** Average telephony wait/ring when present; null if unavailable. */
  asaSeconds: number | null;
  /** % of inbound answered with wait <= threshold; null if no wait data. */
  serviceLevelRate: number | null;
  serviceLevelThresholdSeconds: number;
  /** AI-estimated speed-to-answer from matched QA calls only. */
  qaSpeedToAnswerSeconds: number | null;
  qaSpeedToAnswerSampleSize: number;
  qaSpeedToAnswerWithin20Rate: number | null;
  qaSpeedToAnswerWithin30Rate: number | null;
};

export type OpsTower = {
  timezone: string;
  total: number;
  answered: number;
  missed: number;
  answerRate: number;
  missedRate: number;
  /** Inbound offered (contact-center framing). */
  inboundOffered: number;
  inboundAnswered: number;
  inboundAbandoned: number;
  inboundNoAnswer: number;
  inboundVoicemail: number;
  /** Answered / offered inbound. */
  inboundAnswerRate: number;
  /** Abandoned / offered inbound. */
  inboundAbandonRate: number;
  /** Non-answered share of offered inbound (abandon + no-answer + busy + vm + other). */
  inboundMissedRate: number;
  /** @deprecated alias — use inboundOffered */
  inboundTotal: number;
  abandonCount: number;
  /** Overall abandon % (all directions); prefer inboundAbandonRate for CC SLAs. */
  abandonRate: number;
  /** Avg talk seconds for answered inbound (talk time, not full AHT). */
  inboundAvgTalkSeconds: number;
  withQa: number;
  qaCoverage: number;
  qaCoverageOfAnswered: number;
  unrecorded: number;
  unrecordedRate: number;
  capture: QaCapture;
  sla: SlaProxies;
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
  // Group-ring siblings keep Vonage "Missed" but are not patient misses.
  if (log.answered_elsewhere) return "answered";
  if (typeof log.is_missed === "boolean" && !log.is_missed && isMissedResult(log.result)) {
    return "answered";
  }
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
    isEffectiveMiss(log)
  ) {
    return "no_answer";
  }
  if (isMissedResult(log.result)) return "other";
  return "answered";
}

export function telephonyWaitSeconds(log: CallLogDoc): number | null {
  for (const value of [log.wait_seconds, log.queue_seconds, log.ring_seconds]) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  if (log.answered_at && log.start) {
    const startMs = toMillis(log.start);
    const answeredMs = toMillis(log.answered_at);
    if (startMs && answeredMs && answeredMs >= startMs) {
      return Math.round((answeredMs - startMs) / 1000);
    }
  }
  return null;
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

function emptyCapture(key: string, label: string): CaptureRow {
  return {
    key,
    label,
    recordedAnswered: 0,
    withQa: 0,
    missing: 0,
    captureRate: 0,
  };
}

function finalizeCapture(row: CaptureRow): CaptureRow {
  return {
    ...row,
    missing: Math.max(0, row.recordedAnswered - row.withQa),
    captureRate: row.recordedAnswered ? row.withQa / row.recordedAnswered : 0,
  };
}

function bumpCapture(row: CaptureRow, withQa: boolean) {
  row.recordedAnswered += 1;
  if (withQa) row.withQa += 1;
}

/** Answered CDR that Vonage marked recorded and is long enough for QA. */
export function isQaCaptureCandidate(log: CallLogDoc): boolean {
  if (classifyOutcome(log) !== "answered") return false;
  if (log.recorded !== true) return false;
  if (log.is_unrecorded) return false;
  const length = Number(log.length_seconds || 0);
  return Number.isFinite(length) && length > QA_MIN_DURATION_SECONDS;
}

export function isMissingQaCapture(log: CallLogDoc): boolean {
  return isQaCaptureCandidate(log) && !log.matched_call_id;
}

export type BuildOpsTowerOpts = {
  timeZone?: string;
  /** QA call_id → AI-estimated time_to_answer_seconds (matched CDRs only). */
  qaAnswerSecondsByCallId?: Record<string, number | null | undefined>;
  serviceLevelThresholdSeconds?: number;
};

export function buildOpsTower(
  logs: CallLogDoc[],
  opts?: BuildOpsTowerOpts
): OpsTower {
  const timeZone = opts?.timeZone || OPS_TIMEZONE;
  const qaMap = opts?.qaAnswerSecondsByCallId || {};
  const slThreshold =
    opts?.serviceLevelThresholdSeconds ?? DEFAULT_SERVICE_LEVEL_SECONDS;

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
  let inboundOffered = 0;
  let inboundAnswered = 0;
  let inboundAbandoned = 0;
  let inboundNoAnswer = 0;
  let inboundVoicemail = 0;
  let abandonCount = 0;
  let withQa = 0;
  let unrecorded = 0;
  let inboundTalkSum = 0;
  let inboundTalkN = 0;

  let telephonyWaitSum = 0;
  let telephonyWaitN = 0;
  let telephonySlOk = 0;
  let telephonySlN = 0;

  let qaSpeedSum = 0;
  let qaSpeedN = 0;
  let qaWithin20 = 0;
  let qaWithin30 = 0;

  let recordedAnswered = 0;
  let recordedAnsweredWithQa = 0;
  const captureByDay = new Map<string, CaptureRow>();
  const captureByExt = new Map<string, CaptureRow>();

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

    const isInbound = direction.toLowerCase() === "inbound";
    if (isInbound) {
      inboundOffered += 1;
      if (isAnswered) {
        inboundAnswered += 1;
        const len = Math.max(0, Number(log.length_seconds || 0));
        if (len > 0) {
          inboundTalkSum += len;
          inboundTalkN += 1;
        }
      }
      if (outcome === "abandoned") inboundAbandoned += 1;
      if (outcome === "no_answer") inboundNoAnswer += 1;
      if (outcome === "voicemail") inboundVoicemail += 1;

      const wait = telephonyWaitSeconds(log);
      if (wait !== null && isAnswered) {
        telephonyWaitSum += wait;
        telephonyWaitN += 1;
        telephonySlN += 1;
        if (wait <= slThreshold) telephonySlOk += 1;
      }
    }

    if (log.matched_call_id) {
      const qaSec = qaMap[log.matched_call_id];
      if (typeof qaSec === "number" && Number.isFinite(qaSec) && qaSec >= 0) {
        qaSpeedSum += qaSec;
        qaSpeedN += 1;
        if (qaSec <= 20) qaWithin20 += 1;
        if (qaSec <= 30) qaWithin30 += 1;
      }
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

    if (isQaCaptureCandidate(log)) {
      const captured = Boolean(log.matched_call_id);
      recordedAnswered += 1;
      if (captured) recordedAnsweredWithQa += 1;
      const msCap = toMillis(log.start);
      const zCap = msCap ? zonedParts(msCap, timeZone) : null;
      if (zCap) {
        const dayCap =
          captureByDay.get(zCap.dayKey) ||
          emptyCapture(zCap.dayKey, zCap.dayLabel);
        bumpCapture(dayCap, captured);
        captureByDay.set(zCap.dayKey, dayCap);
      }
      const ext = (partyFromLog(log).extension || "").trim() || "Unknown";
      const extCap = captureByExt.get(ext) || emptyCapture(ext, `Ext ${ext}`);
      bumpCapture(extCap, captured);
      captureByExt.set(ext, extCap);
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

  const trueAsaAvailable = telephonyWaitN > 0;

  return {
    timezone: timeZone,
    total,
    answered,
    missed,
    answerRate: total ? answered / total : 0,
    missedRate: total ? missed / total : 0,
    inboundOffered,
    inboundAnswered,
    inboundAbandoned,
    inboundNoAnswer,
    inboundVoicemail,
    inboundAnswerRate: inboundOffered ? inboundAnswered / inboundOffered : 0,
    inboundAbandonRate: inboundOffered
      ? inboundAbandoned / inboundOffered
      : 0,
    inboundMissedRate: inboundOffered
      ? (inboundOffered - inboundAnswered) / inboundOffered
      : 0,
    inboundTotal: inboundOffered,
    abandonCount,
    abandonRate: total ? abandonCount / total : 0,
    inboundAvgTalkSeconds: inboundTalkN ? inboundTalkSum / inboundTalkN : 0,
    withQa,
    qaCoverage: total ? withQa / total : 0,
    qaCoverageOfAnswered: answered ? withQa / answered : 0,
    unrecorded,
    unrecordedRate: total ? unrecorded / total : 0,
    capture: {
      recordedAnswered,
      withQa: recordedAnsweredWithQa,
      missing: Math.max(0, recordedAnswered - recordedAnsweredWithQa),
      captureRate: recordedAnswered
        ? recordedAnsweredWithQa / recordedAnswered
        : 0,
      byDay: [...captureByDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([, row]) => finalizeCapture(row)),
      byExtension: [...captureByExt.values()]
        .map(finalizeCapture)
        .sort(
          (a, b) =>
            b.missing - a.missing || b.recordedAnswered - a.recordedAnswered
        ),
    },
    sla: {
      trueAsaAvailable,
      telephonyWaitSampleSize: telephonyWaitN,
      asaSeconds: trueAsaAvailable ? telephonyWaitSum / telephonyWaitN : null,
      serviceLevelRate:
        trueAsaAvailable && telephonySlN
          ? telephonySlOk / telephonySlN
          : null,
      serviceLevelThresholdSeconds: slThreshold,
      qaSpeedToAnswerSeconds: qaSpeedN ? qaSpeedSum / qaSpeedN : null,
      qaSpeedToAnswerSampleSize: qaSpeedN,
      qaSpeedToAnswerWithin20Rate: qaSpeedN ? qaWithin20 / qaSpeedN : null,
      qaSpeedToAnswerWithin30Rate: qaSpeedN ? qaWithin30 / qaSpeedN : null,
    },
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

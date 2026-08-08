"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CallLogDoc } from "@/lib/callLogs";
import {
  isMissedResult,
  normalizeResult,
  partyFromLog,
  resultBreakdown,
  summarizeCallLogs,
  talkTimeByPerson,
} from "@/lib/callLogs";
import type { CoachingQueueEntry } from "@/lib/coachingQueue";
import type { AgentScorecardRow } from "@/lib/scorecard";
import { buildOpsTower, classifyOutcome, type OutcomeBucket } from "@/lib/opsTower";
import { formatCallDate, formatDuration } from "@/lib/format";
import { QUEUE_STORAGE_KEY, type StoredQueue } from "@/lib/qa";
import { AgentScorecard } from "@/components/AgentScorecard";
import { OpsControlTower } from "@/components/OpsControlTower";

type Props = {
  logs: CallLogDoc[];
  days: number;
  scorecardRows: AgentScorecardRow[];
  scorecardTeam: AgentScorecardRow;
  coachingQueue: {
    needsHelp: CoachingQueueEntry[];
    rockStars: CoachingQueueEntry[];
  };
};

function openReviewSample(ids: string[]) {
  if (!ids.length || typeof window === "undefined") return;
  const queue: StoredQueue = {
    createdAt: new Date().toISOString(),
    ids,
    cursor: 0,
  };
  sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  window.location.href = `/calls/${ids[0]}?queue=1`;
}

export function CallOps({
  logs,
  days,
  scorecardRows,
  scorecardTeam,
  coachingQueue,
}: Props) {
  const [q, setQ] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);
  const [unrecordedOnly, setUnrecordedOnly] = useState(false);
  const [direction, setDirection] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [personFilter, setPersonFilter] = useState("");
  const [scorecardKey, setScorecardKey] = useState("");
  const [outcomeBucket, setOutcomeBucket] = useState<OutcomeBucket | "">("");

  const selectedScorecard = useMemo(
    () => scorecardRows.find((r) => r.key === scorecardKey) || null,
    [scorecardRows, scorecardKey]
  );

  const OUTCOME_LABEL_TO_BUCKET: Record<string, OutcomeBucket> = {
    Answered: "answered",
    Abandoned: "abandoned",
    Voicemail: "voicemail",
    Busy: "busy",
    "No answer / missed": "no_answer",
    "Other non-answer": "other",
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const resultNeedle = resultFilter.trim().toLowerCase();
    const personNeedle = personFilter.trim().toLowerCase();
    const scorecardPartyKeys = selectedScorecard
      ? new Set(selectedScorecard.partyKeys)
      : null;

    return logs.filter((log) => {
      const isMissed = !!log.is_missed || isMissedResult(log.result);
      if (missedOnly && !isMissed) return false;
      if (unrecordedOnly && !(log.recorded === false || log.is_unrecorded)) {
        return false;
      }
      if (direction) {
        if ((log.direction || "").toLowerCase() !== direction.toLowerCase()) {
          return false;
        }
      }
      if (resultNeedle) {
        if (normalizeResult(log.result).toLowerCase() !== resultNeedle) return false;
      }
      if (outcomeBucket) {
        if (classifyOutcome(log) !== outcomeBucket) return false;
      }
      if (scorecardPartyKeys) {
        if (!scorecardPartyKeys.has(partyFromLog(log).key)) return false;
      } else if (personNeedle) {
        if (partyFromLog(log).key !== personNeedle) return false;
      }
      if (!needle) return true;
      const hay = [
        log.from_number,
        log.to_number,
        log.result,
        log.direction,
        log.source_user_full_name,
        log.destination_user_full_name,
        log.source_user,
        log.destination_user,
        log.source_extension,
        log.destination_extension,
        log.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [
    logs,
    q,
    missedOnly,
    unrecordedOnly,
    direction,
    resultFilter,
    personFilter,
    selectedScorecard,
    outcomeBucket,
  ]);

  const dashboardLogs = useMemo(() => {
    if (!direction) return logs;
    return logs.filter(
      (log) => (log.direction || "").toLowerCase() === direction.toLowerCase()
    );
  }, [logs, direction]);

  const stats = useMemo(() => summarizeCallLogs(dashboardLogs), [dashboardLogs]);
  const tower = useMemo(() => buildOpsTower(logs), [logs]);
  const byPerson = useMemo(() => talkTimeByPerson(dashboardLogs), [dashboardLogs]);
  const byResult = useMemo(() => resultBreakdown(dashboardLogs), [dashboardLogs]);
  const missedAbandoned = useMemo(
    () =>
      byResult.filter((row) => {
        const r = row.result.toLowerCase();
        return (
          r.includes("miss") ||
          r.includes("abandon") ||
          r.includes("voicemail") ||
          r.includes("no answer") ||
          r.includes("busy") ||
          r.includes("attempt")
        );
      }),
    [byResult]
  );
  const missedByPerson = useMemo(
    () =>
      [...byPerson]
        .filter((p) => p.missed + p.abandoned + p.voicemail > 0)
        .sort(
          (a, b) =>
            b.missed +
            b.abandoned +
            b.voicemail -
            (a.missed + a.abandoned + a.voicemail)
        )
        .slice(0, 15),
    [byPerson]
  );

  function clearDashboardFilters() {
    setResultFilter("");
    setPersonFilter("");
    setScorecardKey("");
    setOutcomeBucket("");
    setDirection("");
    setMissedOnly(false);
  }

  function selectScorecard(key: string) {
    setScorecardKey(key);
    setPersonFilter("");
  }

  function selectDirection(value: string) {
    setDirection((cur) => (cur.toLowerCase() === value.toLowerCase() ? "" : value));
  }

  function selectOutcomeLabel(label: string) {
    if (!label) {
      setOutcomeBucket("");
      return;
    }
    const bucket = OUTCOME_LABEL_TO_BUCKET[label];
    if (!bucket) return;
    setOutcomeBucket((cur) => (cur === bucket ? "" : bucket));
    setResultFilter("");
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            Operations
          </p>
          <h1 className="font-display text-3xl text-ink">Call ops</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Control tower, agent scorecard, coaching queue, and CDR detail for the
            last {days} days ({logs.length} CDRs loaded). Talk duration comes from
            Vonage Reports (not ring/ASA wait).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {[1, 3, 7, 14, 30].map((d) => (
            <Link
              key={d}
              href={`/ops?days=${d}`}
              className={`rounded-lg border px-3 py-1.5 font-semibold ${
                days === d
                  ? "border-accent bg-wash text-accent"
                  : "border-line text-ink-soft hover:bg-wash"
              }`}
            >
              {d}d
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Stat label="CDRs" value={String(stats.total)} />
        <Stat
          label="Total talk"
          value={formatDuration(Math.round(stats.totalTalkSeconds))}
        />
        <Stat label="Missed*" value={String(stats.missed)} tone="warn" />
        <Stat label="Unrecorded" value={String(stats.unrecorded)} tone="fail" />
        <Stat
          label="Answered rate"
          value={`${Math.round(stats.answeredRate * 100)}%`}
          tone="pass"
        />
        <Stat
          label="Avg talk"
          value={formatDuration(Math.round(stats.avgTalkSeconds))}
        />
      </div>
      <p className="mb-6 text-xs text-ink-soft">
        *Missed includes non-answered results (missed, abandoned, voicemail, busy,
        etc.). Use the control tower outcome taxonomy for a cleaner split.
      </p>

      <OpsControlTower
        tower={tower}
        days={days}
        selectedDirection={direction}
        selectedOutcome={
          outcomeBucket
            ? Object.entries(OUTCOME_LABEL_TO_BUCKET).find(
                ([, v]) => v === outcomeBucket
              )?.[0]
            : ""
        }
        onSelectDirection={selectDirection}
        onSelectOutcome={selectOutcomeLabel}
      />

      <AgentScorecard
        rows={scorecardRows}
        team={scorecardTeam}
        selectedKey={scorecardKey}
        onSelect={selectScorecard}
        days={days}
      />

      <CoachingQueuePanel
        needsHelp={coachingQueue.needsHelp}
        rockStars={coachingQueue.rockStars}
        scorecardKey={scorecardKey}
        onSelectScorecard={selectScorecard}
      />

      <section className="mb-8 rounded-xl border border-line bg-white/80">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-display text-xl text-ink">Missed / abandoned</h2>
          <p className="text-xs text-ink-soft">
            By result type, then people with the most non-answered calls.
          </p>
        </div>
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              By result
            </h3>
            <ul className="space-y-1.5">
              {missedAbandoned.length === 0 ? (
                <li className="text-sm text-ink-soft">None in this window.</li>
              ) : (
                missedAbandoned.map((row) => (
                  <li key={row.result}>
                    <button
                      type="button"
                      onClick={() =>
                        setResultFilter((cur) =>
                          cur === row.result ? "" : row.result
                        )
                      }
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                        resultFilter === row.result
                          ? "border-accent bg-wash"
                          : "border-line hover:bg-wash/60"
                      }`}
                    >
                      <span className="font-semibold text-ink">{row.result}</span>
                      <span className="text-ink-soft">{row.count}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              By person
            </h3>
            <ul className="space-y-1.5">
              {missedByPerson.length === 0 ? (
                <li className="text-sm text-ink-soft">None in this window.</li>
              ) : (
                missedByPerson.map((row) => (
                  <li key={`m-${row.key}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setScorecardKey("");
                        setPersonFilter((cur) =>
                          cur === row.key ? "" : row.key
                        );
                      }}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm ${
                        personFilter === row.key
                          ? "border-accent bg-wash"
                          : "border-line hover:bg-wash/60"
                      }`}
                    >
                      <span>
                        <span className="font-semibold text-ink">{row.name}</span>
                        <span className="mt-0.5 block text-[11px] text-ink-soft">
                          miss {row.missed} · abandon {row.abandoned} · vm{" "}
                          {row.voicemail}
                        </span>
                      </span>
                      <span className="font-semibold text-[color:var(--warn)]">
                        {row.missed + row.abandoned + row.voicemail}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      </section>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number, user, extension, result…"
          className="min-w-[220px] flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm"
        />
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <input
            type="checkbox"
            checked={missedOnly}
            onChange={(e) => setMissedOnly(e.target.checked)}
          />
          Missed
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <input
            type="checkbox"
            checked={unrecordedOnly}
            onChange={(e) => setUnrecordedOnly(e.target.checked)}
          />
          Unrecorded
        </label>
        <select
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
          className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
        >
          <option value="">All directions</option>
          <option value="Inbound">Inbound</option>
          <option value="Outbound">Outbound</option>
          <option value="Extension">Extension</option>
        </select>
        {resultFilter ||
        personFilter ||
        scorecardKey ||
        missedOnly ||
        outcomeBucket ||
        direction ? (
          <button
            type="button"
            onClick={clearDashboardFilters}
            className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-accent hover:bg-wash"
          >
            Clear filters
            {resultFilter ? ` · ${resultFilter}` : ""}
            {outcomeBucket ? ` · ${outcomeBucket}` : ""}
            {personFilter || scorecardKey ? " · person" : ""}
            {direction ? ` · ${direction}` : ""}
          </button>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-white/80">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/60 text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-3 py-2 font-semibold">Start</th>
              <th className="px-3 py-2 font-semibold">Dir</th>
              <th className="px-3 py-2 font-semibold">From → To</th>
              <th className="px-3 py-2 font-semibold">User / Ext</th>
              <th className="px-3 py-2 font-semibold">Result</th>
              <th className="px-3 py-2 font-semibold">Talk</th>
              <th className="px-3 py-2 font-semibold">Flags</th>
              <th className="px-3 py-2 font-semibold">QA</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-ink-soft">
                  No call logs match these filters.
                </td>
              </tr>
            ) : (
              filtered.map((log) => {
                const isMissed = !!log.is_missed || isMissedResult(log.result);
                const isUnrecorded =
                  log.recorded === false || !!log.is_unrecorded;
                const party = partyFromLog(log);
                return (
                  <tr key={log.id} className="border-b border-line/70 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                      {formatCallDate(log.start)}
                    </td>
                    <td className="px-3 py-2">{log.direction || "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {log.from_number || "?"} → {log.to_number || "?"}
                    </td>
                    <td className="px-3 py-2">
                      {party.name !== "Unknown" ||
                      party.user ||
                      party.extension ? (
                        <div className="leading-snug">
                          <div className="font-semibold text-ink">{party.name}</div>
                          {party.user ? (
                            <div className="text-xs text-ink-soft">{party.user}</div>
                          ) : null}
                          {party.extension ? (
                            <div className="text-xs text-ink-soft">
                              ext {party.extension}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">{log.result || "—"}</td>
                    <td className="px-3 py-2">
                      {formatDuration(log.length_seconds)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {isMissed ? <Badge tone="warn">Missed</Badge> : null}
                        {isUnrecorded ? (
                          <Badge tone="fail">Unrecorded</Badge>
                        ) : null}
                        {log.matched_call_id ? (
                          <Badge tone="pass">Has QA</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      {log.matched_call_id ? (
                        <Link
                          href={`/calls/${log.matched_call_id}`}
                          className="font-semibold text-accent hover:underline"
                        >
                          Review
                        </Link>
                      ) : (
                        <span className="text-ink-soft">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "fail" | "pass";
}) {
  const color =
    tone === "warn"
      ? "text-[color:var(--warn)]"
      : tone === "fail"
        ? "text-[color:var(--fail)]"
        : tone === "pass"
          ? "text-[color:var(--pass)]"
          : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-white/80 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl ${color}`}>{value}</div>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "warn" | "fail" | "pass";
}) {
  const cls =
    tone === "warn"
      ? "bg-amber-50 text-[color:var(--warn)]"
      : tone === "fail"
        ? "bg-red-50 text-[color:var(--fail)]"
        : "bg-emerald-50 text-[color:var(--pass)]";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {children}
    </span>
  );
}

function CoachingQueuePanel({
  needsHelp,
  rockStars,
  scorecardKey,
  onSelectScorecard,
}: {
  needsHelp: CoachingQueueEntry[];
  rockStars: CoachingQueueEntry[];
  scorecardKey: string;
  onSelectScorecard: (key: string) => void;
}) {
  return (
    <section className="mb-8 rounded-xl border border-line bg-white/80">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-display text-xl text-ink">Coaching queue</h2>
          <p className="text-xs text-ink-soft">
            Scorecard tiers plus miss rate, quality/empathy, flags, and top failed
            QA rules. Open coaching or a 3-call review sample.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-fail">
            {needsHelp.length} need help
          </span>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-pass">
            {rockStars.length} rock star{rockStars.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-2">
        <div className="border-b border-line p-4 lg:border-b-0 lg:border-r">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fail">
            Needs help
          </h3>
          {needsHelp.length === 0 ? (
            <p className="text-sm text-ink-soft">
              No coaching flags this window.
            </p>
          ) : (
            <ul className="space-y-2">
              {needsHelp.map((entry) => (
                <CoachingQueueCard
                  key={`help-${entry.key}`}
                  entry={entry}
                  selected={scorecardKey === entry.key}
                  onSelect={() =>
                    onSelectScorecard(
                      scorecardKey === entry.key ? "" : entry.key
                    )
                  }
                  tone="coach"
                />
              ))}
            </ul>
          )}
        </div>

        <div className="p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-pass">
            Rock stars
          </h3>
          {rockStars.length === 0 ? (
            <p className="text-sm text-ink-soft">
              None yet — thresholds need a few CDRs + QA scores.
            </p>
          ) : (
            <ul className="space-y-2">
              {rockStars.map((entry) => (
                <CoachingQueueCard
                  key={`star-${entry.key}`}
                  entry={entry}
                  selected={scorecardKey === entry.key}
                  onSelect={() =>
                    onSelectScorecard(
                      scorecardKey === entry.key ? "" : entry.key
                    )
                  }
                  tone="rock_star"
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function CoachingQueueCard({
  entry,
  selected,
  onSelect,
  tone,
}: {
  entry: CoachingQueueEntry;
  selected: boolean;
  onSelect: () => void;
  tone: "coach" | "rock_star";
}) {
  return (
    <li
      className={`rounded-lg border px-3 py-2.5 ${
        selected
          ? "border-accent bg-wash"
          : "border-line hover:bg-wash/50"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-start justify-between gap-3 text-left"
      >
        <span>
          <span className="font-semibold text-ink">{entry.name}</span>
          <span className="mt-0.5 block text-[11px] text-ink-soft">
            ans {Math.round(entry.answerRate * 100)}% · miss{" "}
            {Math.round(entry.missRate * 100)}% · Q{" "}
            {entry.avgQuality?.toFixed(1) ?? "—"} · flags {entry.criticalFlags}
          </span>
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            tone === "rock_star"
              ? "bg-emerald-100 text-pass"
              : "bg-red-100 text-fail"
          }`}
        >
          {tone === "rock_star" ? "Rock star" : "Coach"}
        </span>
      </button>

      {entry.reasons.length ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {entry.reasons.map((reason) => (
            <li
              key={`${entry.key}-${reason}`}
              className="rounded bg-wash px-1.5 py-0.5 text-[11px] font-medium text-ink-soft"
            >
              {reason}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2.5 flex flex-wrap gap-3 text-xs font-semibold">
        {entry.email ? (
          <Link
            href={`/coaching?agent=${encodeURIComponent(entry.email)}`}
            className="text-accent hover:underline"
          >
            Open coaching
          </Link>
        ) : (
          <span className="text-ink-soft">Map agent to coach</span>
        )}
        {entry.sampleCallIds.length ? (
          <button
            type="button"
            onClick={() => openReviewSample(entry.sampleCallIds)}
            className="text-accent hover:underline"
          >
            Review {entry.sampleCallIds.length} calls
          </button>
        ) : (
          <span className="font-medium text-ink-soft">No QA sample</span>
        )}
        <button
          type="button"
          onClick={onSelect}
          className="text-ink-soft hover:text-accent hover:underline"
        >
          {selected ? "Clear filter" : "Filter CDRs"}
        </button>
      </div>
    </li>
  );
}

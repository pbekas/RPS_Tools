"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { CallLogDoc } from "@/lib/callLogs";
import {
  isMissedResult,
  normalizeResult,
  partyFromLog,
  summarizeCallLogs,
} from "@/lib/callLogs";
import { formatCallDate, formatDuration } from "@/lib/format";
import { LiveCallsBoard } from "@/components/LiveCallsBoard";
import { UploadRecordings } from "@/components/UploadRecordings";

type Props = {
  logs: CallLogDoc[];
  days: number;
  /** Prefill person filter from Reporting deep-link (`?person=`). */
  initialPerson?: string;
  /** Prefill missed-only from Reporting (`?missed=1`). */
  initialMissed?: boolean;
};

export function CallOps({
  logs,
  days,
  initialPerson = "",
  initialMissed = false,
}: Props) {
  const [q, setQ] = useState("");
  const [missedOnly, setMissedOnly] = useState(initialMissed);
  const [unrecordedOnly, setUnrecordedOnly] = useState(false);
  const [direction, setDirection] = useState("");
  const [resultFilter, setResultFilter] = useState("");
  const [personFilter, setPersonFilter] = useState(initialPerson);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const resultNeedle = resultFilter.trim().toLowerCase();
    const personNeedle = personFilter.trim().toLowerCase();

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
      if (personNeedle) {
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
  }, [logs, q, missedOnly, unrecordedOnly, direction, resultFilter, personFilter]);

  const stats = useMemo(() => summarizeCallLogs(logs), [logs]);

  function clearFilters() {
    setResultFilter("");
    setPersonFilter("");
    setDirection("");
    setMissedOnly(false);
    setUnrecordedOnly(false);
    setQ("");
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <UploadRecordings />

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            Operations
          </p>
          <h1 className="font-display text-3xl text-ink">Call ops</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Live board, uploads, and CDR triage for the last {days} days (
            {logs.length} CDRs). Analytics live on{" "}
            <Link href={`/reporting?days=${days}`} className="font-semibold text-accent hover:underline">
              Reporting
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {[1, 3, 7, 14, 30].map((d) => (
            <Link
              key={d}
              href={`/ops?days=${d}${personFilter ? `&person=${encodeURIComponent(personFilter)}` : ""}`}
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

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="CDRs" value={String(stats.total)} />
        <Stat label="Missed*" value={String(stats.missed)} tone="warn" />
        <Stat label="Unrecorded" value={String(stats.unrecorded)} tone="fail" />
        <Stat
          label="Answered rate"
          value={`${Math.round(stats.answeredRate * 100)}%`}
          tone="pass"
        />
      </div>
      <p className="mb-6 text-xs text-ink-soft">
        *Missed includes non-answered results. See Reporting for the outcome
        taxonomy and agent scorecards.
      </p>

      <LiveCallsBoard />

      <section className="mb-4">
        <h2 className="mb-3 font-display text-xl text-ink">CDR explorer</h2>
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
          {resultFilter || personFilter || missedOnly || unrecordedOnly || direction || q ? (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-accent hover:bg-wash"
            >
              Clear filters
              {personFilter ? ` · ${personFilter}` : ""}
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
                    <tr
                      key={log.id}
                      className="border-b border-line/70 last:border-0"
                    >
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
                            <div className="font-semibold text-ink">
                              {party.name}
                            </div>
                            {party.user ? (
                              <div className="text-xs text-ink-soft">
                                {party.user}
                              </div>
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
      </section>
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

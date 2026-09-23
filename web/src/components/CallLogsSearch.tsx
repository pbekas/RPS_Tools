"use client";

import Link from "next/link";
import { useCallback, useState, type FormEvent } from "react";
import type { CallLogDoc } from "@/lib/callLogs";
import { displayCallResult, isEffectiveMiss, partyFromLog } from "@/lib/callLogs";
import type { CallDoc } from "@/lib/firestore";
import { formatCallDate, formatDuration, formatPhone } from "@/lib/format";

type Tab = "cdrs" | "recordings";

type Props = {
  initialLogs: CallLogDoc[];
  initialCalls: CallDoc[];
};

function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateStart(value: string): number | null {
  if (!value) return null;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function parseDateEnd(value: string): number | null {
  if (!value) return null;
  const ms = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function CallLogsSearch({ initialLogs, initialCalls }: Props) {
  const defaultFrom = toDateInputValue(Date.now() - 30 * 86_400_000);
  const defaultTo = toDateInputValue(Date.now());

  const [tab, setTab] = useState<Tab>("cdrs");
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState(defaultFrom);
  const [toDate, setToDate] = useState(defaultTo);
  const [direction, setDirection] = useState("");
  const [missedOnly, setMissedOnly] = useState(false);
  const [unrecordedOnly, setUnrecordedOnly] = useState(false);
  const [missingQaOnly, setMissingQaOnly] = useState(false);
  const [hasRecording, setHasRecording] = useState(true);

  const [logs, setLogs] = useState(initialLogs);
  const [calls, setCalls] = useState(initialCalls);
  const [logsHasMore, setLogsHasMore] = useState(initialLogs.length >= 100);
  const [callsHasMore, setCallsHasMore] = useState(initialCalls.length >= 100);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchLogs = useCallback(
    async (offset: number, append: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: "100",
          offset: String(offset),
        });
        const fromMs = parseDateStart(fromDate);
        const toMs = parseDateEnd(toDate);
        if (fromMs) params.set("fromMs", String(fromMs));
        if (toMs) params.set("toMs", String(toMs));
        if (q.trim()) params.set("q", q.trim());
        if (direction) params.set("direction", direction);
        if (missedOnly) params.set("missed", "1");
        if (unrecordedOnly) params.set("unrecorded", "1");
        if (missingQaOnly) params.set("missingQa", "1");
        const res = await fetch(`/api/call-logs?${params}`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          logs: CallLogDoc[];
          hasMore: boolean;
        };
        setLogs((prev) => (append ? [...prev, ...data.logs] : data.logs));
        setLogsHasMore(Boolean(data.hasMore));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setBusy(false);
      }
    },
    [fromDate, toDate, q, direction, missedOnly, unrecordedOnly, missingQaOnly]
  );

  const searchRecordings = useCallback(
    async (offset: number, append: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          limit: "100",
          offset: String(offset),
          status: "complete",
        });
        const fromMs = parseDateStart(fromDate);
        const toMs = parseDateEnd(toDate);
        if (fromMs) params.set("fromMs", String(fromMs));
        if (toMs) params.set("toMs", String(toMs));
        if (q.trim()) params.set("q", q.trim());
        if (hasRecording) params.set("hasRecording", "1");
        const res = await fetch(`/api/calls/search?${params}`);
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as {
          calls: CallDoc[];
          hasMore: boolean;
        };
        setCalls((prev) => (append ? [...prev, ...data.calls] : data.calls));
        setCallsHasMore(Boolean(data.hasMore));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed");
      } finally {
        setBusy(false);
      }
    },
    [fromDate, toDate, q, hasRecording]
  );

  function runSearch(e?: FormEvent) {
    e?.preventDefault();
    if (tab === "cdrs") void searchLogs(0, false);
    else void searchRecordings(0, false);
  }

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <TabButton active={tab === "cdrs"} onClick={() => setTab("cdrs")}>
          CDRs
        </TabButton>
        <TabButton
          active={tab === "recordings"}
          onClick={() => setTab("recordings")}
        >
          Recordings
        </TabButton>
      </div>

      <form
        onSubmit={runSearch}
        className="mb-4 space-y-3 rounded-xl border border-line bg-white/80 p-4"
      >
        <div className="flex flex-wrap gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={
              tab === "cdrs"
                ? "Phone, extension, name, CDR id…"
                : "Phone, extension, agent, Vonage recording id…"
            }
            className="min-w-[240px] flex-1 rounded-lg border border-line bg-white px-3 py-2 text-sm"
          />
          <label className="text-sm text-ink-soft">
            From
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="ml-2 rounded-lg border border-line bg-white px-2 py-2 text-sm text-ink"
            />
          </label>
          <label className="text-sm text-ink-soft">
            To
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="ml-2 rounded-lg border border-line bg-white px-2 py-2 text-sm text-ink"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </div>

        {tab === "cdrs" ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              className="rounded-lg border border-line bg-white px-3 py-1.5"
            >
              <option value="">Any direction</option>
              <option value="INBOUND">Inbound</option>
              <option value="OUTBOUND">Outbound</option>
              <option value="INTRA_PBX">Intra PBX</option>
            </select>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={missedOnly}
                onChange={(e) => setMissedOnly(e.target.checked)}
              />
              Missed
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={unrecordedOnly}
                onChange={(e) => setUnrecordedOnly(e.target.checked)}
              />
              Unrecorded
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={missingQaOnly}
                onChange={(e) => setMissingQaOnly(e.target.checked)}
              />
              Missing QA capture
            </label>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={hasRecording}
                onChange={(e) => setHasRecording(e.target.checked)}
              />
              Has audio in storage
            </label>
          </div>
        )}
      </form>

      {error ? (
        <p className="mb-3 rounded-lg border border-fail/30 bg-red-50 px-3 py-2 text-sm text-fail">
          {error}
        </p>
      ) : null}

      {tab === "cdrs" ? (
        <>
          <CdrTable logs={logs} />
          {logsHasMore ? (
            <div className="mt-3 text-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => void searchLogs(logs.length, true)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-accent hover:bg-wash disabled:opacity-60"
              >
                Load more
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <RecordingsTable calls={calls} />
          {callsHasMore ? (
            <div className="mt-3 text-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => void searchRecordings(calls.length, true)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-accent hover:bg-wash disabled:opacity-60"
              >
                Load more
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
        active
          ? "border-accent bg-wash text-accent"
          : "border-line text-ink-soft hover:bg-wash"
      }`}
    >
      {children}
    </button>
  );
}

function CdrTable({ logs }: { logs: CallLogDoc[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white/80">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-line bg-wash/60 text-xs uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="px-3 py-2.5 font-semibold">When</th>
            <th className="px-3 py-2.5 font-semibold">Direction</th>
            <th className="px-3 py-2.5 font-semibold">From / To</th>
            <th className="px-3 py-2.5 font-semibold">Party</th>
            <th className="px-3 py-2.5 font-semibold">Result</th>
            <th className="px-3 py-2.5 font-semibold">Talk</th>
            <th className="px-3 py-2.5 font-semibold text-right">QA</th>
          </tr>
        </thead>
        <tbody>
          {logs.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-ink-soft">
                No CDRs match. Try a wider date range or different filters.
              </td>
            </tr>
          ) : (
            logs.map((log) => {
              const party = partyFromLog(log);
              const missed = isEffectiveMiss(log);
              return (
                <tr key={log.id} className="border-b border-line/70 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                    {formatCallDate(log.start)}
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft">
                    {log.direction || "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">
                      {formatPhone(log.from_number) || log.from_number || "—"}
                    </div>
                    <div className="text-xs text-ink-soft">
                      → {formatPhone(log.to_number) || log.to_number || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{party.name}</div>
                    <div className="text-xs text-ink-soft">
                      {party.extension ? `Ext ${party.extension}` : "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={
                        missed
                          ? "font-semibold text-warn"
                          : log.recorded === false
                            ? "font-semibold text-fail"
                            : "text-ink"
                      }
                    >
                      {displayCallResult(log)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-ink-soft">
                    {formatDuration(log.length_seconds)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {log.matched_call_id ? (
                      <Link
                        href={`/calls/${log.matched_call_id}`}
                        className="text-xs font-semibold text-accent hover:underline"
                      >
                        Review
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-soft">—</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function RecordingsTable({ calls }: { calls: CallDoc[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-white/80">
      <table className="min-w-full text-left text-sm">
        <thead className="border-b border-line bg-wash/60 text-xs uppercase tracking-wide text-ink-soft">
          <tr>
            <th className="px-3 py-2.5 font-semibold">When</th>
            <th className="px-3 py-2.5 font-semibold">Agent</th>
            <th className="px-3 py-2.5 font-semibold">Caller</th>
            <th className="px-3 py-2.5 font-semibold">Topic</th>
            <th className="px-3 py-2.5 font-semibold">Score</th>
            <th className="px-3 py-2.5 font-semibold">Duration</th>
            <th className="px-3 py-2.5 font-semibold text-right">Open</th>
          </tr>
        </thead>
        <tbody>
          {calls.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-8 text-center text-ink-soft">
                No recordings match. Try phone, extension, or Vonage recording id.
              </td>
            </tr>
          ) : (
            calls.map((call) => (
              <tr key={call.id} className="border-b border-line/70 last:border-0">
                <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">
                  {formatCallDate(call.call_date)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-ink">
                    {call.agent_name || "—"}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {call.vonage_extension
                      ? `Ext ${call.vonage_extension}`
                      : call.agent_email || ""}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-ink">
                    {call.vonage_cnam || call.patient_name || "—"}
                  </div>
                  <div className="text-xs text-ink-soft">
                    {formatPhone(call.vonage_caller_id) ||
                      call.vonage_caller_id ||
                      ""}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-ink-soft">{call.topic || "—"}</td>
                <td className="px-3 py-2.5 tabular-nums">
                  {call.quality_score == null
                    ? "—"
                    : Number(call.quality_score).toFixed(1)}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-ink-soft">
                  {formatDuration(call.duration_seconds)}
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Link
                    href={`/calls/${call.id}`}
                    className="text-xs font-semibold text-accent hover:underline"
                  >
                    Review
                  </Link>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { SampleCall } from "@/lib/qa";
import { QUEUE_STORAGE_KEY, hasFailedRules, type StoredQueue } from "@/lib/qa";
import { formatCallDate } from "@/lib/format";

type AgentOption = { email: string; name?: string };

type Props = {
  agents: AgentOption[];
  allowUnknown?: boolean;
};

export function SampleQueue({ agents, allowUnknown = true }: Props) {
  const [days, setDays] = useState(14);
  const [perAgent, setPerAgent] = useState(3);
  const [unknownCount, setUnknownCount] = useState(0);
  const [unreviewedOnly, setUnreviewedOnly] = useState(true);
  const [overweightFails, setOverweightFails] = useState(true);
  const [includeUnknown, setIncludeUnknown] = useState(false);
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sample, setSample] = useState<SampleCall[]>([]);
  const [poolSize, setPoolSize] = useState(0);
  const [buckets, setBuckets] = useState<Record<string, number>>({});

  const allSelected = selectedAgents.length === 0;

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/qa/sample", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          days,
          per_agent: perAgent,
          unknown_count: allowUnknown ? unknownCount : 0,
          unreviewed_only: unreviewedOnly,
          overweight_fails: overweightFails,
          include_unknown: allowUnknown && includeUnknown,
          agent_emails: allSelected ? null : selectedAgents,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sample failed");
      setSample(data.sample || []);
      setPoolSize(data.pool_size || 0);
      setBuckets(data.buckets || {});
      const queue: StoredQueue = {
        createdAt: new Date().toISOString(),
        ids: data.ids || [],
        cursor: 0,
      };
      sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sample failed");
    } finally {
      setLoading(false);
    }
  }

  function toggleAgent(email: string) {
    setSelectedAgents((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email]
    );
  }

  const bucketSummary = useMemo(() => {
    return Object.entries(buckets)
      .map(([key, count]) => {
        if (key === "__unknown__") return `Unknown: ${count}`;
        const agent = agents.find((a) => a.email === key);
        return `${agent?.name || key}: ${count}`;
      })
      .join(" · ");
  }, [buckets, agents]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
          Manager workflow
        </p>
        <h1 className="mt-1 font-display text-4xl text-ink">QA review queue</h1>
        <p className="mt-2 max-w-2xl text-ink-soft">
          {allowUnknown
            ? "Pull a random sample by agent — plus unknowns — then work through calls one at a time."
            : "Pull a random sample of your team's calls, then work through them one at a time."}
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-white/85 p-5 shadow-soft">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Lookback (days)">
            <input
              type="number"
              min={1}
              max={90}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Per agent">
            <input
              type="number"
              min={1}
              max={20}
              value={perAgent}
              onChange={(e) => setPerAgent(Number(e.target.value))}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Unknown sample">
            <input
              type="number"
              min={0}
              max={30}
              value={allowUnknown ? unknownCount : 0}
              onChange={(e) => setUnknownCount(Number(e.target.value))}
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
              disabled={!allowUnknown || !includeUnknown}
            />
          </Field>
          <div className="flex flex-col justify-end gap-2 text-sm font-semibold text-ink-soft">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={unreviewedOnly}
                onChange={(e) => setUnreviewedOnly(e.target.checked)}
              />
              Unreviewed only
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={overweightFails}
                onChange={(e) => setOverweightFails(e.target.checked)}
              />
              Overweight AI fails
            </label>
            {allowUnknown ? (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeUnknown}
                  onChange={(e) => setIncludeUnknown(e.target.checked)}
                />
                Include unassigned calls
              </label>
            ) : null}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Agents {allSelected ? "(all)" : `(${selectedAgents.length} selected)`}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedAgents([])}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                allSelected
                  ? "border-accent bg-wash text-accent"
                  : "border-line text-ink-soft hover:bg-wash"
              }`}
            >
              All {allowUnknown ? "agents" : "team"}
            </button>
            {agents.map((a) => {
              const on = selectedAgents.includes(a.email);
              return (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => toggleAgent(a.email)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    on
                      ? "border-accent bg-wash text-accent"
                      : "border-line text-ink-soft hover:bg-wash"
                  }`}
                >
                  {a.name || a.email}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={generate}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            {loading ? "Sampling…" : "Generate sample"}
          </button>
          {sample.length > 0 ? (
            <Link
              href={`/calls/${sample[0].id}?queue=1`}
              className="rounded-xl border border-accent px-5 py-2.5 text-sm font-semibold text-accent hover:bg-wash"
            >
              Start review ({sample.length})
            </Link>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm text-fail">{error}</p> : null}
      </div>

      {sample.length > 0 ? (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl text-ink">
                Sample · {sample.length} calls
              </h2>
              <p className="text-sm text-ink-soft">
                From {poolSize} complete calls in range
                {bucketSummary ? ` · ${bucketSummary}` : ""}
              </p>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-white/80 shadow-soft">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Topic</th>
                  <th className="px-4 py-3">Flags</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {sample.map((c, i) => (
                  <tr key={c.id} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-3 text-ink-soft">{i + 1}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {formatCallDate(c.call_date)}
                    </td>
                    <td className="px-4 py-3 font-semibold text-ink">
                      {c.agent_email
                        ? c.agent_name || c.agent_email
                        : c.agent_name
                          ? `Unknown · ${c.agent_name}`
                          : "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{c.topic || "General"}</td>
                    <td className="px-4 py-3">
                      {hasFailedRules(c) ? (
                        <span className="text-xs font-semibold text-fail">AI flags</span>
                      ) : (
                        <span className="text-xs font-semibold text-pass">Clean</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/calls/${c.id}?queue=1`}
                        onClick={() => {
                          const raw = sessionStorage.getItem(QUEUE_STORAGE_KEY);
                          if (!raw) return;
                          const q = JSON.parse(raw) as StoredQueue;
                          q.cursor = i;
                          sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(q));
                        }}
                        className="text-xs font-semibold text-accent hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </span>
      {children}
    </label>
  );
}

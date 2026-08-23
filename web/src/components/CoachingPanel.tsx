"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { MetricDoc, UserDoc } from "@/lib/database";
import { formatCallDate, formatDuration } from "@/lib/format";
import { QUEUE_STORAGE_KEY, type StoredQueue } from "@/lib/qa";

type Props = {
  isAdmin: boolean;
  canViewTeam?: boolean;
  initialUser: UserDoc;
  initialMetrics: MetricDoc[];
  agents: Array<{ email: string; name?: string }>;
  /** Optional 3-call review sample seeded from Call Ops. */
  sampleCallIds?: string[];
};

export function CoachingPanel({
  isAdmin,
  canViewTeam = false,
  initialUser,
  initialMetrics,
  agents,
  sampleCallIds = [],
}: Props) {
  const router = useRouter();
  const [agentEmail, setAgentEmail] = useState(initialUser.email);
  const [user, setUser] = useState(initialUser);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [reviewIds, setReviewIds] = useState(sampleCallIds);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [msg, setMsg] = useState("");

  const agentOptions = useMemo(() => {
    const rows = [...agents];
    if (!rows.some((a) => a.email === initialUser.email)) {
      rows.unshift({ email: initialUser.email, name: initialUser.name });
    }
    return rows.sort((a, b) =>
      (a.name || a.email).localeCompare(b.name || b.email)
    );
  }, [agents, initialUser]);

  async function loadAgent(email: string) {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(`/api/coaching?agent=${encodeURIComponent(email)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Load failed");
      setAgentEmail(email);
      setUser(data.user);
      setMetrics(data.metrics || []);
      setReviewIds(
        Array.isArray(data.sampleCallIds) ? data.sampleCallIds : []
      );
      router.replace(`/coaching?agent=${encodeURIComponent(email)}`, {
        scroll: false,
      });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setMsg("");
    try {
      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent: agentEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generate failed");
      setUser(data.user);
      setMetrics(data.metrics || []);
      setMsg("Coaching report updated from ops + QA signals.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  }

  function openSample() {
    if (!reviewIds.length) return;
    const queue: StoredQueue = {
      createdAt: new Date().toISOString(),
      ids: reviewIds,
      cursor: 0,
    };
    sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    window.location.href = `/calls/${reviewIds[0]}?queue=1`;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">
            Development
          </p>
          <h1 className="font-display text-3xl text-ink">Coaching</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Rolling AI coaching grounded in CDR access, QA scores, critical flags,
            and failed rules — not narrative alone.
          </p>
          {isAdmin ? (
            <p className="mt-2 text-xs text-ink-soft">
              Tip: open agents from{" "}
              <Link href="/ops" className="font-semibold text-accent hover:underline">
                Call ops → Coaching queue
              </Link>
              .
            </p>
          ) : null}
        </div>
        {(isAdmin || canViewTeam) && agents.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={agentEmail}
              disabled={loading || generating}
              onChange={(e) => loadAgent(e.target.value)}
              className="rounded-lg border border-line bg-white px-3 py-2 text-sm"
            >
              {agentOptions.map((a) => (
                <option key={a.email} value={a.email}>
                  {a.name || a.email}
                </option>
              ))}
            </select>
            {isAdmin ? (
              <button
                type="button"
                disabled={generating}
                onClick={generate}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
              >
                {generating ? "Generating…" : "Generate report"}
              </button>
            ) : null}
            {reviewIds.length ? (
              <button
                type="button"
                onClick={openSample}
                className="rounded-lg border border-accent px-4 py-2 text-sm font-semibold text-accent hover:bg-wash"
              >
                Review {reviewIds.length} calls
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {msg ? (
        <p className="mb-4 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          {msg}
        </p>
      ) : null}

      <div className="mb-6 rounded-xl border border-line bg-white/80 px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl text-ink">
            {user.name || user.email}
          </h2>
          <p className="text-xs text-ink-soft">
            Updated {formatCallDate(user.last_coaching_at)}
          </p>
        </div>
        <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink">
          {user.rolling_ai_feedback?.trim() ||
            "No coaching report yet. An admin can generate one from recent ops + QA signals."}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white/80">
        <div className="border-b border-line px-4 py-3">
          <h2 className="font-display text-xl text-ink">Weekly scores</h2>
          <p className="text-xs text-ink-soft">Recent rollups from completed QA calls.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-wash/60 text-xs uppercase tracking-wide text-ink-soft">
              <tr>
                <th className="px-3 py-2">Week</th>
                <th className="px-3 py-2">Calls</th>
                <th className="px-3 py-2">Quality</th>
                <th className="px-3 py-2">Empathy</th>
                <th className="px-3 py-2">FCR</th>
                <th className="px-3 py-2">Talk</th>
              </tr>
            </thead>
            <tbody>
              {metrics.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-ink-soft">
                    No weekly metrics yet.
                  </td>
                </tr>
              ) : (
                metrics.map((m) => (
                  <tr key={m.id} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2">
                      {m.week_start || "—"}
                      {m.week_end ? ` → ${m.week_end}` : ""}
                    </td>
                    <td className="px-3 py-2">{m.call_count ?? 0}</td>
                    <td className="px-3 py-2">
                      {(m.avg_quality_score ?? 0).toFixed(1)}
                    </td>
                    <td className="px-3 py-2">
                      {(m.avg_empathy_score ?? 0).toFixed(1)}
                    </td>
                    <td className="px-3 py-2">
                      {Math.round((m.fcr_rate ?? 0) * 100)}%
                    </td>
                    <td className="px-3 py-2">
                      {formatDuration(m.total_talk_time_seconds)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

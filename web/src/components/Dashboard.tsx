"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CallDoc } from "@/lib/database";
import type { HeatmapData } from "@/lib/qa";
import { agentBucketKey } from "@/lib/qa";
import {
  criticalFlagLabels,
  failedRuleLabels,
  formatCallDate,
  formatDuration,
  formatPhone,
  resolveDoctorName,
  resolvePatientName,
  sentimentDisplay,
} from "@/lib/format";
import { IssueHeatmap } from "@/components/IssueHeatmap";

type Props = {
  calls: CallDoc[];
  isAdmin: boolean;
  heatmap?: HeatmapData | null;
  heatmapDays?: number;
};

export function Dashboard({ calls, isAdmin, heatmap, heatmapDays = 14 }: Props) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const ruleFilter = searchParams.get("rule") || "";
  const agentFilter = searchParams.get("agent") || "";

  const [q, setQ] = useState("");
  const [failsOnly, setFailsOnly] = useState(!!ruleFilter);
  const [criticalOnly, setCriticalOnly] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return calls.filter((c) => {
      if (agentFilter) {
        if (agentBucketKey(c) !== agentFilter) return false;
      }
      if (ruleFilter) {
        const hit = (c.rule_results || []).some(
          (r) => (r.rule_id || r.label) === ruleFilter && !r.passed
        );
        if (!hit) return false;
      } else if (
        failsOnly &&
        !(c.auto_failed || (c.rule_results || []).some((r) => !r.passed))
      ) {
        return false;
      }
      if (criticalOnly && !(c.has_critical_flags || (c.critical_flags || []).length)) {
        return false;
      }
      if (!needle) return true;
      const hay = [
        c.agent_name,
        c.patient_name,
        c.vonage_cnam,
        c.vonage_caller_id,
        c.doctor_name,
        c.agent_email,
        c.topic,
        c.ai_summary,
        c.sentiment_label,
        ...(c.rule_results || []).map((r) => r.label),
        ...(c.critical_flags || []).map((f) => f.label || f.flag_id),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [calls, q, failsOnly, criticalOnly, ruleFilter, agentFilter]);

  const stats = useMemo(() => {
    const n = calls.length || 1;
    const avgQ =
      calls.reduce((s, c) => s + (c.quality_score || 0), 0) / (calls.length || 1);
    const avgE =
      calls.reduce((s, c) => s + (c.ai_empathy_score || 0), 0) / (calls.length || 1);
    const failCount = calls.filter(
      (c) => c.auto_failed || (c.rule_results || []).some((r) => !r.passed)
    ).length;
    const criticalCount = calls.filter(
      (c) => c.has_critical_flags || (c.critical_flags || []).length
    ).length;
    const fcrRate = (calls.filter((c) => c.fcr).length / n) * 100;
    return { avgQ, avgE, failCount, criticalCount, fcrRate, total: calls.length };
  }, [calls]);

  function clearHeatmapFilter() {
    router.push("/");
    setFailsOnly(false);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            {isAdmin ? "Team overview" : "My calls"}
          </p>
          <h1 className="mt-1 font-display text-4xl text-ink">Call QA dashboard</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Review scored calls, spot issue patterns, and pull a manager sample queue.
          </p>
        </div>
        {isAdmin ? (
          <Link
            href="/queue"
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep"
          >
            QA review queue
          </Link>
        ) : null}
      </div>

      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Calls" value={String(stats.total)} />
        <Stat label="Avg quality" value={stats.avgQ.toFixed(1)} />
        <Stat label="Avg empathy" value={stats.avgE.toFixed(1)} />
        <Stat label="FCR rate" value={`${stats.fcrRate.toFixed(0)}%`} />
        <Stat label="Critical flags" value={String(stats.criticalCount)} />
      </div>

      {isAdmin && heatmap ? (
        <div className="mb-10">
          <IssueHeatmap data={heatmap} days={heatmapDays} />
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search agent, topic, summary…"
          className="min-w-[240px] flex-1 rounded-xl border border-line bg-white px-4 py-2.5 text-sm shadow-sm"
        />
        <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-semibold text-ink-soft">
          <input
            type="checkbox"
            checked={failsOnly || !!ruleFilter}
            onChange={(e) => {
              setFailsOnly(e.target.checked);
              if (!e.target.checked && (ruleFilter || agentFilter)) clearHeatmapFilter();
            }}
          />
          Needs attention ({stats.failCount})
        </label>
        <label className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2.5 text-sm font-semibold text-ink-soft">
          <input
            type="checkbox"
            checked={criticalOnly}
            onChange={(e) => setCriticalOnly(e.target.checked)}
          />
          Critical ({stats.criticalCount})
        </label>
        {ruleFilter || agentFilter ? (
          <button
            type="button"
            onClick={clearHeatmapFilter}
            className="rounded-xl border border-line bg-wash px-3 py-2.5 text-sm font-semibold text-accent"
          >
            Clear heatmap filter
            {ruleFilter ? ` · ${ruleFilter}` : ""}
            {agentFilter === "__unknown__"
              ? " · Unknown"
              : agentFilter
                ? ` · ${agentFilter}`
                : ""}
          </button>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white/80 shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3 font-semibold">When</th>
              <th className="px-4 py-3 font-semibold">Patient</th>
              <th className="px-4 py-3 font-semibold">Agent</th>
              <th className="px-4 py-3 font-semibold">Topic</th>
              <th className="px-4 py-3 font-semibold">Scores</th>
              <th className="px-4 py-3 font-semibold">Sentiment</th>
              <th className="px-4 py-3 font-semibold">Flags</th>
              <th className="px-4 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink-soft">
                  No calls match.
                </td>
              </tr>
            ) : (
              filtered.map((c) => {
                const fails = failedRuleLabels(c);
                const critical = criticalFlagLabels(c);
                const sentiment = sentimentDisplay(c);
                return (
                  <tr key={c.id} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-3 align-top text-ink-soft">
                      <div>{formatCallDate(c.call_date)}</div>
                      <div className="text-xs">{formatDuration(c.duration_seconds)}</div>
                    </td>
                    <td className="px-4 py-3 align-top font-semibold text-ink">
                      {resolvePatientName(c)}
                      {formatPhone(c.vonage_caller_id) || resolveDoctorName(c) ? (
                        <div className="mt-0.5 text-xs font-normal text-ink-soft">
                          {[
                            formatPhone(c.vonage_caller_id) || null,
                            resolveDoctorName(c)
                              ? `Dr · ${resolveDoctorName(c)}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top text-ink">
                      {c.agent_name || c.agent_email || "—"}
                      {!c.agent_email && c.agent_name ? (
                        <div className="text-[11px] font-normal text-ink-soft">unmapped</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top text-ink-soft">
                      {c.topic || "General"}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div>
                        Q {c.quality_score ?? "—"} · E {c.ai_empathy_score ?? "—"}
                      </div>
                      <div className="text-xs text-ink-soft">
                        {c.transfer_count ?? 0} xfer · FCR {c.fcr ? "yes" : "no"}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {sentiment.label ? (
                        <SentimentBadge label={sentiment.label} score={sentiment.score} />
                      ) : (
                        <span className="text-xs text-ink-soft">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {critical.length || c.auto_failed || fails.length ? (
                        <div className="flex flex-wrap gap-1">
                          {critical.map((f) => (
                            <span
                              key={f}
                              className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-fail"
                            >
                              {f}
                            </span>
                          ))}
                          {c.auto_failed ? (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-fail">
                              AUTO-FAIL
                            </span>
                          ) : null}
                          {fails.slice(0, 2).map((f) => (
                            <span
                              key={f}
                              className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-warn"
                            >
                              {f}
                            </span>
                          ))}
                          {fails.length > 2 ? (
                            <span className="text-[11px] text-ink-soft">
                              +{fails.length - 2}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs font-semibold text-pass">Clean</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <Link
                        href={`/calls/${c.id}`}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-deep"
                      >
                        Review
                      </Link>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white/80 px-4 py-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </div>
      <div className="mt-1 font-display text-3xl text-ink">{value}</div>
    </div>
  );
}

function SentimentBadge({
  label,
  score,
}: {
  label: string;
  score: number | null;
}) {
  const tone =
    label === "positive"
      ? "bg-emerald-100 text-pass"
      : label === "negative"
        ? "bg-red-100 text-fail"
        : label === "mixed"
          ? "bg-amber-50 text-warn"
          : "bg-wash text-ink-soft";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${tone}`}>
      {label}
      {score != null ? <span className="opacity-70">{score}/10</span> : null}
    </span>
  );
}

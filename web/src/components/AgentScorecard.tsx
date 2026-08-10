"use client";

import Link from "next/link";
import type { AgentScorecardRow } from "@/lib/scorecard";
import { scorecardTierLabel } from "@/lib/scorecard";
import { formatDuration } from "@/lib/format";

type Props = {
  rows: AgentScorecardRow[];
  team: AgentScorecardRow;
  selectedKey: string;
  onSelect: (key: string) => void;
  days: number;
};

function pct(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

function num(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(digits);
}

function TierPill({ tier }: { tier: AgentScorecardRow["tier"] }) {
  const label = scorecardTierLabel(tier);
  if (tier === "rock_star") {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-pass">
        {label}
      </span>
    );
  }
  if (tier === "coach") {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-fail">
        {label}
      </span>
    );
  }
  if (tier === "unmapped") {
    return (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-warn">
        {label}
      </span>
    );
  }
  if (tier === "baseline") {
    return (
      <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
        {label}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
      {label}
    </span>
  );
}

function ScoreRow({
  row,
  selected,
  onSelect,
  emphasize,
}: {
  row: AgentScorecardRow;
  selected: boolean;
  onSelect: () => void;
  emphasize?: boolean;
}) {
  return (
    <tr
      className={`cursor-pointer border-b border-line/70 last:border-0 hover:bg-wash/50 ${
        selected ? "bg-wash/70" : ""
      } ${emphasize ? "bg-wash/40 font-semibold" : ""}`}
      onClick={onSelect}
    >
      <td className="px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={emphasize ? "text-ink" : "font-semibold text-ink"}>
            {row.name}
          </span>
          <TierPill tier={row.tier} />
        </div>
        {row.email ? (
          <div className="mt-0.5 text-xs font-normal text-ink-soft">{row.email}</div>
        ) : row.extension ? (
          <div className="mt-0.5 text-xs font-normal text-ink-soft">
            ext {row.extension}
          </div>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{pct(row.answerRate)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums text-[color:var(--warn)]">
        {pct(row.cdrCalls ? row.missedBucket / row.cdrCalls : 0)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {formatDuration(row.talkSeconds)}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-ink-soft">
        {row.cdrCalls}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{num(row.avgQuality)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{num(row.avgEmpathy)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{pct(row.fcrRate)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {row.criticalFlags ? (
          <span className="font-semibold text-fail">{row.criticalFlags}</span>
        ) : (
          "0"
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        {row.email && row.tier !== "baseline" ? (
          <Link
            href={`/coaching?agent=${encodeURIComponent(row.email)}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-semibold text-accent hover:underline"
          >
            Coach
          </Link>
        ) : (
          <span className="text-xs text-ink-soft">—</span>
        )}
      </td>
    </tr>
  );
}

export function AgentScorecard({
  rows,
  team,
  selectedKey,
  onSelect,
  days,
}: Props) {
  const rockStars = rows.filter((r) => r.tier === "rock_star").length;
  const needsCoach = rows.filter((r) => r.tier === "coach").length;

  return (
    <section className="mb-8 rounded-xl border border-line bg-white/80">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-display text-xl text-ink">Agent scorecard</h2>
          <p className="text-xs text-ink-soft">
            Mapped Workspace agents only · CDR access + QA quality · last {days}{" "}
            days. Click a row to filter the CDR log.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-pass">
            {rockStars} rock star{rockStars === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-fail">
            {needsCoach} need coach
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/60 text-[11px] uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-3 py-2 font-semibold">Agent</th>
              <th className="px-3 py-2 text-right font-semibold">Answer %</th>
              <th className="px-3 py-2 text-right font-semibold">Miss %</th>
              <th className="px-3 py-2 text-right font-semibold">Talk</th>
              <th className="px-3 py-2 text-right font-semibold">CDRs</th>
              <th className="px-3 py-2 text-right font-semibold">Quality</th>
              <th className="px-3 py-2 text-right font-semibold">Empathy</th>
              <th className="px-3 py-2 text-right font-semibold">FCR</th>
              <th className="px-3 py-2 text-right font-semibold">Flags</th>
              <th className="px-3 py-2 text-right font-semibold"> </th>
            </tr>
          </thead>
          <tbody>
            <ScoreRow
              row={team}
              selected={selectedKey === "team" || !selectedKey}
              onSelect={() => onSelect("")}
              emphasize
            />
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-ink-soft">
                  No mapped agent activity in this window.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <ScoreRow
                  key={row.key}
                  row={row}
                  selected={selectedKey === row.key}
                  onSelect={() =>
                    onSelect(selectedKey === row.key ? "" : row.key)
                  }
                />
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2 text-[11px] text-ink-soft">
        Only agents in Users are listed. Rock star = high answer rate + high
        quality + no critical flags (relative to team). Coach = weak access,
        quality/empathy, FCR, or flag volume.
      </p>
    </section>
  );
}

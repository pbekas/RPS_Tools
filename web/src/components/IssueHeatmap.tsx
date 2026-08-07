"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { HeatmapData } from "@/lib/qa";

type Props = {
  data: HeatmapData;
  days: number;
};

/** Pass rate coloring: high = green (good), low = red (needs attention). */
function cellColor(rate: number, total: number): string {
  if (total <= 0) return "bg-white text-ink-soft";
  if (rate >= 0.95) return "bg-emerald-200/90 text-pass";
  if (rate >= 0.8) return "bg-emerald-100 text-pass";
  if (rate >= 0.6) return "bg-amber-50 text-warn";
  if (rate >= 0.4) return "bg-amber-100 text-warn";
  if (rate >= 0.2) return "bg-orange-200 text-[#7a3b12]";
  return "bg-red-300/80 text-fail";
}

export function IssueHeatmap({ data, days }: Props) {
  const [hover, setHover] = useState<string | null>(null);

  const cellMap = useMemo(() => {
    const m = new Map<string, (typeof data.cells)[0]>();
    for (const c of data.cells) m.set(`${c.agentKey}||${c.ruleId}`, c);
    return m;
  }, [data.cells]);

  if (!data.agents.length || !data.rules.length) {
    return (
      <div className="rounded-2xl border border-line bg-white/80 px-5 py-8 text-sm text-ink-soft shadow-sm">
        No rule results in the last {days} days to chart yet.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-white/85 p-5 shadow-soft">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Rule pass heatmap</h2>
          <p className="text-sm text-ink-soft">
            Pass rate by rule × agent · last {days} days. Green = high pass rate. Click a
            cell to open calls that failed that rule.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-ink-soft">
          <span>Low</span>
          <span className="h-3 w-6 rounded bg-red-300/80 ring-1 ring-line" />
          <span className="h-3 w-6 rounded bg-orange-200 ring-1 ring-line" />
          <span className="h-3 w-6 rounded bg-amber-100 ring-1 ring-line" />
          <span className="h-3 w-6 rounded bg-emerald-100 ring-1 ring-line" />
          <span className="h-3 w-6 rounded bg-emerald-200/90 ring-1 ring-line" />
          <span>High</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-1 text-left text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white/95 px-2 py-2 font-semibold text-ink-soft">
                Rule
              </th>
              {data.agents.map((a) => (
                <th
                  key={a.key}
                  className="max-w-[7rem] truncate px-1 py-2 text-center font-semibold text-ink"
                  title={a.label}
                >
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rules.map((rule) => (
              <tr key={rule.id}>
                <th className="sticky left-0 z-10 bg-white/95 whitespace-nowrap px-2 py-1 text-left font-semibold text-ink">
                  {rule.label}
                </th>
                {data.agents.map((agent) => {
                  const cell = cellMap.get(`${agent.key}||${rule.id}`);
                  const rate = cell?.rate || 0;
                  const fails = cell?.fails || 0;
                  const passes = cell?.passes || 0;
                  const total = cell?.total || 0;
                  const key = `${agent.key}||${rule.id}`;
                  const href = `/?rule=${encodeURIComponent(rule.id)}&agent=${encodeURIComponent(agent.key)}`;
                  return (
                    <td key={key} className="p-0">
                      <Link
                        href={href}
                        onMouseEnter={() => setHover(key)}
                        onMouseLeave={() => setHover(null)}
                        className={`flex h-10 min-w-[4.5rem] flex-col items-center justify-center rounded-md px-1 transition ${cellColor(
                          rate,
                          total
                        )} ${hover === key ? "ring-2 ring-accent" : "ring-1 ring-black/5"}`}
                        title={`${agent.label} · ${rule.label}: ${passes}/${total} passed (${Math.round(rate * 100)}%) · ${fails} fail${fails === 1 ? "" : "s"}`}
                      >
                        <span className="font-bold">{Math.round(rate * 100)}%</span>
                        <span className="text-[10px] opacity-80">
                          {passes}/{total}
                        </span>
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import type { OpsTower, TrendPoint } from "@/lib/opsTower";

type Props = {
  tower: OpsTower;
  days: number;
  onSelectDirection?: (direction: string) => void;
  onSelectOutcome?: (label: string) => void;
  selectedDirection?: string;
  selectedOutcome?: string;
};

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function BarChart({
  points,
  valueKey = "total",
  maxBars,
}: {
  points: TrendPoint[];
  valueKey?: "total" | "answered";
  maxBars?: number;
}) {
  const rows = maxBars ? points.slice(-maxBars) : points;
  const max = Math.max(1, ...rows.map((p) => p[valueKey]));
  const chartPx = 160;
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: chartPx }}>
        {rows.map((p) => {
          const value = p[valueKey];
          const barPx =
            value > 0 ? Math.max(8, Math.round((value / max) * chartPx)) : 0;
          return (
            <div
              key={p.key}
              className="flex min-w-0 flex-1 flex-col justify-end"
              style={{ height: chartPx }}
              title={`${p.label}: ${p.total} calls · ${pct(p.answerRate)} answered`}
            >
              <div
                className="w-full rounded-t bg-accent transition hover:bg-accent-deep"
                style={{ height: barPx, minHeight: barPx ? 8 : 0 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {rows.map((p) => (
          <div
            key={`l-${p.key}`}
            className="min-w-0 flex-1 truncate text-center text-[10px] font-semibold text-ink-soft"
          >
            {p.label}
          </div>
        ))}
      </div>
      <div className="mt-0.5 flex gap-1.5">
        {rows.map((p) => (
          <div
            key={`c-${p.key}`}
            className="min-w-0 flex-1 text-center text-[10px] tabular-nums text-ink"
            title={`${p.total} calls`}
          >
            {p.total || "·"}
          </div>
        ))}
      </div>
      <div className="mt-0.5 flex gap-1.5">
        {rows.map((p) => (
          <div
            key={`r-${p.key}`}
            className="min-w-0 flex-1 text-center text-[10px] tabular-nums text-ink-soft"
            title={`Answer rate ${pct(p.answerRate)}`}
          >
            {p.total ? `${Math.round(p.answerRate * 100)}%` : "·"}
          </div>
        ))}
      </div>
    </div>
  );
}

function ShareBars({
  items,
  selected,
  onSelect,
}: {
  items: Array<{ key: string; label: string; count: number; share: number; tone?: string }>;
  selected?: string;
  onSelect?: (key: string) => void;
}) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const active = selected === item.key;
        return (
          <li key={item.key}>
            <button
              type="button"
              disabled={!onSelect}
              onClick={() => onSelect?.(active ? "" : item.key)}
              className={`block w-full rounded-lg border px-3 py-2 text-left ${
                onSelect ? "hover:bg-wash/60" : ""
              } ${active ? "border-accent bg-wash" : "border-line"}`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-ink">{item.label}</span>
                <span className="tabular-nums text-ink-soft">
                  {item.count} · {pct(item.share)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-wash">
                <div
                  className={`h-full rounded-full ${item.tone || "bg-accent"}`}
                  style={{ width: `${Math.round((item.count / max) * 100)}%` }}
                />
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function OpsControlTower({
  tower,
  days,
  onSelectDirection,
  onSelectOutcome,
  selectedDirection,
  selectedOutcome,
}: Props) {
  const businessHours = tower.byHour.filter((h) => {
    const hour = Number(h.key);
    return hour >= 7 && hour <= 19;
  });
  const showDow = days >= 3;
  const showDaily = days >= 2 && tower.byDay.length > 1;

  const outcomeTone = (bucket: string) => {
    if (bucket === "answered") return "bg-[color:var(--pass)]";
    if (bucket === "abandoned") return "bg-[color:var(--fail)]";
    if (bucket === "voicemail" || bucket === "no_answer") {
      return "bg-[color:var(--warn)]";
    }
    return "bg-accent";
  };

  return (
    <section className="mb-8 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">Ops control tower</h2>
          <p className="text-xs text-ink-soft">
            Access trends, direction mix, abandon taxonomy, and QA coverage ·{" "}
            {tower.timezone} · last {days} days
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label="Inbound answer %"
          value={pct(tower.inboundAnswerRate)}
          hint={`${tower.inboundAnswered}/${tower.inboundTotal} inbound`}
          tone="pass"
        />
        <Kpi
          label="Missed %"
          value={pct(tower.missedRate)}
          hint={`${tower.missed}/${tower.total} non-answered`}
          tone={tower.missedRate > 0.1 ? "fail" : "warn"}
        />
        <Kpi
          label="Abandon %"
          value={pct(tower.abandonRate)}
          hint={`${tower.abandonCount} abandoned`}
          tone={tower.abandonRate > 0.08 ? "fail" : "warn"}
        />
        <Kpi
          label="QA coverage"
          value={pct(tower.qaCoverage)}
          hint={`${tower.withQa}/${tower.total} CDRs matched to QA`}
        />
        <Kpi
          label="QA of answered"
          value={pct(tower.qaCoverageOfAnswered)}
          hint="Answered CDRs with a scored recording"
          tone="pass"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-white/80 p-4">
          <h3 className="font-display text-lg text-ink">Volume by hour</h3>
          <p className="mb-3 text-xs text-ink-soft">
            Clinic hours 7am–7pm · bars = calls · middle = count · bottom = answer %
          </p>
          {businessHours.every((h) => h.total === 0) ? (
            <p className="py-8 text-center text-sm text-ink-soft">No hourly data.</p>
          ) : (
            <BarChart points={businessHours} />
          )}
        </div>

        {showDaily ? (
          <div className="rounded-xl border border-line bg-white/80 p-4">
            <h3 className="font-display text-lg text-ink">Volume by day</h3>
            <p className="mb-3 text-xs text-ink-soft">
              Daily CDR volume in {tower.timezone} · bars = calls · bottom = answer %
            </p>
            <BarChart points={tower.byDay} maxBars={31} />
          </div>
        ) : showDow ? (
          <div className="rounded-xl border border-line bg-white/80 p-4">
            <h3 className="font-display text-lg text-ink">Volume by weekday</h3>
            <p className="mb-3 text-xs text-ink-soft">Mon–Sun pattern</p>
            <BarChart points={tower.byDow} />
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-white/80 p-4">
            <h3 className="font-display text-lg text-ink">Direction mix</h3>
            <p className="mb-3 text-xs text-ink-soft">
              Click to filter the CDR table
            </p>
            <ShareBars
              selected={selectedDirection}
              onSelect={onSelectDirection}
              items={tower.byDirection.map((d) => ({
                key: d.direction,
                label: d.direction,
                count: d.total,
                share: tower.total ? d.total / tower.total : 0,
              }))}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {(showDaily || showDow) && (
          <div className="rounded-xl border border-line bg-white/80 p-4">
            <h3 className="font-display text-lg text-ink">Direction mix</h3>
            <p className="mb-3 text-xs text-ink-soft">
              Inbound / outbound / extension · click to filter
            </p>
            {tower.byDirection.length === 0 ? (
              <p className="text-sm text-ink-soft">No direction data.</p>
            ) : (
              <ShareBars
                selected={selectedDirection}
                onSelect={onSelectDirection}
                items={tower.byDirection.map((d) => ({
                  key: d.direction,
                  label: `${d.direction} · ${pct(d.answerRate)} ans`,
                  count: d.total,
                  share: tower.total ? d.total / tower.total : 0,
                }))}
              />
            )}
          </div>
        )}

        <div className="rounded-xl border border-line bg-white/80 p-4">
          <h3 className="font-display text-lg text-ink">Outcome taxonomy</h3>
          <p className="mb-3 text-xs text-ink-soft">
            Abandon vs missed vs voicemail (not one “missed” bucket)
          </p>
          {tower.byOutcome.length === 0 ? (
            <p className="text-sm text-ink-soft">No outcomes yet.</p>
          ) : (
            <ShareBars
              selected={selectedOutcome}
              onSelect={onSelectOutcome}
              items={tower.byOutcome.map((o) => ({
                key: o.label,
                label: o.label,
                count: o.count,
                share: o.share,
                tone: outcomeTone(o.bucket),
              }))}
            />
          )}
        </div>

        {showDaily && showDow ? (
          <div className="rounded-xl border border-line bg-white/80 p-4 lg:col-span-2">
            <h3 className="font-display text-lg text-ink">Volume by weekday</h3>
            <p className="mb-3 text-xs text-ink-soft">Mon–Sun pattern across the window</p>
            <BarChart points={tower.byDow} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "pass" | "warn" | "fail";
}) {
  const color =
    tone === "pass"
      ? "text-[color:var(--pass)]"
      : tone === "warn"
        ? "text-[color:var(--warn)]"
        : tone === "fail"
          ? "text-[color:var(--fail)]"
          : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-white/80 px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </div>
      <div className={`mt-1 font-display text-2xl ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] text-ink-soft">{hint}</div>
    </div>
  );
}

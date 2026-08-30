"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TimeClockPersonHours } from "@/components/TimeClockPersonHours";
import type { TimeClockReport, TimeClockSettings } from "@/lib/timeClockTypes";
import { formatHours } from "@/lib/timeClockFormat";
import {
  resolveNamedRange,
  type NamedRangeKind,
} from "@/lib/timeClockPayPeriod";

type Props = {
  initialReport: TimeClockReport;
  settings: TimeClockSettings;
  initialRange: NamedRangeKind;
  initialOffset: number;
  initialPerson?: string;
  scopeLabel?: string;
};

const RANGE_TABS: Array<{ id: NamedRangeKind; label: string }> = [
  { id: "week", label: "Week" },
  { id: "pay_period", label: "Pay period" },
  { id: "month", label: "Month" },
];

export function TeamTimesheet({
  initialReport,
  settings,
  initialRange,
  initialOffset,
  initialPerson,
  scopeLabel,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [range, setRange] = useState<NamedRangeKind>(initialRange);
  const [offset, setOffset] = useState(initialOffset);
  const [report, setReport] = useState(initialReport);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    initialPerson ? { [initialPerson.toLowerCase()]: true } : {}
  );

  const bounds = useMemo(
    () => resolveNamedRange(range, settings.timezone, new Date(), offset),
    [range, settings.timezone, offset]
  );

  const writeUrl = useCallback(
    (nextRange: NamedRangeKind, nextOffset: number, person?: string) => {
      const params = new URLSearchParams();
      params.set("range", nextRange);
      if (nextOffset) params.set("offset", String(nextOffset));
      if (person) params.set("person", person);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router]
  );

  async function loadRange(nextRange: NamedRangeKind, nextOffset: number) {
    setBusy(true);
    setMsg("");
    try {
      const params = new URLSearchParams({
        team: "1",
        range: nextRange,
        offset: String(nextOffset),
      });
      const res = await fetch(`/api/time-clock/report?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load team hours");
      setRange(nextRange);
      setOffset(nextOffset);
      setReport(data.report);
      setExpanded({});
      writeUrl(nextRange, nextOffset);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed to load team hours");
    } finally {
      setBusy(false);
    }
  }

  function togglePerson(email: string) {
    const key = email.toLowerCase();
    setExpanded((current) => {
      const nextOpen = !current[key];
      writeUrl(range, offset, nextOpen ? key : undefined);
      return nextOpen ? { [key]: true } : {};
    });
  }

  const people = useMemo(() => {
    const rows = report.by_user || [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (user) =>
        user.user_name.toLowerCase().includes(needle) ||
        user.user_email.toLowerCase().includes(needle)
    );
  }, [report, query]);

  const withHours = people.filter((user) => user.total_hours > 0);
  const noPunches = people.filter((user) => user.total_hours <= 0);
  const showWeekly = range !== "week";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-line bg-wash p-1 text-sm font-semibold">
          {RANGE_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              disabled={busy}
              onClick={() => loadRange(tab.id, 0)}
              className={`rounded-md px-3 py-1.5 ${
                range === tab.id ? "bg-white text-accent shadow-sm" : "text-ink-soft"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => loadRange(range, offset - 1)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={busy || offset === 0}
            onClick={() => loadRange(range, 0)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-40"
          >
            Current
          </button>
          <button
            type="button"
            disabled={busy || offset >= 0}
            onClick={() => loadRange(range, offset + 1)}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-white/90 px-4 py-4">
        <p className="text-sm text-ink-soft">{bounds.label}</p>
        <p className="font-display text-3xl text-ink">
          {formatHours(report.total_hours)}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          {scopeLabel ? `${scopeLabel} · ` : ""}
          {bounds.start} – {bounds.end} · {report.timezone}
        </p>
      </div>

      {msg ? <p className="text-sm text-fail">{msg}</p> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">Hours by person</h2>
          <p className="text-sm text-ink-soft">
            Click a person to see the punches that make up their hours.
          </p>
        </div>
        {(report.by_user?.length || 0) > 6 ? (
          <label className="text-sm">
            <span className="sr-only">Search people</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search people"
              className="rounded-lg border border-line px-3 py-2"
            />
          </label>
        ) : null}
      </div>

      {withHours.length || noPunches.length ? (
        <div className="space-y-3">
          {withHours.length ? (
            <div className="overflow-hidden rounded-xl border border-line bg-white/90">
              {withHours.map((user) => (
                <TimeClockPersonHours
                  key={user.user_email}
                  user={user}
                  timezone={report.timezone}
                  open={Boolean(expanded[user.user_email.toLowerCase()])}
                  onToggle={() => togglePerson(user.user_email)}
                  showWeekly={showWeekly}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-line bg-white/90 px-4 py-4 text-sm text-ink-soft">
              {query.trim()
                ? "No matching people with hours in this period."
                : "No hours in this period."}
            </p>
          )}

          {noPunches.length ? (
            <details className="group overflow-hidden rounded-xl border border-line bg-white/90">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink-soft hover:bg-wash/70 [&::-webkit-details-marker]:hidden">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block transition-transform group-open:rotate-90"
                    aria-hidden
                  >
                    ▸
                  </span>
                  No punches ({noPunches.length})
                </span>
              </summary>
              <div className="border-t border-line">
                {noPunches.map((user) => (
                  <TimeClockPersonHours
                    key={user.user_email}
                    user={user}
                    timezone={report.timezone}
                    open={Boolean(expanded[user.user_email.toLowerCase()])}
                    onToggle={() => togglePerson(user.user_email)}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : (
        <p className="rounded-xl border border-line bg-white/90 px-4 py-4 text-sm text-ink-soft">
          {query.trim() ? "No people match that search." : "No people on this team."}
        </p>
      )}
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import type { TeamTimeOffEntry, TimeOffEntry } from "@/lib/timeClockTypes";
import { TIME_OFF_KIND_LABELS } from "@/lib/timeClockTypes";
import { formatHours, formatYmd } from "@/lib/timeClockFormat";

type Props = {
  initialRequests: TimeOffEntry[];
  overlapEntries: TeamTimeOffEntry[];
};

export function TimeOffApprovals({ initialRequests, overlapEntries }: Props) {
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const othersByDate = useMemo(() => {
    const map = new Map<string, TeamTimeOffEntry[]>();
    for (const entry of overlapEntries) {
      const list = map.get(entry.entry_date) || [];
      list.push(entry);
      map.set(entry.entry_date, list);
    }
    return map;
  }, [overlapEntries]);

  async function review(entry: TimeOffEntry, approve: boolean) {
    setBusyId(entry.id);
    setMsg("");
    try {
      const res = await fetch(`/api/time-clock/time-off/${entry.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: approve ? "approve" : "deny",
          review_notes: notes[entry.id] || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setRequests((prev) => prev.filter((r) => r.id !== entry.id));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!requests.length) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-sm text-ink-soft">
        No time-off requests waiting for approval.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {msg ? <p className="text-sm text-fail">{msg}</p> : null}
      {requests.map((entry) => {
        const others = (othersByDate.get(entry.entry_date) || []).filter(
          (other) => other.user_email !== entry.user_email
        );
        return (
          <div
            key={entry.id}
            className="rounded-xl border border-line bg-white/90 p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-ink">
                  {entry.user_name || entry.user_email}
                </p>
                <p className="text-sm text-ink-soft">{entry.user_email}</p>
              </div>
              <p className="text-lg font-semibold text-accent">
                {formatHours(entry.hours)}
              </p>
            </div>
            <p className="mt-2 text-sm text-ink">
              {formatYmd(entry.entry_date)} ·{" "}
              {TIME_OFF_KIND_LABELS[entry.kind] || entry.kind}
              {entry.notes ? ` — ${entry.notes}` : ""}
            </p>
            {others.length ? (
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                  others.length >= 2
                    ? "border border-warn/40 bg-warn/10 text-ink"
                    : "border border-line bg-wash/80 text-ink"
                }`}
              >
                <p className="font-semibold">
                  {others.length === 1
                    ? "Someone else is also off this day"
                    : `${others.length} other people are also off this day`}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {others.map((other) => (
                    <li key={other.id} className="text-ink-soft">
                      {other.user_name || other.user_email}
                      {other.team_name ? ` · ${other.team_name}` : ""}
                      {" · "}
                      {TIME_OFF_KIND_LABELS[other.kind] || other.kind}
                      {" · "}
                      {other.status === "approved" ? "approved" : "requested"}
                      {" · "}
                      {formatHours(other.hours)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink-soft">
                Nobody else has requested this date.
              </p>
            )}
            <textarea
              value={notes[entry.id] || ""}
              onChange={(e) =>
                setNotes((prev) => ({ ...prev, [entry.id]: e.target.value }))
              }
              placeholder="Optional note (shown if you deny the request)"
              rows={2}
              className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busyId === entry.id}
                onClick={() => review(entry, true)}
                className="rounded-lg bg-pass px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busyId === entry.id}
                onClick={() => review(entry, false)}
                className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fail disabled:opacity-50"
              >
                Deny
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

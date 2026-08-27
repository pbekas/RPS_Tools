"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchSelect } from "@/components/SearchSelect";
import { formatDateTime, formatYmd, localYmd } from "@/lib/timeClockFormat";
import type {
  ApprovalHistoryItem,
  ApprovalHistoryType,
} from "@/lib/timeClockTypes";

type Person = { email: string; name: string };

type Props = {
  people: Person[];
  timezone: string;
};

const TYPE_LABELS: Record<ApprovalHistoryType, string> = {
  timesheet: "Timesheet",
  edit: "Time edit",
  timeoff: "Time off",
};

function addDaysYmd(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function defaultRange(timezone: string): { from: string; to: string } {
  const to = localYmd(new Date().toISOString(), timezone);
  return { from: addDaysYmd(to, -90), to };
}

export function ApprovalsHistory({ people, timezone }: Props) {
  const defaults = useMemo(() => defaultRange(timezone), [timezone]);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"all" | ApprovalHistoryType>("all");
  const [person, setPerson] = useState("");
  const [status, setStatus] = useState<"all" | "approved" | "denied">("all");
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [items, setItems] = useState<ApprovalHistoryItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const personOptions = useMemo(
    () =>
      people.map((row) => ({
        value: row.email,
        label: row.name || row.email,
        hint: row.email,
      })),
    [people]
  );

  useEffect(() => {
    if (!open) return;
    if (!from || !to) {
      setMsg("Choose a from and to date.");
      return;
    }
    const controller = new AbortController();
    async function load() {
      setBusy(true);
      setMsg("");
      try {
        const params = new URLSearchParams({
          type,
          status,
          from,
          to,
        });
        if (person) params.set("person", person);
        const res = await fetch(
          `/api/time-clock/approvals/history?${params}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load history");
        setItems(data.items || []);
      } catch (err) {
        if (controller.signal.aborted) return;
        setMsg(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    load();
    return () => controller.abort();
  }, [open, type, person, status, from, to]);

  return (
    <details
      className="group overflow-hidden rounded-xl border border-line bg-white/90"
      onToggle={(event) =>
        setOpen((event.currentTarget as HTMLDetailsElement).open)
      }
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink hover:bg-wash/70 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <span
            className="inline-block text-ink-soft transition-transform group-open:rotate-90"
            aria-hidden
          >
            ▸
          </span>
          Completed
          {items ? ` (${items.length})` : ""}
        </span>
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        <p className="text-sm text-ink-soft">
          Approved and denied items. Dates apply to the timesheet week, punch
          day, or time-off date.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm">
            <span className="font-semibold text-ink-soft">Type</span>
            <select
              value={type}
              onChange={(e) =>
                setType(e.target.value as "all" | ApprovalHistoryType)
              }
              className="mt-1 block w-full rounded-lg border border-line px-3 py-2"
            >
              <option value="all">All types</option>
              <option value="timesheet">Weekly timesheets</option>
              <option value="edit">Time edits</option>
              <option value="timeoff">Time off</option>
            </select>
          </label>
          <label className="text-sm lg:col-span-1">
            <span className="font-semibold text-ink-soft">Person</span>
            <div className="mt-1">
              <SearchSelect
                options={personOptions}
                value={person}
                onChange={setPerson}
                placeholder="Everyone"
                blankLabel="Everyone"
              />
            </div>
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-soft">Status</span>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "all" | "approved" | "denied")
              }
              className="mt-1 block w-full rounded-lg border border-line px-3 py-2"
            >
              <option value="all">All statuses</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-soft">From</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-soft">To</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
        </div>

        {msg ? <p className="text-sm text-fail">{msg}</p> : null}
        {busy && !items ? (
          <p className="text-sm text-ink-soft">Loading completed items…</p>
        ) : null}
        {items && !items.length && !busy ? (
          <p className="rounded-lg border border-dashed border-line bg-wash/40 px-4 py-6 text-center text-sm text-ink-soft">
            No completed items match these filters.
          </p>
        ) : null}

        {items?.length ? (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-sm">
              <thead className="border-b border-line bg-wash/60 text-left text-ink-soft">
                <tr>
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Type</th>
                  <th className="px-3 py-2 font-semibold">Person</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Detail</th>
                  <th className="px-3 py-2 font-semibold">Reviewed</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b border-line/60 align-top last:border-0"
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-ink">
                      {formatYmd(item.item_date)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                      {TYPE_LABELS[item.type]}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-ink">
                        {item.person_name}
                      </div>
                      <div className="text-xs text-ink-soft">
                        {item.person_email}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={
                          item.status === "approved" ? "text-pass" : "text-fail"
                        }
                      >
                        {item.status === "approved" ? "Approved" : "Denied"}
                      </span>
                    </td>
                    <td className="max-w-xs px-3 py-2">
                      <p className="text-ink">{item.summary}</p>
                      {item.review_notes ? (
                        <p className="mt-1 text-xs text-ink-soft">
                          {item.review_notes}
                        </p>
                      ) : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-ink-soft">
                      <div>
                        {item.reviewed_at
                          ? formatDateTime(item.reviewed_at, timezone)
                          : "—"}
                      </div>
                      {item.reviewer_name ? (
                        <div className="text-xs">{item.reviewer_name}</div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {busy && items?.length ? (
          <p className="text-sm text-ink-soft">Updating…</p>
        ) : null}
      </div>
    </details>
  );
}

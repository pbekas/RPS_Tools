"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type {
  ContractAssignee,
  ContractEntity,
  ContractObligation,
  ObligationKind,
} from "@/lib/contractTypes";
import { CALENDAR_OBLIGATION_KINDS } from "@/lib/contractTypes";
import {
  formatIsoDate,
  obligationKindLabel,
  obligationTone,
} from "@/lib/contractLabels";

function monthKey(iso?: string | null): string {
  if (!iso) return "No date";
  return iso.slice(0, 7);
}

function monthLabel(key: string): string {
  if (key === "No date") return key;
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function ObligationsCalendar({
  initialObligations,
  entities,
  assignees,
}: {
  initialObligations: ContractObligation[];
  entities: ContractEntity[];
  assignees: ContractAssignee[];
}) {
  const [items, setItems] = useState(initialObligations);
  const [kind, setKind] = useState("");
  const [entityId, setEntityId] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [status, setStatus] = useState("open");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function reload(next?: {
    kind?: string;
    entityId?: string;
    ownerEmail?: string;
    status?: string;
  }) {
    startTransition(async () => {
      const params = new URLSearchParams();
      const k = next?.kind ?? kind;
      const entity = next?.entityId ?? entityId;
      const owner = next?.ownerEmail ?? ownerEmail;
      const s = next?.status ?? status;
      if (k) params.set("kind", k);
      if (entity) params.set("entityId", entity);
      if (owner) params.set("ownerEmail", owner);
      if (s) params.set("status", s);
      params.set("limit", "400");
      const res = await fetch(`/api/contracts/obligations?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Failed to load calendar");
        return;
      }
      setItems(data.obligations || []);
      setMessage("");
    });
  }

  function markDone(item: ContractObligation) {
    startTransition(async () => {
      const res = await fetch("/api/contracts/obligations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          contract_id: item.contract_id,
          kind: item.kind,
          title: item.title,
          due_date: item.due_date,
          owner_email: item.owner_email,
          notes: item.notes,
          status: item.status === "done" ? "open" : "done",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Update failed");
        return;
      }
      reload();
    });
  }

  const grouped = useMemo(() => {
    const map = new Map<string, ContractObligation[]>();
    for (const item of items) {
      const key = monthKey(item.due_date);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [items]);

  const overdue = items.filter(
    (item) =>
      item.status === "open" &&
      item.due_date &&
      item.due_date < new Date().toISOString().slice(0, 10)
  ).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">
            Contracts
          </p>
          <h1 className="mt-1 font-display text-3xl text-ink">Obligation calendar</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Notice windows, auto-renewals, rent bumps, insurance, and guarantees —
            not just expiration dates.
          </p>
        </div>
        <div className="text-sm text-ink-soft">
          {items.length} items
          {overdue ? <span className="ml-2 font-semibold text-fail">{overdue} overdue</span> : null}
        </div>
      </div>

      <form
        className="mb-6 grid gap-3 rounded-2xl border border-line bg-white/70 p-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          reload();
        }}
      >
        <select
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">All kinds</option>
          {CALENDAR_OBLIGATION_KINDS.map((value) => (
            <option key={value} value={value}>
              {obligationKindLabel(value as ObligationKind)}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
        >
          <option value="">All companies</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={ownerEmail}
          onChange={(e) => setOwnerEmail(e.target.value)}
        >
          <option value="">All owners</option>
          {assignees.map((user) => (
            <option key={user.email} value={user.email}>
              {user.name}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="overdue">Overdue</option>
          <option value="upcoming">Upcoming</option>
          <option value="done">Done</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-60"
        >
          {pending ? "Loading…" : "Apply"}
        </button>
      </form>
      {message ? <p className="mb-4 text-sm text-warn">{message}</p> : null}

      {grouped.length === 0 ? (
        <div className="rounded-2xl border border-line bg-white/80 px-4 py-10 text-center text-ink-soft">
          Nothing on the calendar for these filters.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([key, rows]) => (
            <section key={key} className="rounded-2xl border border-line bg-white/80">
              <h2 className="border-b border-line px-4 py-3 font-semibold text-ink">
                {monthLabel(key)}
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-ink-soft">
                    <tr>
                      <th className="px-4 py-2 font-semibold">Due</th>
                      <th className="px-4 py-2 font-semibold">Obligation</th>
                      <th className="px-4 py-2 font-semibold">Contract</th>
                      <th className="px-4 py-2 font-semibold">Company</th>
                      <th className="px-4 py-2 font-semibold">Owner</th>
                      <th className="px-4 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((item) => (
                      <tr key={item.id} className="border-t border-line/70">
                        <td className="px-4 py-3 text-ink-soft">
                          {formatIsoDate(item.due_date)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-ink">{item.title}</div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            <span
                              className={`rounded-md px-2 py-0.5 text-xs font-semibold ${obligationTone(
                                item.due_date,
                                item.status
                              )}`}
                            >
                              {obligationKindLabel(item.kind)}
                            </span>
                            {item.notes ? (
                              <span className="text-xs text-ink-soft">{item.notes}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Link
                            href={`/contracts/${item.contract_id}`}
                            className="font-semibold text-ink hover:text-accent"
                          >
                            {item.contract_title || "Contract"}
                          </Link>
                          <div className="text-xs text-ink-soft">
                            {item.vendor_name || ""}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink-soft">
                          {item.entity_name || "—"}
                        </td>
                        <td className="px-4 py-3 text-ink-soft">
                          {item.owner_name || item.owner_email || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => markDone(item)}
                            className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-wash"
                          >
                            {item.status === "done" ? "Reopen" : "Mark done"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

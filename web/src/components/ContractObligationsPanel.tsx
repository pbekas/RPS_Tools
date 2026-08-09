"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type {
  ContractAssignee,
  ContractObligation,
  ObligationKind,
} from "@/lib/contractTypes";
import { CALENDAR_OBLIGATION_KINDS } from "@/lib/contractTypes";
import {
  formatIsoDate,
  obligationKindLabel,
  obligationTone,
} from "@/lib/contractLabels";

export function ContractObligationsPanel({
  contractId,
  initialObligations,
  assignees,
  refreshKey,
}: {
  contractId: string;
  initialObligations: ContractObligation[];
  assignees: ContractAssignee[];
  refreshKey?: string;
}) {
  const [items, setItems] = useState(initialObligations);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const firstKey = useRef(refreshKey);
  const [draft, setDraft] = useState({
    kind: "other" as ObligationKind,
    title: "",
    due_date: "",
    owner_email: "",
    notes: "",
  });

  useEffect(() => {
    if (!refreshKey || refreshKey === firstKey.current) return;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, contractId]);

  function reload() {
    startTransition(async () => {
      const res = await fetch(`/api/contracts/obligations?contractId=${contractId}`);
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Failed to reload obligations");
        return;
      }
      setItems(data.obligations || []);
    });
  }

  function save(body: Record<string, unknown>) {
    startTransition(async () => {
      const res = await fetch("/api/contracts/obligations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Save failed");
        return;
      }
      setMessage("Obligation saved");
      reload();
    });
  }

  return (
    <section className="rounded-2xl border border-line bg-white/80 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">Obligations</h2>
        <span className="text-xs text-ink-soft">{items.length} items</span>
      </div>
      {message ? <p className="mb-3 text-xs text-ink-soft">{message}</p> : null}
      <div className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No calendar items yet. Re-run Bedrock or add one below.
          </p>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-xl border border-line/80 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-ink">{item.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`rounded-md px-2 py-0.5 font-semibold ${obligationTone(
                        item.due_date,
                        item.status
                      )}`}
                    >
                      {obligationKindLabel(item.kind)}
                    </span>
                    <span className="text-ink-soft">
                      Due {formatIsoDate(item.due_date)}
                    </span>
                    <span className="text-ink-soft">{item.source}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {item.status === "open" ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        save({
                          id: item.id,
                          contract_id: contractId,
                          kind: item.kind,
                          title: item.title,
                          due_date: item.due_date,
                          owner_email: item.owner_email,
                          notes: item.notes,
                          status: "done",
                        })
                      }
                      className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-wash"
                    >
                      Mark done
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        save({
                          id: item.id,
                          contract_id: contractId,
                          kind: item.kind,
                          title: item.title,
                          due_date: item.due_date,
                          owner_email: item.owner_email,
                          notes: item.notes,
                          status: "open",
                        })
                      }
                      className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-ink-soft hover:bg-wash"
                    >
                      Reopen
                    </button>
                  )}
                  {item.source === "manual" ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        save({
                          action: "delete",
                          id: item.id,
                          contract_id: contractId,
                        })
                      }
                      className="rounded-lg border border-line px-2 py-1 text-xs font-semibold text-fail hover:bg-fail/5"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              </div>
              {item.notes ? (
                <p className="mt-2 text-sm text-ink-soft">{item.notes}</p>
              ) : null}
              <label className="mt-2 block text-xs text-ink-soft">
                Owner
                <select
                  className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-sm"
                  value={item.owner_email || ""}
                  disabled={pending}
                  onChange={(e) =>
                    save({
                      id: item.id,
                      contract_id: contractId,
                      kind: item.kind,
                      title: item.title,
                      due_date: item.due_date,
                      notes: item.notes,
                      status: item.status,
                      owner_email: e.target.value || null,
                    })
                  }
                >
                  <option value="">Unassigned</option>
                  {assignees.map((user) => (
                    <option key={user.email} value={user.email}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))
        )}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-sm font-semibold text-ink-soft">Add obligation</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <select
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={draft.kind}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, kind: e.target.value as ObligationKind }))
            }
          >
            {CALENDAR_OBLIGATION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {obligationKindLabel(kind)}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={draft.due_date}
            onChange={(e) => setDraft((prev) => ({ ...prev, due_date: e.target.value }))}
          />
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm sm:col-span-2"
            placeholder="Title"
            value={draft.title}
            onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
          />
          <select
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={draft.owner_email}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, owner_email: e.target.value }))
            }
          >
            <option value="">Unassigned</option>
            {assignees.map((user) => (
              <option key={user.email} value={user.email}>
                {user.name}
              </option>
            ))}
          </select>
          <input
            className="rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="Notes"
            value={draft.notes}
            onChange={(e) => setDraft((prev) => ({ ...prev, notes: e.target.value }))}
          />
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            save({
              contract_id: contractId,
              kind: draft.kind,
              title: draft.title,
              due_date: draft.due_date || null,
              owner_email: draft.owner_email || null,
              notes: draft.notes,
              status: "open",
            });
            setDraft({
              kind: "other",
              title: "",
              due_date: "",
              owner_email: "",
              notes: "",
            });
          }}
          className="mt-3 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-60"
        >
          Add to calendar
        </button>
      </div>
    </section>
  );
}

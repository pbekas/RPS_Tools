"use client";

import { useState, useTransition } from "react";
import type { ContractGroup } from "@/lib/contractsDb";

export function GroupsPanel({ initialGroups }: { initialGroups: ContractGroup[] }) {
  const [groups, setGroups] = useState(initialGroups);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState(50);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function reload() {
    startTransition(async () => {
      const res = await fetch("/api/contracts/groups");
      const data = await res.json();
      if (res.ok) setGroups(data.groups || []);
    });
  }

  function createGroup() {
    startTransition(async () => {
      const res = await fetch("/api/contracts/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, sort_order: sortOrder }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Create failed");
        return;
      }
      setName("");
      setMessage("Group created");
      reload();
    });
  }

  function updateGroup(group: ContractGroup, patch: Partial<ContractGroup>) {
    startTransition(async () => {
      const res = await fetch("/api/contracts/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: group.id,
          name: patch.name ?? group.name,
          slug: group.slug,
          sort_order: patch.sort_order ?? group.sort_order,
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

  function removeGroup(id: string) {
    startTransition(async () => {
      const res = await fetch("/api/contracts/groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Delete failed");
        return;
      }
      setMessage("Group removed");
      reload();
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">
          Contracts
        </p>
        <h1 className="mt-1 font-display text-3xl text-ink">Groupings</h1>
        <p className="mt-2 text-ink-soft">
          Organize contracts into buckets like Leases, Employee, and Vendors.
        </p>
      </div>
      {message ? <p className="mb-4 text-sm text-ink-soft">{message}</p> : null}

      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-line bg-white/80 p-4">
        <input
          className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm"
          placeholder="New group name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="number"
          className="w-28 rounded-lg border border-line px-3 py-2 text-sm"
          value={sortOrder}
          onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
        />
        <button
          type="button"
          disabled={pending || !name.trim()}
          onClick={createGroup}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
        >
          Add group
        </button>
      </div>

      <ul className="space-y-2">
        {groups.map((g) => (
          <li
            key={g.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white/80 px-4 py-3"
          >
            <input
              className="min-w-[10rem] flex-1 rounded-lg border border-line px-3 py-1.5 text-sm"
              defaultValue={g.name}
              onBlur={(e) => {
                if (e.target.value.trim() && e.target.value !== g.name) {
                  updateGroup(g, { name: e.target.value.trim() });
                }
              }}
            />
            <span className="text-xs text-ink-soft">{g.slug}</span>
            <input
              type="number"
              className="w-20 rounded-lg border border-line px-2 py-1.5 text-sm"
              defaultValue={g.sort_order}
              onBlur={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next !== g.sort_order) {
                  updateGroup(g, { sort_order: next });
                }
              }}
            />
            <button
              type="button"
              onClick={() => removeGroup(g.id)}
              className="text-sm font-semibold text-fail"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import type { ContractEntity } from "@/lib/contractsDb";

export function CompaniesPanel({
  initialEntities,
}: {
  initialEntities: ContractEntity[];
}) {
  const [entities, setEntities] = useState(initialEntities);
  const [name, setName] = useState("");
  const [sortOrder, setSortOrder] = useState(50);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function reload() {
    startTransition(async () => {
      const res = await fetch("/api/contracts/entities");
      const data = await res.json();
      if (res.ok) setEntities(data.entities || []);
    });
  }

  function createEntity() {
    startTransition(async () => {
      const res = await fetch("/api/contracts/entities", {
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
      setMessage("Company created");
      reload();
    });
  }

  function updateEntity(entity: ContractEntity, patch: Partial<ContractEntity>) {
    startTransition(async () => {
      const res = await fetch("/api/contracts/entities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: entity.id,
          name: patch.name ?? entity.name,
          slug: entity.slug,
          aliases: entity.aliases || [],
          sort_order: patch.sort_order ?? entity.sort_order,
          active: patch.active ?? entity.active,
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

  function removeEntity(id: string) {
    startTransition(async () => {
      const res = await fetch("/api/contracts/entities", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Delete failed");
        return;
      }
      setMessage("Company removed");
      reload();
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">
          Contracts
        </p>
        <h1 className="mt-1 font-display text-3xl text-ink">Our companies</h1>
        <p className="mt-2 text-ink-soft">
          The Relevium-side legal entity on each agreement — ACA Relevium, Andrew
          Hall MD PLLC, Fort Apache Surgery Center, and any others you add.
        </p>
      </div>
      {message ? <p className="mb-4 text-sm text-ink-soft">{message}</p> : null}

      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-line bg-white/80 p-4">
        <input
          className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm"
          placeholder="New company name"
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
          onClick={createEntity}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
        >
          Add company
        </button>
      </div>

      <ul className="space-y-2">
        {entities.map((entity) => (
          <li
            key={`${entity.id}:${(entity.aliases || []).join(",")}`}
            className="space-y-2 rounded-xl border border-line bg-white/80 px-4 py-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <input
                className="min-w-[10rem] flex-1 rounded-lg border border-line px-3 py-1.5 text-sm"
                defaultValue={entity.name}
                onBlur={(e) => {
                  if (e.target.value.trim() && e.target.value !== entity.name) {
                    updateEntity(entity, { name: e.target.value.trim() });
                  }
                }}
              />
              <span className="text-xs text-ink-soft">
                {entity.contract_count || 0} contracts
              </span>
              <button
                type="button"
                onClick={() => removeEntity(entity.id)}
                className="text-sm font-semibold text-fail"
              >
                Delete
              </button>
            </div>
            <input
              className="w-full rounded-lg border border-line px-3 py-1.5 text-sm"
              defaultValue={(entity.aliases || []).join(", ")}
              placeholder="Aliases (FASC, Fort Apache, …) — helps extraction tag this company"
              onBlur={(e) => {
                const aliases = e.target.value
                  .split(",")
                  .map((a) => a.trim())
                  .filter(Boolean);
                const prev = (entity.aliases || []).map((a) => a.trim()).filter(Boolean);
                if (aliases.join("|") !== prev.join("|")) {
                  updateEntity(entity, { aliases });
                }
              }}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Contract, FamilyRole } from "@/lib/contractTypes";
import { FAMILY_ROLES } from "@/lib/contractTypes";
import { familyRoleLabel, formatIsoDate } from "@/lib/contractLabels";

export function ContractFamilyPanel({
  contract,
  initialMembers,
  vendorSiblings,
  familySuggestions = [],
  onContractChange,
}: {
  contract: Contract;
  initialMembers: Contract[];
  vendorSiblings: Contract[];
  familySuggestions?: Contract[];
  onContractChange?: (contract: Contract) => void;
}) {
  const [members, setMembers] = useState(initialMembers);
  const [familyName, setFamilyName] = useState(contract.family_name || "");
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Contract[]>([]);
  const [otherRole, setOtherRole] = useState<FamilyRole>("amendment");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function applyResult(data: {
    contract?: Contract;
    members?: Contract[];
    family?: { name?: string };
  }) {
    if (data.contract) onContractChange?.(data.contract);
    if (data.members) setMembers(data.members);
    if (data.family?.name) setFamilyName(data.family.name);
    if (data.contract?.family_name) setFamilyName(data.contract.family_name);
  }

  function run(body: Record<string, unknown>) {
    startTransition(async () => {
      const res = await fetch(`/api/contracts/${contract.id}/family`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Family update failed");
        return;
      }
      applyResult(data);
      setMessage("Family updated");
      setMatches([]);
      setQuery("");
    });
  }

  function search() {
    startTransition(async () => {
      const params = new URLSearchParams({ q: query });
      const res = await fetch(`/api/contracts/${contract.id}/family?${params}`);
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Search failed");
        return;
      }
      setMatches(data.matches || []);
    });
  }

  const visibleMembers = members.filter((item) => item.id !== contract.id);
  const extracted = (contract.extracted_json || {}) as Record<string, unknown>;
  const relatedHint = String(
    extracted.related_agreement_hint || extracted.related_agreement || ""
  ).trim();
  const hinted = familySuggestions.filter(
    (item) => !members.some((member) => member.id === item.id)
  );
  const suggestions = vendorSiblings.filter(
    (item) =>
      !members.some((member) => member.id === item.id) &&
      !hinted.some((member) => member.id === item.id)
  );

  return (
    <section className="rounded-2xl border border-line bg-white/80 p-4">
      <h2 className="font-semibold text-ink">Related agreements</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Link the original, amendments, assignments, and subleases into one family.
      </p>
      {message ? <p className="mt-2 text-xs text-ink-soft">{message}</p> : null}

      {!contract.family_id && hinted.length ? (
        <div className="mt-3 rounded-xl border border-accent/30 bg-wash px-3 py-3">
          <p className="text-sm font-semibold text-ink">
            {relatedHint
              ? `This looks related to “${relatedHint}”.`
              : "This looks like it belongs with an existing agreement."}
          </p>
          <div className="mt-2 space-y-2">
            {hinted.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
              >
                <div>
                  <div className="text-sm font-semibold text-ink">{item.title}</div>
                  <div className="text-xs text-ink-soft">
                    {item.vendor_name || "No vendor"} ·{" "}
                    {formatIsoDate(item.effective_date)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run({
                      action: "link",
                      other_id: item.id,
                      this_role:
                        contract.family_role && contract.family_role !== "standalone"
                          ? contract.family_role
                          : "amendment",
                      other_role: "original",
                    })
                  }
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-deep"
                >
                  Link
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <label className="mt-3 block text-sm">
        <span className="font-semibold text-ink-soft">This document is</span>
        <select
          className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          value={contract.family_role || "standalone"}
          disabled={pending}
          onChange={(e) => run({ action: "set_role", family_role: e.target.value })}
        >
          {FAMILY_ROLES.map((role) => (
            <option key={role} value={role}>
              {familyRoleLabel(role)}
            </option>
          ))}
        </select>
      </label>

      {contract.family_id ? (
        <div className="mt-3 flex gap-2">
          <input
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            placeholder="Family name"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => run({ action: "rename", name: familyName })}
            className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
          >
            Rename
          </button>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {visibleMembers.length === 0 ? (
          <p className="text-sm text-ink-soft">No related agreements linked yet.</p>
        ) : (
          visibleMembers.map((item) => (
            <Link
              key={item.id}
              href={`/contracts/${item.id}`}
              className="block rounded-xl border border-line/80 px-3 py-2 hover:bg-wash"
            >
              <div className="font-semibold text-ink">{item.title}</div>
              <div className="text-xs text-ink-soft">
                {familyRoleLabel(item.family_role)} · {item.vendor_name || "No vendor"} ·{" "}
                {formatIsoDate(item.effective_date)}
              </div>
            </Link>
          ))
        )}
      </div>

      {contract.family_id ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run({ action: "unlink" })}
          className="mt-3 text-xs font-semibold text-fail hover:underline"
        >
          Remove this agreement from the family
        </button>
      ) : null}

      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-sm font-semibold text-ink-soft">Link another file</p>
        <div className="flex flex-wrap gap-2">
          <input
            className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="Search title or vendor"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                search();
              }
            }}
          />
          <select
            className="rounded-lg border border-line px-3 py-2 text-sm"
            value={otherRole}
            onChange={(e) => setOtherRole(e.target.value as FamilyRole)}
          >
            {FAMILY_ROLES.filter((role) => role !== "standalone").map((role) => (
              <option key={role} value={role}>
                Link as {familyRoleLabel(role)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !query.trim()}
            onClick={search}
            className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
          >
            Search
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {(matches.length ? matches : suggestions).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line/70 px-3 py-2"
            >
              <div>
                <div className="text-sm font-semibold text-ink">{item.title}</div>
                <div className="text-xs text-ink-soft">
                  {item.vendor_name || "No vendor"} · {formatIsoDate(item.effective_date)}
                  {matches.length === 0 ? " · same vendor" : ""}
                </div>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run({
                    action: "link",
                    other_id: item.id,
                    other_role: otherRole,
                    family_name: familyName,
                  })
                }
                className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-deep"
              >
                Link
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

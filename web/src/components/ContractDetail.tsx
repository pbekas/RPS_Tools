"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { AccessAuditEvent } from "@/lib/accessAuditTypes";
import type {
  Contract,
  ContractAssignee,
  ContractEntity,
  ContractGroup,
  ContractObligation,
  Vendor,
} from "@/lib/contractTypes";
import { familyRoleLabel } from "@/lib/contractLabels";
import { ContractAuditPanel } from "@/components/ContractAuditPanel";
import { ContractFamilyPanel } from "@/components/ContractFamilyPanel";
import { ContractObligationsPanel } from "@/components/ContractObligationsPanel";

export function ContractDetail({
  initialContract,
  documentUrl,
  groups,
  vendors,
  entities,
  obligations,
  familyMembers,
  vendorSiblings,
  assignees,
  auditEvents,
}: {
  initialContract: Contract;
  documentUrl: string;
  groups: ContractGroup[];
  vendors: Vendor[];
  entities: ContractEntity[];
  obligations: ContractObligation[];
  familyMembers: Contract[];
  vendorSiblings: Contract[];
  assignees: ContractAssignee[];
  auditEvents: AccessAuditEvent[];
}) {
  const [contract, setContract] = useState(initialContract);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  function field<K extends keyof Contract>(key: K, value: Contract[K]) {
    setContract((prev) => ({ ...prev, [key]: value }));
  }

  function save(extra: Record<string, unknown> = {}) {
    startTransition(async () => {
      const res = await fetch(`/api/contracts/${contract.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: contract.title,
          vendor_id: contract.vendor_id || null,
          entity_id: contract.entity_id || null,
          group_id: contract.group_id || null,
          effective_date: contract.effective_date || null,
          has_defined_term: !!contract.has_defined_term,
          term_end_date: contract.term_end_date || null,
          expiration_date: contract.expiration_date || null,
          notice_period_days: contract.notice_period_days,
          auto_renews: !!contract.auto_renews,
          cost_amount: contract.cost_amount,
          cost_currency: contract.cost_currency || "USD",
          cost_frequency: contract.cost_frequency || "unknown",
          next_payment_date: contract.next_payment_date || null,
          cost_notes: contract.cost_notes || "",
          summary: contract.summary || "",
          status: contract.status,
          ...extra,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Save failed");
        return;
      }
      setContract(data.contract);
      setMessage("Saved");
    });
  }

  function runAction(action: string) {
    startTransition(async () => {
      const res = await fetch(`/api/contracts/${contract.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Action failed");
        return;
      }
      if (data.contract) setContract(data.contract);
      setMessage(action === "reprocess" ? "Queued for re-extraction" : "Accepted");
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/contracts" className="text-sm font-semibold text-accent">
            ← Library
          </Link>
          <h1 className="mt-2 font-display text-3xl text-ink">
            {contract.title || "Contract"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            Status: <span className="font-semibold">{contract.status}</span>
            {contract.extraction_confidence != null
              ? ` · confidence ${(Number(contract.extraction_confidence) * 100).toFixed(0)}%`
              : ""}
            {contract.family_role && contract.family_role !== "standalone"
              ? ` · ${familyRoleLabel(contract.family_role)}`
              : ""}
            {contract.family_name ? ` · ${contract.family_name}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/contracts/${contract.id}/download`}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
          >
            Download PDF
          </a>
          <button
            type="button"
            disabled={pending}
            onClick={() => save()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            Save
          </button>
          {contract.status === "needs_review" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => runAction("accept")}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
            >
              Accept extraction
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => runAction("reprocess")}
            className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
          >
            Re-run Bedrock
          </button>
        </div>
      </div>
      {message ? <p className="mb-4 text-sm text-ink-soft">{message}</p> : null}
      {contract.error_message ? (
        <p className="mb-4 rounded-lg border border-fail/30 bg-fail/5 px-3 py-2 text-sm text-fail">
          {contract.error_message}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="min-h-[70vh] overflow-hidden rounded-2xl border border-line bg-white">
          {documentUrl ? (
            <iframe
              title="Contract document"
              src={documentUrl}
              className="h-[75vh] w-full"
            />
          ) : (
            <div className="flex h-[75vh] items-center justify-center text-ink-soft">
              Document preview unavailable
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-2xl border border-line bg-white/80 p-4">
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Title</span>
            <input
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
              value={contract.title || ""}
              onChange={(e) => field("title", e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Our company</span>
            <select
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
              value={contract.entity_id || ""}
              onChange={(e) => field("entity_id", e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {entities.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Vendor</span>
            <select
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
              value={contract.vendor_id || ""}
              onChange={(e) => field("vendor_id", e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Group</span>
            <select
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
              value={contract.group_id || ""}
              onChange={(e) => field("group_id", e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-semibold text-ink-soft">Effective</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                value={(contract.effective_date || "").slice(0, 10)}
                onChange={(e) => field("effective_date", e.target.value || null)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-ink-soft">Expiration</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                value={(contract.expiration_date || "").slice(0, 10)}
                onChange={(e) => field("expiration_date", e.target.value || null)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-ink-soft">Term end</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                value={(contract.term_end_date || "").slice(0, 10)}
                onChange={(e) => field("term_end_date", e.target.value || null)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-ink-soft">Notice (days)</span>
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                value={contract.notice_period_days ?? ""}
                onChange={(e) =>
                  field(
                    "notice_period_days",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!contract.has_defined_term}
                onChange={(e) => field("has_defined_term", e.target.checked)}
              />
              Defined term
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!contract.auto_renews}
                onChange={(e) => field("auto_renews", e.target.checked)}
              />
              Auto-renews
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm">
              <span className="font-semibold text-ink-soft">Cost amount</span>
              <input
                type="number"
                step="0.01"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                value={contract.cost_amount ?? ""}
                onChange={(e) =>
                  field(
                    "cost_amount",
                    e.target.value === "" ? null : Number(e.target.value)
                  )
                }
              />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-ink-soft">Frequency</span>
              <select
                className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                value={contract.cost_frequency || "unknown"}
                onChange={(e) =>
                  field(
                    "cost_frequency",
                    e.target.value as Contract["cost_frequency"]
                  )
                }
              >
                <option value="unknown">Unknown</option>
                <option value="monthly">Monthly</option>
                <option value="annual">Annual</option>
                <option value="one_time">One-time</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-ink-soft">Next payment</span>
              <input
                type="date"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                value={(contract.next_payment_date || "").slice(0, 10)}
                onChange={(e) => field("next_payment_date", e.target.value || null)}
              />
            </label>
            <label className="block text-sm">
              <span className="font-semibold text-ink-soft">Currency</span>
              <input
                className="mt-1 w-full rounded-lg border border-line px-3 py-2"
                value={contract.cost_currency || "USD"}
                onChange={(e) => field("cost_currency", e.target.value)}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Cost notes</span>
            <textarea
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
              rows={2}
              value={contract.cost_notes || ""}
              onChange={(e) => field("cost_notes", e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-ink-soft">Summary</span>
            <textarea
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
              rows={5}
              value={contract.summary || ""}
              onChange={(e) => field("summary", e.target.value)}
            />
          </label>
          {contract.extracted_json &&
          Object.keys(contract.extracted_json).length > 0 ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-semibold text-ink-soft">
                Raw extraction JSON
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-wash p-3 text-xs">
                {JSON.stringify(contract.extracted_json, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ContractObligationsPanel
          contractId={contract.id}
          initialObligations={obligations}
          assignees={assignees}
          refreshKey={contract.updated_at}
        />
        <div className="space-y-6">
          <ContractFamilyPanel
            contract={contract}
            initialMembers={familyMembers}
            vendorSiblings={vendorSiblings}
            onContractChange={setContract}
          />
          <ContractAuditPanel events={auditEvents} />
        </div>
      </div>
    </div>
  );
}

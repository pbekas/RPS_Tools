"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { Contract, ContractEntity, ContractGroup, Vendor } from "@/lib/contractTypes";
import { familyRoleLabel } from "@/lib/contractLabels";

function statusClass(status: string) {
  switch (status) {
    case "active":
      return "bg-pass/10 text-pass";
    case "needs_review":
      return "bg-warn/10 text-warn";
    case "pending":
    case "processing":
      return "bg-wash text-accent";
    case "error":
    case "expired":
    case "terminated":
      return "bg-fail/10 text-fail";
    default:
      return "bg-wash text-ink-soft";
  }
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return value.slice(0, 10);
}

function stripSnippet(value?: string | null): string {
  if (!value) return "";
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function formatMoney(amount?: number | null, currency = "USD") {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

export function ContractsLibrary({
  initialContracts,
  initialTotal,
  groups,
  vendors,
  entities,
}: {
  initialContracts: Contract[];
  initialTotal: number;
  groups: ContractGroup[];
  vendors: Vendor[];
  entities: ContractEntity[];
}) {
  const [contracts, setContracts] = useState(initialContracts);
  const [total, setTotal] = useState(initialTotal);
  const [q, setQ] = useState("");
  const [groupId, setGroupId] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [entityId, setEntityId] = useState("");
  const [status, setStatus] = useState("");
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const reviewCount = useMemo(
    () => contracts.filter((c) => c.status === "needs_review").length,
    [contracts]
  );

  function reload(next?: {
    q?: string;
    groupId?: string;
    vendorId?: string;
    entityId?: string;
    status?: string;
    expiringSoon?: boolean;
    needsReview?: boolean;
  }) {
    startTransition(async () => {
      const params = new URLSearchParams();
      const query = next?.q ?? q;
      const g = next?.groupId ?? groupId;
      const v = next?.vendorId ?? vendorId;
      const entity = next?.entityId ?? entityId;
      const s = next?.status ?? status;
      const exp = next?.expiringSoon ?? expiringSoon;
      const review = next?.needsReview ?? needsReview;
      if (query) params.set("q", query);
      if (g) params.set("groupId", g);
      if (v) params.set("vendorId", v);
      if (entity) params.set("entityId", entity);
      if (s) params.set("status", s);
      if (exp) params.set("expiringSoon", "1");
      if (review) params.set("needsReview", "1");
      const res = await fetch(`/api/contracts?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Failed to load");
        return;
      }
      setContracts(data.contracts || []);
      setTotal(data.total || 0);
      setMessage("");
    });
  }

  async function acceptAll() {
    startTransition(async () => {
      const acceptRes = await fetch("/api/contracts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "accept_all" }),
      });
      const data = await acceptRes.json();
      if (!acceptRes.ok) {
        setMessage(data.error || "Accept failed");
        return;
      }
      setMessage(`Accepted ${data.count || 0} contract(s)`);
      setNeedsReview(false);
      reload({ needsReview: false });
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">
            Contracts
          </p>
          <h1 className="mt-1 font-display text-3xl text-ink">Contract library</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            All agreements in one place — search the text, filter by company,
            group, vendor, status, or what’s expiring in the next 90 days.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/contracts/upload"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
          >
            Upload contracts
          </Link>
          {reviewCount > 0 || needsReview ? (
            <button
              type="button"
              onClick={acceptAll}
              className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
            >
              Accept all reviewed
            </button>
          ) : null}
        </div>
      </div>

      <form
        className="mb-6 grid gap-3 rounded-2xl border border-line bg-white/70 p-4 sm:grid-cols-2 lg:grid-cols-7"
        onSubmit={(e) => {
          e.preventDefault();
          reload();
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search title, vendor, or contract text"
          className="rounded-lg border border-line px-3 py-2 text-sm lg:col-span-2"
        />
        <select
          value={entityId}
          onChange={(e) => setEntityId(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-sm"
        >
          <option value="">All companies</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.name}
            </option>
          ))}
        </select>
        <select
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-sm"
        >
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <select
          value={vendorId}
          onChange={(e) => setVendorId(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-sm"
        >
          <option value="">All vendors</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-line px-3 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {[
            "pending",
            "processing",
            "needs_review",
            "active",
            "expired",
            "terminated",
            "error",
          ].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div className="flex flex-wrap items-center gap-3 lg:col-span-7">
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={expiringSoon}
              onChange={(e) => setExpiringSoon(e.target.checked)}
            />
            Expiring in 90 days
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={needsReview}
              onChange={(e) => setNeedsReview(e.target.checked)}
            />
            Needs review
          </label>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-60"
          >
            {pending ? "Loading…" : "Apply filters"}
          </button>
          <span className="text-sm text-ink-soft">{total} contracts</span>
          {message ? <span className="text-sm text-warn">{message}</span> : null}
        </div>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white/80">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/60 text-ink-soft">
            <tr>
              <th className="px-4 py-3 font-semibold">Contract</th>
              <th className="px-4 py-3 font-semibold">Our company</th>
              <th className="px-4 py-3 font-semibold">Vendor</th>
              <th className="px-4 py-3 font-semibold">Group</th>
              <th className="px-4 py-3 font-semibold">Effective</th>
              <th className="px-4 py-3 font-semibold">Expires / term</th>
              <th className="px-4 py-3 font-semibold">Cost</th>
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-ink-soft">
                  No contracts yet.{" "}
                  <Link href="/contracts/upload" className="font-semibold text-accent">
                    Upload a folder of PDFs
                  </Link>{" "}
                  to get started.
                </td>
              </tr>
            ) : (
              contracts.map((c) => (
                <tr key={c.id} className="border-b border-line/70 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/contracts/${c.id}`}
                      className="font-semibold text-ink hover:text-accent"
                    >
                      {c.title || c.original_filename || "Untitled"}
                    </Link>
                    <div className="text-xs text-ink-soft">
                      {c.family_role && c.family_role !== "standalone"
                        ? `${familyRoleLabel(c.family_role)} · `
                        : ""}
                      {c.original_filename}
                    </div>
                    {c.search_snippet ? (
                      <div className="mt-1 text-xs text-ink-soft">
                        {stripSnippet(c.search_snippet)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{c.entity_name || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.vendor_name || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">{c.group_name || "—"}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {formatDate(c.effective_date)}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {formatDate(c.expiration_date || c.term_end_date)}
                    {c.notice_period_days != null ? (
                      <div className="text-xs">{c.notice_period_days}d notice</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">
                    {formatMoney(c.cost_amount, c.cost_currency)}
                    {c.cost_frequency && c.cost_frequency !== "unknown" ? (
                      <div className="text-xs">{c.cost_frequency}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${statusClass(
                        c.status
                      )}`}
                    >
                      {c.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

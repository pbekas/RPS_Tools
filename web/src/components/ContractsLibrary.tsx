"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import type { Contract, ContractEntity, ContractGroup, Vendor } from "@/lib/contractTypes";
import { familyRoleLabel } from "@/lib/contractLabels";

export type LibraryFilters = {
  q: string;
  groupId: string;
  vendorId: string;
  entityId: string;
  status: string;
  expiringSoon: boolean;
  needsReview: boolean;
  sort: string;
  dir: "asc" | "desc";
  page: number;
};

const SORTABLE: Array<{ key: string; label: string; className: string }> = [
  { key: "title", label: "Contract", className: "w-[28%]" },
  { key: "entity", label: "Our company", className: "w-[14%]" },
  { key: "vendor", label: "Vendor", className: "w-[16%]" },
  { key: "group", label: "Group", className: "w-[10%]" },
  { key: "effective", label: "Effective", className: "w-[9%]" },
  { key: "expires", label: "Expires / term", className: "w-[10%]" },
  { key: "cost", label: "Cost", className: "w-[8%]" },
  { key: "status", label: "Status", className: "w-[8%]" },
];

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
  initialFilters,
  pageSize,
  groups,
  vendors,
  entities,
}: {
  initialContracts: Contract[];
  initialTotal: number;
  initialFilters: LibraryFilters;
  pageSize: number;
  groups: ContractGroup[];
  vendors: Vendor[];
  entities: ContractEntity[];
}) {
  const router = useRouter();
  const [contracts, setContracts] = useState(initialContracts);
  const [total, setTotal] = useState(initialTotal);
  const [q, setQ] = useState(initialFilters.q);
  const [groupId, setGroupId] = useState(initialFilters.groupId);
  const [vendorId, setVendorId] = useState(initialFilters.vendorId);
  const [entityId, setEntityId] = useState(initialFilters.entityId);
  const [status, setStatus] = useState(initialFilters.status);
  const [expiringSoon, setExpiringSoon] = useState(initialFilters.expiringSoon);
  const [needsReview, setNeedsReview] = useState(initialFilters.needsReview);
  const [sort, setSort] = useState(initialFilters.sort);
  const [dir, setDir] = useState<"asc" | "desc">(initialFilters.dir);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setContracts(initialContracts);
    setTotal(initialTotal);
    setQ(initialFilters.q);
    setGroupId(initialFilters.groupId);
    setVendorId(initialFilters.vendorId);
    setEntityId(initialFilters.entityId);
    setStatus(initialFilters.status);
    setExpiringSoon(initialFilters.expiringSoon);
    setNeedsReview(initialFilters.needsReview);
    setSort(initialFilters.sort);
    setDir(initialFilters.dir);
  }, [initialContracts, initialTotal, initialFilters]);

  const reviewCount = useMemo(
    () => contracts.filter((c) => c.status === "needs_review").length,
    [contracts]
  );
  const page = Math.max(1, initialFilters.page || 1);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  function hrefFor(next: Partial<LibraryFilters>) {
    const params = new URLSearchParams();
    const query = next.q ?? q;
    const g = next.groupId ?? groupId;
    const v = next.vendorId ?? vendorId;
    const entity = next.entityId ?? entityId;
    const s = next.status ?? status;
    const exp = next.expiringSoon ?? expiringSoon;
    const review = next.needsReview ?? needsReview;
    const nextSort = next.sort ?? sort;
    const nextDir = next.dir ?? dir;
    const nextPage = next.page ?? 1;
    if (query) params.set("q", query);
    if (g) params.set("groupId", g);
    if (v) params.set("vendorId", v);
    if (entity) params.set("entityId", entity);
    if (s) params.set("status", s);
    if (exp) params.set("expiringSoon", "1");
    if (review) params.set("needsReview", "1");
    if (nextSort) {
      params.set("sort", nextSort);
      params.set("dir", nextDir);
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/contracts?${qs}` : "/contracts";
  }

  function navigate(next: Partial<LibraryFilters>) {
    startTransition(() => {
      router.push(hrefFor(next));
    });
  }

  function toggleSort(key: string) {
    if (sort === key) {
      navigate({ sort: key, dir: dir === "asc" ? "desc" : "asc", page: 1 });
      return;
    }
    navigate({
      sort: key,
      dir: key === "title" || key === "entity" || key === "vendor" || key === "group" ? "asc" : "desc",
      page: 1,
    });
  }

  function removeAgreement(contract: Contract) {
    const label = contract.title || contract.original_filename || "this agreement";
    if (!window.confirm(`Delete “${label}”? It will leave the library. This can’t be undone.`)) {
      return;
    }
    startTransition(async () => {
      const res = await fetch(`/api/contracts/${contract.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || "Could not delete agreement");
        return;
      }
      setMessage("Agreement deleted");
      router.refresh();
    });
  }

  function acceptAll() {
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
      router.push(hrefFor({ needsReview: false, page: 1 }));
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
          navigate({ page: 1 });
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
          <span className="text-sm text-ink-soft">
            {total ? `${from}–${to} of ${total}` : "0 contracts"}
          </span>
          {message ? <span className="text-sm text-warn">{message}</span> : null}
        </div>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-line bg-white/80">
        <table className="min-w-full table-fixed text-left text-sm">
          <thead className="border-b border-line bg-wash/60 text-ink-soft">
            <tr>
              {SORTABLE.map((col) => {
                const active = sort === col.key;
                const arrow = !active ? "↕" : dir === "asc" ? "↑" : "↓";
                return (
                  <th key={col.key} className={`${col.className} px-3 py-2 font-semibold`}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={`inline-flex items-center gap-1 hover:text-ink ${
                        active ? "text-ink" : ""
                      }`}
                    >
                      {col.label}
                      <span className="text-[10px] font-semibold">{arrow}</span>
                    </button>
                  </th>
                );
              })}
              <th className="px-3 py-2 font-semibold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-ink-soft">
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
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/contracts/${c.id}`}
                      className="block truncate text-sm font-semibold leading-tight text-ink hover:text-accent"
                    >
                      {c.title || c.original_filename || "Untitled"}
                    </Link>
                    {c.family_role && c.family_role !== "standalone" ? (
                      <div className="truncate text-[11px] text-ink-soft">
                        {familyRoleLabel(c.family_role)}
                      </div>
                    ) : null}
                    {c.search_snippet ? (
                      <div className="mt-0.5 truncate text-[11px] text-ink-soft">
                        {stripSnippet(c.search_snippet)}
                      </div>
                    ) : null}
                  </td>
                  <td className="truncate px-3 py-1.5 text-sm text-ink">
                    {c.entity_name || "—"}
                  </td>
                  <td className="truncate px-3 py-1.5 text-sm text-ink">
                    {c.vendor_name || "—"}
                  </td>
                  <td className="truncate px-3 py-1.5 text-sm text-ink">
                    {c.group_name || "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-sm text-ink-soft">
                    {formatDate(c.effective_date)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-sm text-ink-soft">
                    {formatDate(c.expiration_date || c.term_end_date)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-sm text-ink-soft">
                    {formatMoney(c.cost_amount, c.cost_currency)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${statusClass(
                        c.status
                      )}`}
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => removeAgreement(c)}
                      className="text-[11px] font-semibold text-fail hover:underline disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            disabled={pending || page <= 1}
            onClick={() => navigate({ page: page - 1 })}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-60"
          >
            Previous
          </button>
          <span className="text-sm text-ink-soft">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            disabled={pending || page >= pageCount}
            onClick={() => navigate({ page: page + 1 })}
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-60"
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  );
}

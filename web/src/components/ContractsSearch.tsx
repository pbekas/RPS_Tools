"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { Contract, Vendor } from "@/lib/contractTypes";

type Props = {
  canViewAgreements: boolean;
  canOpenVendors: boolean;
};

export function ContractsSearch({ canViewAgreements, canOpenVendors }: Props) {
  const router = useRouter();
  const boxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [contractTotal, setContractTotal] = useState(0);

  useEffect(() => {
    const needle = q.trim();
    if (needle.length < 2) {
      setContracts([]);
      setVendors([]);
      setContractTotal(0);
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/contracts/search?q=${encodeURIComponent(needle)}`
        );
        const data = await res.json();
        if (!res.ok) return;
        setContracts(data.contracts || []);
        setVendors(data.vendors || []);
        setContractTotal(Number(data.contractTotal || 0));
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        const input = rootRef.current?.querySelector("input");
        input?.focus();
        setOpen(true);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function goLibrary(event?: React.FormEvent) {
    event?.preventDefault();
    const needle = q.trim();
    if (!needle) return;
    if (canViewAgreements) {
      router.push(`/contracts?q=${encodeURIComponent(needle)}`);
    } else if (canOpenVendors) {
      router.push(`/contracts/vendors?q=${encodeURIComponent(needle)}`);
    }
    setOpen(false);
  }

  const hasResults = contracts.length > 0 || vendors.length > 0;
  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative min-w-[12rem] max-w-sm flex-1">
      <form onSubmit={goLibrary}>
        <label htmlFor={boxId} className="sr-only">
          Search contracts
        </label>
        <input
          id={boxId}
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          placeholder="Search contracts…"
          className="w-full rounded-lg border border-line bg-white px-3 py-1.5 text-sm text-ink placeholder:text-ink-soft"
        />
      </form>
      {showPanel ? (
        <div className="absolute right-0 z-30 mt-1 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-line bg-white shadow-soft">
          {loading && !hasResults ? (
            <p className="px-3 py-3 text-sm text-ink-soft">Searching…</p>
          ) : !hasResults ? (
            <p className="px-3 py-3 text-sm text-ink-soft">No matches</p>
          ) : (
            <div className="max-h-[70vh] overflow-y-auto py-1">
              {vendors.length ? (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    Vendors
                  </p>
                  {vendors.map((vendor) => (
                    <Link
                      key={vendor.id}
                      href={`/contracts/vendors?id=${vendor.id}`}
                      onClick={() => setOpen(false)}
                      className="block px-3 py-2 hover:bg-wash"
                    >
                      <div className="text-sm font-semibold text-ink">{vendor.name}</div>
                      <div className="text-xs text-ink-soft">
                        {vendor.contract_count || 0} contracts ·{" "}
                        {vendor.contact_count || 0} contacts
                      </div>
                    </Link>
                  ))}
                </div>
              ) : null}
              {contracts.length ? (
                <div>
                  <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                    Agreements
                  </p>
                  {contracts.map((contract) => (
                    <Link
                      key={contract.id}
                      href={`/contracts/${contract.id}`}
                      onClick={() => setOpen(false)}
                      className="block px-3 py-2 hover:bg-wash"
                    >
                      <div className="text-sm font-semibold text-ink">
                        {contract.title || contract.original_filename || "Untitled"}
                      </div>
                      <div className="text-xs text-ink-soft">
                        {[contract.vendor_name, contract.entity_name, contract.status]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </Link>
                  ))}
                  {canViewAgreements && contractTotal > contracts.length ? (
                    <button
                      type="button"
                      onClick={() => goLibrary()}
                      className="w-full px-3 py-2 text-left text-xs font-semibold text-accent hover:bg-wash"
                    >
                      See all {contractTotal} in library
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

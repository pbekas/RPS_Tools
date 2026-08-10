"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  Contract,
  Vendor,
  VendorContact,
  VendorDocKind,
  VendorDocument,
} from "@/lib/contractTypes";
import { VENDOR_DOC_KINDS } from "@/lib/contractTypes";

const KIND_LABELS: Record<VendorDocKind, string> = {
  w9: "W-9",
  coi: "COI",
  insurance: "Insurance",
  other: "Other",
};

type VendorAccess = {
  canViewVendorContacts: boolean;
  canManageVendorFiles: boolean;
  canViewAgreements: boolean;
};

export function VendorsPanel({
  initialVendors,
  initialSelectedId,
  initialQuery = "",
  access,
}: {
  initialVendors: Vendor[];
  initialSelectedId?: string;
  initialQuery?: string;
  access: VendorAccess;
}) {
  const [vendors, setVendors] = useState(initialVendors);
  const [listQuery, setListQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Vendor | null>(null);
  const [contacts, setContacts] = useState<VendorContact[]>([]);
  const [documents, setDocuments] = useState<VendorDocument[]>([]);
  const [agreements, setAgreements] = useState<Contract[]>([]);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [addingPerson, setAddingPerson] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    phone: "",
    title: "",
    is_primary: false,
  });
  const [docKind, setDocKind] = useState<VendorDocKind>("w9");
  const [absorbId, setAbsorbId] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const visibleVendors = useMemo(() => {
    const needle = listQuery.trim().toLowerCase();
    if (!needle) return vendors;
    return vendors.filter((v) => v.name.toLowerCase().includes(needle));
  }, [vendors, listQuery]);

  useEffect(() => {
    if (initialSelectedId) loadVendor(initialSelectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open deep link once
  }, [initialSelectedId]);

  function refreshVendors() {
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors?all=1");
      const data = await res.json();
      if (res.ok) setVendors(data.vendors || []);
    });
  }

  function loadVendor(id: string) {
    startTransition(async () => {
      const res = await fetch(`/api/contracts/vendors?id=${id}`);
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Failed to load vendor");
        return;
      }
      setSelected(data.vendor);
      setName(data.vendor.name || "");
      setNotes(data.vendor.notes || "");
      setContacts(data.contacts || []);
      setDocuments(data.documents || []);
      setAgreements(data.contracts || []);
      setAddingPerson(false);
      setMessage("");
    });
  }

  function saveVendor(create = false) {
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert_vendor",
          id: create ? undefined : selected?.id,
          name,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Save failed");
        return;
      }
      setSelected(data.vendor);
      setMessage("Saved");
      refreshVendors();
      if (data.vendor?.id) loadVendor(data.vendor.id);
    });
  }

  function startCreate() {
    setSelected(null);
    setContacts([]);
    setDocuments([]);
    setAgreements([]);
    setName("");
    setNotes("");
    setAddingPerson(false);
  }

  function vendorIsEmpty(vendor: Vendor) {
    return (
      !(vendor.contract_count || 0) &&
      !(vendor.contact_count || 0) &&
      !(vendor.document_count || 0)
    );
  }

  function mergeIntoSelected() {
    if (!selected?.id || !absorbId) return;
    const other = vendors.find((v) => v.id === absorbId);
    if (
      !window.confirm(
        `Merge “${other?.name || "that vendor"}” into “${selected.name}”? Contacts, files, and agreements move here. The other vendor is removed.`
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "merge_vendor",
          keep_id: selected.id,
          absorb_id: absorbId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Merge failed");
        return;
      }
      setAbsorbId("");
      setMessage("Vendors merged");
      refreshVendors();
      if (data.vendor?.id) loadVendor(data.vendor.id);
    });
  }

  function removeVendor() {
    if (!selected?.id) return;
    if (!vendorIsEmpty(selected)) {
      setMessage("Remove contacts, files, and agreements before deleting.");
      return;
    }
    if (!window.confirm(`Delete ${selected.name}? This can’t be undone.`)) return;
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_vendor", id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Could not delete vendor");
        return;
      }
      setSelected(null);
      setContacts([]);
      setDocuments([]);
      setAgreements([]);
      setName("");
      setNotes("");
      setMessage("Vendor deleted");
      refreshVendors();
    });
  }

  function saveContact() {
    if (!selected?.id) return;
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert_contact",
          vendor_id: selected.id,
          ...contactForm,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Could not add person");
        return;
      }
      setContactForm({
        name: "",
        email: "",
        phone: "",
        title: "",
        is_primary: false,
      });
      setAddingPerson(false);
      loadVendor(selected.id);
    });
  }

  function deleteContact(id: string) {
    if (!selected?.id) return;
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_contact", id }),
      });
      if (res.ok) loadVendor(selected.id);
    });
  }

  function uploadFile(file: File) {
    if (!selected?.id) return;
    startTransition(async () => {
      const form = new FormData();
      form.set("vendor_id", selected.id);
      form.set("doc_kind", docKind);
      form.set("file", file);
      const res = await fetch("/api/contracts/vendors/documents", {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Upload failed");
        return;
      }
      loadVendor(selected.id);
    });
  }

  function deleteDocument(id: string) {
    if (!selected?.id) return;
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      if (res.ok) loadVendor(selected.id);
    });
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-accent">
            Contracts
          </p>
          <h1 className="mt-1 font-display text-3xl text-ink">Vendors</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            One profile per counterparty — people, W-9s, and the agreements they
            belong to.
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
        >
          New vendor
        </button>
      </div>
      {message ? <p className="mb-4 text-sm text-ink-soft">{message}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.2fr]">
        <div className="rounded-2xl border border-line bg-white/80">
          <div className="border-b border-line p-3">
            <input
              type="search"
              value={listQuery}
              onChange={(e) => setListQuery(e.target.value)}
              placeholder="Filter vendors…"
              className="w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </div>
          <ul className="divide-y divide-line">
            {visibleVendors.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => loadVendor(v.id)}
                  className={`block w-full px-4 py-3 text-left hover:bg-wash ${
                    selected?.id === v.id ? "bg-wash" : ""
                  }`}
                >
                  <div className="font-semibold text-ink">{v.name}</div>
                  <div className="text-xs text-ink-soft">
                    {access.canViewAgreements
                      ? `${v.contract_count || 0} contracts · `
                      : ""}
                    {access.canViewVendorContacts
                      ? `${v.contact_count || 0} contacts`
                      : ""}
                    {access.canViewVendorContacts && access.canManageVendorFiles
                      ? " · "
                      : ""}
                    {access.canManageVendorFiles
                      ? `${v.document_count || 0} files`
                      : ""}
                    {!access.canViewAgreements &&
                    !access.canViewVendorContacts &&
                    !access.canManageVendorFiles
                      ? "Vendor"
                      : ""}
                  </div>
                </button>
              </li>
            ))}
            {!visibleVendors.length ? (
              <li className="px-4 py-8 text-center text-sm text-ink-soft">
                {vendors.length ? "No vendors match that search." : "No vendors yet."}
              </li>
            ) : null}
          </ul>
        </div>

        <div className="rounded-2xl border border-line bg-white/80 p-5">
          {!selected ? (
            <div className="space-y-3">
              <h2 className="font-display text-xl text-ink">New vendor</h2>
              <input
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Vendor name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <textarea
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Notes (optional)"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
              <button
                type="button"
                disabled={pending || !name.trim()}
                onClick={() => saveVendor(true)}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
              >
                Create vendor
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="font-semibold text-ink-soft">Vendor name</span>
                  <input
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="font-semibold text-ink-soft">Notes</span>
                  <textarea
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"
                    placeholder="Add notes…"
                    rows={3}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  disabled={pending || !name.trim()}
                  onClick={() => saveVendor()}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
                >
                  Save vendor
                </button>
              </div>

              {access.canViewVendorContacts ? (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-semibold text-ink">People</h3>
                    <button
                      type="button"
                      onClick={() => setAddingPerson((v) => !v)}
                      className="text-sm font-semibold text-accent"
                    >
                      {addingPerson ? "Cancel" : "Add person"}
                    </button>
                  </div>
                  <ul className="space-y-2">
                    {contacts.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-start justify-between gap-3 rounded-xl bg-wash/60 px-3 py-2 text-sm"
                      >
                        <div>
                          <div className="font-semibold text-ink">
                            {c.name}
                            {c.is_primary ? (
                              <span className="ml-2 text-xs font-semibold text-accent">
                                primary
                              </span>
                            ) : null}
                          </div>
                          <div className="text-ink-soft">
                            {[c.title, c.email, c.phone].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteContact(c.id)}
                          className="text-xs font-semibold text-fail"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                    {!contacts.length && !addingPerson ? (
                      <li className="text-sm text-ink-soft">No people listed yet.</li>
                    ) : null}
                  </ul>
                  {addingPerson ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-lg border border-line px-3 py-2 text-sm"
                        placeholder="Name"
                        value={contactForm.name}
                        onChange={(e) =>
                          setContactForm((prev) => ({ ...prev, name: e.target.value }))
                        }
                      />
                      <input
                        className="rounded-lg border border-line px-3 py-2 text-sm"
                        placeholder="Title"
                        value={contactForm.title}
                        onChange={(e) =>
                          setContactForm((prev) => ({ ...prev, title: e.target.value }))
                        }
                      />
                      <input
                        className="rounded-lg border border-line px-3 py-2 text-sm"
                        placeholder="Email"
                        value={contactForm.email}
                        onChange={(e) =>
                          setContactForm((prev) => ({ ...prev, email: e.target.value }))
                        }
                      />
                      <input
                        className="rounded-lg border border-line px-3 py-2 text-sm"
                        placeholder="Phone"
                        value={contactForm.phone}
                        onChange={(e) =>
                          setContactForm((prev) => ({ ...prev, phone: e.target.value }))
                        }
                      />
                      <label className="flex items-center gap-2 text-sm text-ink-soft sm:col-span-2">
                        <input
                          type="checkbox"
                          checked={contactForm.is_primary}
                          onChange={(e) =>
                            setContactForm((prev) => ({
                              ...prev,
                              is_primary: e.target.checked,
                            }))
                          }
                        />
                        Primary contact
                      </label>
                      <button
                        type="button"
                        disabled={pending || !contactForm.name.trim()}
                        onClick={saveContact}
                        className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
                      >
                        Save person
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {access.canManageVendorFiles ? (
                <section>
                  <h3 className="mb-3 font-semibold text-ink">Files</h3>
                  <ul className="mb-3 space-y-2">
                    {documents.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-3 rounded-xl bg-wash/60 px-3 py-2 text-sm"
                      >
                        <div>
                          <a
                            href={`/api/contracts/vendors/documents/${doc.id}/download`}
                            className="font-semibold text-ink hover:text-accent"
                          >
                            {doc.title || doc.original_filename}
                          </a>
                          <div className="text-xs text-ink-soft">
                            {KIND_LABELS[doc.doc_kind] || doc.doc_kind}
                            {doc.original_filename ? ` · ${doc.original_filename}` : ""}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteDocument(doc.id)}
                          className="text-xs font-semibold text-fail"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                    {!documents.length ? (
                      <li className="text-sm text-ink-soft">
                        No W-9s or other files yet.
                      </li>
                    ) : null}
                  </ul>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="rounded-lg border border-line px-3 py-2 text-sm"
                      value={docKind}
                      onChange={(e) => setDocKind(e.target.value as VendorDocKind)}
                    >
                      {VENDOR_DOC_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                    <label className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash">
                      Upload file
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) uploadFile(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </div>
                </section>
              ) : null}

              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold text-ink">Agreements</h3>
                  {access.canViewAgreements ? (
                    <Link
                      href={`/contracts?vendorId=${selected.id}`}
                      className="text-sm font-semibold text-accent"
                    >
                      View in library
                    </Link>
                  ) : null}
                </div>
                {!access.canViewAgreements ? (
                  <p className="text-sm text-ink-soft">
                    You can see this vendor’s directory, but not agreement details.
                  </p>
                ) : agreements.length ? (
                  <ul className="space-y-2">
                    {agreements.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/contracts/${c.id}`}
                          className="block rounded-xl bg-wash/60 px-3 py-2 hover:bg-wash"
                        >
                          <div className="font-semibold text-ink">{c.title}</div>
                          <div className="text-xs text-ink-soft">
                            {c.group_name || "Ungrouped"} · {c.status}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-soft">No agreements linked yet.</p>
                )}
              </section>

              <div className="border-t border-line pt-4 space-y-3">
                <div>
                  <p className="mb-2 text-sm font-semibold text-ink">Merge duplicate</p>
                  <div className="flex flex-wrap gap-2">
                    <select
                      className="min-w-[12rem] flex-1 rounded-lg border border-line px-3 py-2 text-sm"
                      value={absorbId}
                      onChange={(e) => setAbsorbId(e.target.value)}
                    >
                      <option value="">Select vendor to absorb…</option>
                      {vendors
                        .filter((v) => v.id !== selected.id)
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={pending || !absorbId}
                      onClick={mergeIntoSelected}
                      className="rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-60"
                    >
                      Merge into this vendor
                    </button>
                  </div>
                </div>
                {vendorIsEmpty(selected) ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={removeVendor}
                    className="text-sm font-semibold text-fail hover:underline disabled:opacity-60"
                  >
                    Delete vendor
                  </button>
                ) : (
                  <p className="text-xs text-ink-soft">
                    Delete is available after contacts, files, and agreements are
                    removed.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

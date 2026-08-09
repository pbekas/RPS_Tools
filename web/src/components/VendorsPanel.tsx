"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { Vendor, VendorContact } from "@/lib/contractsDb";

export function VendorsPanel({
  initialVendors,
  initialVendor,
  initialContacts,
}: {
  initialVendors: Vendor[];
  initialVendor?: Vendor | null;
  initialContacts?: VendorContact[];
}) {
  const [vendors, setVendors] = useState(initialVendors);
  const [selected, setSelected] = useState<Vendor | null>(initialVendor || null);
  const [contacts, setContacts] = useState<VendorContact[]>(initialContacts || []);
  const [vendorForm, setVendorForm] = useState({
    name: "",
    notes: "",
  });
  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    phone: "",
    title: "",
    is_primary: false,
  });
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

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
      setContacts(data.contacts || []);
      setVendorForm({
        name: data.vendor.name || "",
        notes: data.vendor.notes || "",
      });
      setMessage("");
    });
  }

  function saveVendor() {
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "upsert_vendor",
          id: selected?.id,
          name: vendorForm.name,
          notes: vendorForm.notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Save failed");
        return;
      }
      setSelected(data.vendor);
      setMessage("Vendor saved");
      refreshVendors();
    });
  }

  function createVendor() {
    setSelected(null);
    setContacts([]);
    setVendorForm({ name: "", notes: "" });
  }

  function saveContact() {
    if (!selected?.id) {
      setMessage("Save the vendor first");
      return;
    }
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
        setMessage(data.error || "Contact save failed");
        return;
      }
      setContactForm({
        name: "",
        email: "",
        phone: "",
        title: "",
        is_primary: false,
      });
      loadVendor(selected.id);
      setMessage("Contact added");
    });
  }

  function deleteContact(id: string) {
    startTransition(async () => {
      const res = await fetch("/api/contracts/vendors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete_contact", id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || "Delete failed");
        return;
      }
      if (selected?.id) loadVendor(selected.id);
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
          <p className="mt-2 text-ink-soft">
            Counterparties and their contacts, linked to contracts.
          </p>
        </div>
        <button
          type="button"
          onClick={createVendor}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
        >
          New vendor
        </button>
      </div>
      {message ? <p className="mb-4 text-sm text-ink-soft">{message}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-line bg-white/80">
          <ul className="divide-y divide-line">
            {vendors.map((v) => (
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
                    {v.contract_count || 0} contracts · {v.contact_count || 0} contacts
                  </div>
                </button>
              </li>
            ))}
            {!vendors.length ? (
              <li className="px-4 py-8 text-center text-sm text-ink-soft">
                No vendors yet.
              </li>
            ) : null}
          </ul>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-line bg-white/80 p-4">
            <h2 className="font-display text-xl text-ink">
              {selected ? "Edit vendor" : "Create vendor"}
            </h2>
            <div className="mt-4 space-y-3">
              <input
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Vendor name"
                value={vendorForm.name}
                onChange={(e) =>
                  setVendorForm((prev) => ({ ...prev, name: e.target.value }))
                }
              />
              <textarea
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Notes"
                rows={3}
                value={vendorForm.notes}
                onChange={(e) =>
                  setVendorForm((prev) => ({ ...prev, notes: e.target.value }))
                }
              />
              <button
                type="button"
                disabled={pending}
                onClick={saveVendor}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
              >
                Save vendor
              </button>
              {selected ? (
                <Link
                  href={`/contracts?vendorId=${selected.id}`}
                  className="ml-3 text-sm font-semibold text-accent"
                >
                  View contracts
                </Link>
              ) : null}
            </div>
          </div>

          {selected ? (
            <div className="rounded-2xl border border-line bg-white/80 p-4">
              <h2 className="font-display text-xl text-ink">Contacts</h2>
              <ul className="mt-3 space-y-2">
                {contacts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-semibold text-ink">
                        {c.name}
                        {c.is_primary ? (
                          <span className="ml-2 text-xs text-accent">primary</span>
                        ) : null}
                      </div>
                      <div className="text-ink-soft">
                        {[c.title, c.email, c.phone].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteContact(c.id)}
                      className="text-fail"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
              </div>
              <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
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
                disabled={pending}
                onClick={saveContact}
                className="mt-3 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-60"
              >
                Add contact
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

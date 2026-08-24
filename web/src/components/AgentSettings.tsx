"use client";

import { useEffect, useMemo, useState } from "react";
import type { UserDoc } from "@/lib/database";
import type { ContractGroup } from "@/lib/contractTypes";
import {
  buildModuleGrants,
  parseContractGrantState,
  type AccessGrantCaps,
} from "@/lib/contractAccess";
import {
  TOOLSETS,
  normalizeModuleGrants,
  normalizeToolsetGrants,
  type ToolsetId,
} from "@/lib/permissions";
import { TimeClockTeamsPanel } from "@/components/TimeClockTeamsPanel";

type Props = {
  initialUsers: UserDoc[];
  domain: string;
  embedded?: boolean;
  contractGroups?: ContractGroup[];
  teamsEnabled?: boolean;
  grantCaps?: AccessGrantCaps;
};

function toolsetsForUser(user: UserDoc): ToolsetId[] {
  const grants = normalizeToolsetGrants(user.modules || []);
  return grants.length ? grants : ["call_qa"];
}

export function AgentSettings({
  initialUsers,
  domain,
  embedded = false,
  contractGroups = [],
  teamsEnabled = false,
  grantCaps,
}: Props) {
  const caps: AccessGrantCaps = grantCaps || {
    toolsets: [],
    allContractTypes: false,
    contractGroupSlugs: [],
    vendorContacts: false,
    vendorFiles: false,
  };
  const grantableToolsets = caps.toolsets;
  const visibleGroups = caps.allContractTypes
    ? contractGroups
    : contractGroups.filter((g) => caps.contractGroupSlugs.includes(g.slug));
  const canGrantContracts =
    grantableToolsets.includes("contracts") ||
    caps.vendorContacts ||
    caps.vendorFiles;
  const defaultToolsets: ToolsetId[] = grantableToolsets.includes("call_qa")
    ? ["call_qa"]
    : grantableToolsets[0]
      ? [grantableToolsets[0]]
      : [];

  const [users, setUsers] = useState(initialUsers);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [extension, setExtension] = useState("");
  const [role, setRole] = useState("Agent");
  const [toolsets, setToolsets] = useState<ToolsetId[]>(defaultToolsets);
  const [allContractTypes, setAllContractTypes] = useState(true);
  const [groupSlugs, setGroupSlugs] = useState<string[]>(
    contractGroups.map((g) => g.slug)
  );
  const [vendorContacts, setVendorContacts] = useState(true);
  const [vendorFiles, setVendorFiles] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [emailLocked, setEmailLocked] = useState(false);

  function resetForm() {
    setName("");
    setEmail("");
    setExtension("");
    setRole("Agent");
    setToolsets(defaultToolsets);
    setAllContractTypes(false);
    setGroupSlugs([]);
    setVendorContacts(false);
    setVendorFiles(false);
    setEmailLocked(false);
  }

  function closeForm() {
    setFormOpen(false);
    resetForm();
  }

  useEffect(() => {
    if (!formOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) closeForm();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [formOpen, saving]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      const addr = (u.email || "").toLowerCase();
      if (u.provisional || addr.startsWith("unmapped.")) return false;
      if (!needle) return true;
      return (
        (u.name || "").toLowerCase().includes(needle) ||
        addr.includes(needle) ||
        (u.extension || "").toLowerCase().includes(needle) ||
        (u.role || "").toLowerCase().includes(needle)
      );
    });
  }, [users, q]);

  async function refresh() {
    const res = await fetch("/api/users?unmapped=0");
    const data = await res.json();
    if (res.ok) {
      setUsers(data.users || []);
    }
  }

  function toggleFormToolset(id: ToolsetId) {
    if (!grantableToolsets.includes(id)) return;
    setToolsets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function saveUser(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          name,
          email,
          role,
          extension: extension.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      const modules = buildModuleGrants({
        toolsets: toolsets.filter((id) => grantableToolsets.includes(id)),
        allContractTypes: caps.allContractTypes && allContractTypes,
        groupSlugs,
        knownGroupSlugs: visibleGroups.map((g) => g.slug),
        vendorContacts: caps.vendorContacts && vendorContacts,
        vendorFiles: caps.vendorFiles && vendorFiles,
      });
      const modRes = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_modules", email, modules }),
      });
      const modData = await modRes.json();
      if (!modRes.ok) throw new Error(modData.error || "Access save failed");
      const remapped =
        typeof data.remappedCalls === "number" && data.remappedCalls > 0
          ? ` · remapped ${data.remappedCalls} call${data.remappedCalls === 1 ? "" : "s"} by extension`
          : "";
      setMsg(`Saved ${data.user.email}${remapped}`);
      closeForm();
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: UserDoc) {
    setMsg("");
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "set_active",
        email: user.email,
        active: !(user.active !== false),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Update failed");
      return;
    }
    await refresh();
  }

  function openAdd() {
    setMsg("");
    resetForm();
    setFormOpen(true);
  }

  function editUser(user: UserDoc) {
    setMsg("");
    setName(user.name || "");
    setEmail(user.email);
    setExtension(user.extension || "");
    setRole(user.role || "Agent");
    const parsed = parseContractGrantState(user, visibleGroups);
    setToolsets(parsed.toolsets.filter((id) => grantableToolsets.includes(id)));
    setAllContractTypes(Boolean(caps.allContractTypes && parsed.allContractTypes));
    setGroupSlugs(
      parsed.groupSlugs.filter((slug) =>
        visibleGroups.some((g) => g.slug === slug)
      )
    );
    setVendorContacts(Boolean(caps.vendorContacts && parsed.vendorContacts));
    setVendorFiles(Boolean(caps.vendorFiles && parsed.vendorFiles));
    setEmailLocked(true);
    setFormOpen(true);
  }

  async function setUserToolsets(user: UserDoc, next: ToolsetId[]) {
    const allowed = new Set(grantableToolsets);
    const requested = normalizeToolsetGrants(next).filter((id) => allowed.has(id));
    setMsg("");
    const existingExtras = (user.modules || []).filter((m) =>
      String(m).startsWith("contracts:")
    );
    const modules = requested.includes("contracts")
      ? normalizeModuleGrants([...requested, ...existingExtras])
      : requested;
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_modules", email: user.email, modules }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || "Access update failed");
      return;
    }
    await refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {!embedded ? (
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Access
          </p>
          <h1 className="mt-1 font-display text-4xl text-ink">Users & access</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Directory people only — search, edit access, and assign departments.
            Call recordings no longer create users.
          </p>
        </div>
      ) : (
        <div className="mb-8">
          <h2 className="font-display text-2xl text-ink">Users & access</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Grant only the tool sets you have. Other people’s access you don’t
            share stays unchanged.
          </p>
        </div>
      )}

      {msg ? (
        <p className="mb-4 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          {msg}
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-ink">People</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="rounded-xl border border-line bg-white px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={openAdd}
            className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep"
          >
            Add person
          </button>
        </div>
      </div>

      <div className="mb-8 overflow-hidden rounded-2xl border border-line bg-white/80 shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Ext</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Tool sets</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink-soft">
                  No people in the directory yet.
                </td>
              </tr>
            ) : (
              filtered.map((u) => {
                const active = u.active !== false;
                const granted = toolsetsForUser(u);
                return (
                  <tr key={u.email} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-3 font-semibold text-ink">
                      {u.name || "—"}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{u.email}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-soft">
                      {u.extension || "—"}
                    </td>
                    <td className="px-4 py-3">{u.role || "Agent"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {grantableToolsets.length ? (
                          grantableToolsets.map((id) => {
                          const on = granted.includes(id);
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                const grantable = granted.filter((x) =>
                                  grantableToolsets.includes(x)
                                );
                                const next = on
                                  ? grantable.filter((x) => x !== id)
                                  : [...grantable, id];
                                void setUserToolsets(u, next);
                              }}
                              className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                                on
                                  ? "bg-wash text-accent"
                                  : "bg-paper text-ink-soft"
                              }`}
                              title={
                                on
                                  ? `Revoke ${TOOLSETS[id].label}`
                                  : `Grant ${TOOLSETS[id].label}`
                              }
                            >
                              {TOOLSETS[id].label}
                            </button>
                          );
                        })
                        ) : (
                          <span className="text-ink-soft">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          active
                            ? "bg-emerald-100 text-pass"
                            : "bg-zinc-100 text-ink-soft"
                        }`}
                      >
                        {active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => editUser(u)}
                          className="text-xs font-semibold text-accent hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive(u)}
                          className="text-xs font-semibold text-ink-soft hover:underline"
                        >
                          {active ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {teamsEnabled ? (
        <section id="teams" className="mb-8 scroll-mt-24">
          <h2 className="mb-3 font-display text-2xl text-ink">Teams & departments</h2>
          <p className="mb-4 max-w-2xl text-sm text-ink-soft">
            Shared across Call QA and Time Clock. Supervisors see coaching and
            time for the people on their team.
          </p>
          <TimeClockTeamsPanel
            initialTeams={[]}
            initialUsers={users.map((user) => ({
              email: user.email,
              name: user.name || user.email,
              role: user.role || "Agent",
            }))}
          />
        </section>
      ) : null}

      {formOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-ink/40 p-4 py-10"
          onClick={() => {
            if (!saving) closeForm();
          }}
        >
          <form
            id="person-form"
            onSubmit={saveUser}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl border border-line bg-white p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-2xl text-ink">
                  {emailLocked ? "Edit person" : "Add person"}
                </h2>
                <p className="mt-1 text-sm text-ink-soft">
                  Set role, Vonage extension (for recording credit), tool sets, and
                  contract visibility.
                </p>
              </div>
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-lg px-2 py-1 text-sm font-semibold text-ink-soft hover:bg-wash disabled:opacity-60"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            {msg ? (
              <p className="mt-3 rounded-xl border border-line bg-wash px-3 py-2 text-sm text-ink-soft">
                {msg}
              </p>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Display name
                </span>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2"
                  placeholder="Diana"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Workspace email
                </span>
                <input
                  required
                  type="email"
                  value={email}
                  readOnly={emailLocked}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`w-full rounded-lg border border-line px-3 py-2 ${
                    emailLocked ? "bg-wash text-ink-soft" : ""
                  }`}
                  placeholder={`diana@${domain}`}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Vonage extension
                </span>
                <input
                  value={extension}
                  onChange={(e) => setExtension(e.target.value)}
                  className="w-full rounded-lg border border-line px-3 py-2 font-mono"
                  placeholder="3101"
                  inputMode="numeric"
                />
              </label>
            </div>
            <label className="mt-3 block text-sm">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Role
              </span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full max-w-xs rounded-lg border border-line px-3 py-2"
              >
                <option value="Agent">Agent</option>
                <option value="Supervisor">Supervisor</option>
                <option value="Admin">Admin</option>
              </select>
            </label>
            <fieldset className="mt-4">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Tool set access
              </legend>
              <div className="flex flex-wrap gap-4">
                {grantableToolsets.map((id) => (
                  <label key={id} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={toolsets.includes(id)}
                      onChange={() => toggleFormToolset(id)}
                    />
                    {TOOLSETS[id].label}
                  </label>
                ))}
              </div>
            </fieldset>
            {canGrantContracts ? (
            <fieldset className="mt-4 rounded-xl border border-line bg-paper/50 p-4">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Contract permissions
              </legend>
              {caps.allContractTypes ? (
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={allContractTypes && toolsets.includes("contracts")}
                  disabled={!toolsets.includes("contracts")}
                  onChange={(e) => setAllContractTypes(e.target.checked)}
                />
                All agreement types
              </label>
              ) : null}
              {visibleGroups.length ? (
                <div className="mt-2 flex flex-wrap gap-3">
                  {visibleGroups.map((group) => (
                    <label key={group.id} className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        disabled={!toolsets.includes("contracts") || allContractTypes}
                        checked={
                          toolsets.includes("contracts") &&
                          (allContractTypes || groupSlugs.includes(group.slug))
                        }
                        onChange={() =>
                          setGroupSlugs((prev) =>
                            prev.includes(group.slug)
                              ? prev.filter((s) => s !== group.slug)
                              : [...prev, group.slug]
                          )
                        }
                      />
                      {group.name}
                    </label>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-4">
                {caps.vendorContacts ? (
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={vendorContacts}
                    onChange={(e) => setVendorContacts(e.target.checked)}
                  />
                  Vendor contacts
                </label>
                ) : null}
                {caps.vendorFiles ? (
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={vendorFiles}
                    onChange={(e) => setVendorFiles(e.target.checked)}
                  />
                  Vendor files (W-9 / COI)
                </label>
                ) : null}
              </div>
              {caps.vendorContacts ? (
              <p className="mt-2 text-xs text-ink-soft">
                Contacts without agreement types lets someone see people, not PDFs or
                commercial terms.
              </p>
              ) : null}
            </fieldset>
            ) : null}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeForm}
                disabled={saving}
                className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink-soft disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save person"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

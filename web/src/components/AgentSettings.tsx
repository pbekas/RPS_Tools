"use client";

import { useMemo, useState } from "react";
import type { UnmappedAgentRow, UserDoc } from "@/lib/database";
import type { ContractGroup } from "@/lib/contractTypes";
import {
  buildModuleGrants,
  parseContractGrantState,
} from "@/lib/contractAccess";
import {
  ALL_TOOLSET_IDS,
  TOOLSETS,
  normalizeModuleGrants,
  normalizeToolsetGrants,
  type ToolsetId,
} from "@/lib/permissions";

type Props = {
  initialUsers: UserDoc[];
  initialUnmapped: UnmappedAgentRow[];
  domain: string;
  embedded?: boolean;
  contractGroups?: ContractGroup[];
};

function toolsetsForUser(user: UserDoc): ToolsetId[] {
  const grants = normalizeToolsetGrants(user.modules || []);
  return grants.length ? grants : ["call_qa"];
}

export function AgentSettings({
  initialUsers,
  initialUnmapped,
  domain,
  embedded = false,
  contractGroups = [],
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [unmapped, setUnmapped] = useState(initialUnmapped);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [extension, setExtension] = useState("");
  const [role, setRole] = useState("Agent");
  const [toolsets, setToolsets] = useState<ToolsetId[]>(["call_qa"]);
  const [allContractTypes, setAllContractTypes] = useState(true);
  const [groupSlugs, setGroupSlugs] = useState<string[]>(
    contractGroups.map((g) => g.slug)
  );
  const [vendorContacts, setVendorContacts] = useState(true);
  const [vendorFiles, setVendorFiles] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  const needsImport = useMemo(
    () => unmapped.filter((r) => !r.mapped),
    [unmapped]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter((u) => {
      if (!needle) return true;
      return (
        (u.name || "").toLowerCase().includes(needle) ||
        (u.email || "").toLowerCase().includes(needle) ||
        (u.extension || "").toLowerCase().includes(needle) ||
        (u.role || "").toLowerCase().includes(needle)
      );
    });
  }, [users, q]);

  async function refresh() {
    const res = await fetch("/api/users?unmapped=1");
    const data = await res.json();
    if (res.ok) {
      setUsers(data.users || []);
      setUnmapped(data.unmapped || []);
    }
  }

  function emailFor(row: UnmappedAgentRow) {
    return (edits[row.agent_name] || row.suggested_email).trim().toLowerCase();
  }

  function toggleFormToolset(id: ToolsetId) {
    setToolsets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function importOne(row: UnmappedAgentRow) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "import_map",
          agent_name: row.agent_name,
          email: emailFor(row),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setMsg(
        `Imported ${data.name} → ${data.email}` +
          (data.remappedCalls ? ` · ${data.remappedCalls} calls mapped` : "")
      );
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSaving(false);
    }
  }

  async function importAll() {
    setSaving(true);
    setMsg("");
    try {
      const results: string[] = [];
      for (const row of needsImport) {
        const res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "import_map",
            agent_name: row.agent_name,
            email: emailFor(row),
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          results.push(`${row.agent_name}: ${data.error || "failed"}`);
        } else {
          results.push(`${data.name} → ${data.email} (${data.remappedCalls} calls)`);
        }
      }
      setMsg(results.join(" · ") || "Nothing to import");
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSaving(false);
    }
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
        toolsets,
        allContractTypes,
        groupSlugs,
        knownGroupSlugs: contractGroups.map((g) => g.slug),
        vendorContacts,
        vendorFiles,
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
      setName("");
      setEmail("");
      setExtension("");
      setRole("Agent");
      setToolsets(["call_qa"]);
      setAllContractTypes(true);
      setGroupSlugs(contractGroups.map((g) => g.slug));
      setVendorContacts(true);
      setVendorFiles(true);
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

  function editUser(user: UserDoc) {
    setName(user.name || "");
    setEmail(user.email);
    setExtension(user.extension || "");
    setRole(user.role || "Agent");
    const parsed = parseContractGrantState(user, contractGroups);
    setToolsets(parsed.toolsets.length ? parsed.toolsets : toolsetsForUser(user));
    setAllContractTypes(parsed.allContractTypes);
    setGroupSlugs(
      parsed.groupSlugs.length ? parsed.groupSlugs : contractGroups.map((g) => g.slug)
    );
    setVendorContacts(parsed.vendorContacts);
    setVendorFiles(parsed.vendorFiles);
    document
      .getElementById("person-form")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function setUserToolsets(user: UserDoc, next: ToolsetId[]) {
    setMsg("");
    const existing = (user.modules || []).filter((m) => String(m).startsWith("contracts:"));
    const base = normalizeToolsetGrants(next).length
      ? normalizeToolsetGrants(next)
      : ["call_qa"];
    const modules = next.includes("contracts")
      ? normalizeModuleGrants([...base, ...existing])
      : base;
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
            People first — search, edit access, then import anyone still missing
            from call recordings.
          </p>
        </div>
      ) : (
        <div className="mb-8">
          <h2 className="font-display text-2xl text-ink">Users & access</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Grant Call QA, Contracts, and/or Time Clock per person. Import agents found on calls as{" "}
            <code className="rounded bg-wash px-1">{`{name}@${domain}`}</code>.
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
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email…"
          className="rounded-xl border border-line bg-white px-3 py-2 text-sm"
        />
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
                        {ALL_TOOLSET_IDS.map((id) => {
                          const on = granted.includes(id);
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => {
                                const next = on
                                  ? granted.filter((x) => x !== id)
                                  : [...granted, id];
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
                        })}
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

      <form
        id="person-form"
        onSubmit={saveUser}
        className="mb-8 rounded-2xl border border-line bg-white/85 p-5 shadow-soft"
      >
        <h2 className="font-display text-2xl text-ink">Add / update person</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Set role, Vonage extension (for recording credit), tool sets, and
          contract visibility.
        </p>
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
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2"
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
            {ALL_TOOLSET_IDS.map((id) => (
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
        <fieldset className="mt-4 rounded-xl border border-line bg-paper/50 p-4">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Contract permissions
          </legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={allContractTypes && toolsets.includes("contracts")}
              disabled={!toolsets.includes("contracts")}
              onChange={(e) => setAllContractTypes(e.target.checked)}
            />
            All agreement types
          </label>
          {contractGroups.length ? (
            <div className="mt-2 flex flex-wrap gap-3">
              {contractGroups.map((group) => (
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
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={vendorContacts}
                onChange={(e) => setVendorContacts(e.target.checked)}
              />
              Vendor contacts
            </label>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={vendorFiles}
                onChange={(e) => setVendorFiles(e.target.checked)}
              />
              Vendor files (W-9 / COI)
            </label>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Contacts without agreement types lets someone see people, not PDFs or
            commercial terms.
          </p>
        </fieldset>
        <button
          type="submit"
          disabled={saving}
          className="mt-4 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save person"}
        </button>
      </form>

      <section className="rounded-2xl border border-line bg-white/85 p-5 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink">Import from calls</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Names detected on calls that still need a Workspace email.
            </p>
          </div>
          {needsImport.length > 0 ? (
            <button
              type="button"
              disabled={saving}
              onClick={importAll}
              className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
            >
              {saving ? "Importing…" : `Import all (${needsImport.length})`}
            </button>
          ) : null}
        </div>

        {needsImport.length === 0 ? (
          <p className="mt-6 text-sm text-ink-soft">
            No unmapped agents right now — everyone found on recent calls is mapped.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2">Name on calls</th>
                  <th className="px-3 py-2">Calls</th>
                  <th className="px-3 py-2">Map to email</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {needsImport.map((row) => (
                  <tr key={row.agent_name} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-3 font-semibold text-ink">
                      {row.agent_name}
                    </td>
                    <td className="px-3 py-3 text-ink-soft">{row.call_count}</td>
                    <td className="px-3 py-3">
                      <input
                        value={edits[row.agent_name] ?? row.suggested_email}
                        onChange={(e) =>
                          setEdits((prev) => ({
                            ...prev,
                            [row.agent_name]: e.target.value,
                          }))
                        }
                        className="w-full min-w-[14rem] rounded-lg border border-line px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => importOne(row)}
                        className="rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-wash disabled:opacity-60"
                      >
                        Import & map
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

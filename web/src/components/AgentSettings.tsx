"use client";

import { useEffect, useMemo, useState } from "react";
import type { UnmappedAgentRow, UserDoc, VonageExtensionDoc } from "@/lib/database";
import { ALL_MODULE_IDS, MODULES, normalizeModules, type ModuleId } from "@/lib/permissions";

type Props = {
  initialUsers: UserDoc[];
  initialUnmapped: UnmappedAgentRow[];
  domain: string;
  embedded?: boolean;
};

export function AgentSettings({
  initialUsers,
  initialUnmapped,
  domain,
  embedded = false,
}: Props) {
  const [users, setUsers] = useState(initialUsers);
  const [unmapped, setUnmapped] = useState(initialUnmapped);
  const [extensions, setExtensions] = useState<VonageExtensionDoc[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Agent");
  const [modules, setModules] = useState<ModuleId[]>(["call_qa"]);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [extensionDrafts, setExtensionDrafts] = useState<Record<string, string>>({});
  const [extMapDrafts, setExtMapDrafts] = useState<Record<string, string>>({});
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
        (u.role || "").toLowerCase().includes(needle) ||
        String(u.extension || "").toLowerCase().includes(needle)
      );
    });
  }, [users, q]);

  const unmappedExts = useMemo(
    () => extensions.filter((e) => !e.mapped_email),
    [extensions]
  );

  useEffect(() => {
    void refresh();
    // Load extension catalog on first paint (Settings may not pass it yet).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const res = await fetch("/api/users?unmapped=1&extensions=1");
    const data = await res.json();
    if (res.ok) {
      setUsers(data.users || []);
      setUnmapped(data.unmapped || []);
      setExtensions(data.extensions || []);
    }
  }

  async function syncExtensions() {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_extensions" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      if (data.users) setUsers(data.users);
      if (data.extensions) setExtensions(data.extensions);
      const s = data.summary || {};
      const nameMapped = Number(s.auto_mapped_by_name || 0);
      setMsg(
        `Synced extensions: ${s.upserted ?? 0} catalog · ${s.auto_mapped ?? 0} auto-mapped` +
          (nameMapped ? ` (${nameMapped} by name)` : "") +
          (s.provisioning_ok
            ? " · Vonage Provisioning (emails available)"
            : " · CDR harvest only (no emails on extensions — map by name or pick a user below)")
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSaving(false);
    }
  }

  async function mapExtensionToUser(extension: string) {
    const email = (extMapDrafts[extension] || "").trim().toLowerCase();
    if (!email) {
      setMsg("Pick a user email for that extension first");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_extension",
          email,
          extension,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Map failed");
      setMsg(`Mapped ext ${extension} → ${email}`);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Map failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveExtension(u: UserDoc) {
    setSaving(true);
    setMsg("");
    try {
      const ext = (extensionDrafts[u.email] ?? u.extension ?? "").trim();
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_extension",
          email: u.email,
          extension: ext,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setMsg(`Saved extension ${ext || "(cleared)"} for ${u.name || u.email}`);
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function emailFor(row: UnmappedAgentRow) {
    return (edits[row.agent_name] || row.suggested_email).trim().toLowerCase();
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
      // Import each with any edited emails
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
          email: editingEmail || email,
          role,
          modules: role === "Admin" ? ALL_MODULE_IDS : modules,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setMsg(
        editingEmail
          ? `Updated ${data.user.name} (${data.user.email})`
          : `Saved ${data.user.email}`
      );
      clearEditForm();
      await refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveName(user: UserDoc) {
    const nextName = (nameDrafts[user.email] ?? user.name ?? "").trim();
    if (!nextName) {
      setMsg("Name can’t be empty");
      return;
    }
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          email: user.email,
          name: nextName,
          role: user.role || "Agent",
          modules: user.modules,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setMsg(`Updated name → ${data.user.name}`);
      setNameDrafts((prev) => {
        const next = { ...prev };
        delete next[user.email];
        return next;
      });
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

  function clearEditForm() {
    setEditingEmail(null);
    setName("");
    setEmail("");
    setRole("Agent");
    setModules(["call_qa"]);
  }

  function editUser(user: UserDoc) {
    setEditingEmail(user.email);
    setName(user.name || "");
    setEmail(user.email);
    setRole(user.role || "Agent");
    const mods = normalizeModules(user.modules);
    setModules(mods.length ? mods : ["call_qa"]);
    document.getElementById("agent-edit-form")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <div className={embedded ? "mx-auto max-w-5xl px-4 py-8 sm:px-6" : "mx-auto max-w-5xl px-4 py-8 sm:px-6"}>
      {!embedded ? (
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
            Settings
          </p>
          <h1 className="mt-1 font-display text-4xl text-ink">Agents & team</h1>
          <p className="mt-2 max-w-2xl text-ink-soft">
            Manage your staff directory and map each person to their Vonage
            extension so Call Ops scorecards stay clean.
          </p>
        </div>
      ) : (
        <div className="mb-8">
          <h2 className="font-display text-2xl text-ink">Team directory</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Map Vonage extensions, assign roles and module access, then clean up
            names detected on calls below.
          </p>
        </div>
      )}

      {msg ? (
        <p className="mb-4 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          {msg}
        </p>
      ) : null}

      <section className="mb-8 rounded-2xl border border-line bg-white/85 p-5 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink">Vonage extensions</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Scorecard only counts staff with a mapped extension. Sync harvests
              extensions from CDRs (and Vonage Provisioning when enabled), then
              set each agent&apos;s extension in the directory below.
            </p>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={syncExtensions}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            {saving ? "Syncing…" : "Sync extensions"}
          </button>
        </div>
        {unmappedExts.length > 0 ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2">Ext</th>
                  <th className="px-3 py-2">Name on CDRs</th>
                  <th className="px-3 py-2">Map to user (email)</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {unmappedExts.slice(0, 40).map((e) => (
                  <tr key={e.extension} className="border-b border-line/70 last:border-0">
                    <td className="px-3 py-2 font-semibold text-ink">{e.extension}</td>
                    <td className="px-3 py-2 text-ink-soft">
                      {e.display_name || e.vbc_username || "—"}
                      {e.vbc_email ? (
                        <div className="text-[11px]">{e.vbc_email}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={extMapDrafts[e.extension] || ""}
                        onChange={(ev) =>
                          setExtMapDrafts((prev) => ({
                            ...prev,
                            [e.extension]: ev.target.value,
                          }))
                        }
                        className="w-full min-w-[14rem] rounded-lg border border-line px-2 py-1.5 text-sm"
                      >
                        <option value="">Select user…</option>
                        {users
                          .filter((u) => u.active !== false && !u.provisional)
                          .map((u) => (
                            <option key={u.email} value={u.email}>
                              {(u.name || u.email) +
                                (u.extension ? ` (ext ${u.extension})` : "") +
                                ` · ${u.email}`}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => mapExtensionToUser(e.extension)}
                        className="rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-wash disabled:opacity-60"
                      >
                        Map
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {unmappedExts.length > 40 ? (
              <p className="border-t border-line px-3 py-2 text-xs text-ink-soft">
                Showing 40 of {unmappedExts.length} unmapped extensions
              </p>
            ) : null}
          </div>
        ) : extensions.length > 0 ? (
          <p className="mt-3 text-xs text-ink-soft">
            {extensions.length} extensions synced — all mapped
          </p>
        ) : (
          <p className="mt-3 text-xs text-ink-soft">
            No extension catalog yet — click Sync extensions.
          </p>
        )}
      </section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl text-ink">Team directory</h2>
          <p className="mt-1 text-sm text-ink-soft">
            {users.length} people · edit Name inline, set Ext for the scorecard
          </p>
        </div>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search…"
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
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                  No agents in the directory yet — add one below or import from calls.
                </td>
              </tr>
            ) : (
              filtered.map((u) => {
                const active = u.active !== false;
                return (
                  <tr key={u.email} className="border-b border-line/70 last:border-0">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={nameDrafts[u.email] ?? u.name ?? ""}
                          onChange={(e) =>
                            setNameDrafts((prev) => ({
                              ...prev,
                              [u.email]: e.target.value,
                            }))
                          }
                          placeholder="Display name"
                          className="min-w-[8rem] flex-1 rounded-lg border border-line px-2 py-1 text-sm font-semibold text-ink"
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => saveName(u)}
                          className="text-xs font-semibold text-accent hover:underline disabled:opacity-60"
                        >
                          Save
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{u.email}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          value={extensionDrafts[u.email] ?? u.extension ?? ""}
                          onChange={(e) =>
                            setExtensionDrafts((prev) => ({
                              ...prev,
                              [u.email]: e.target.value,
                            }))
                          }
                          placeholder="e.g. 101"
                          className="w-20 rounded-lg border border-line px-2 py-1 text-sm"
                        />
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => saveExtension(u)}
                          className="text-xs font-semibold text-accent hover:underline disabled:opacity-60"
                        >
                          Save
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">{u.role || "Agent"}</td>
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
                      {u.provisional ? (
                        <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-warn">
                          Provisional
                        </span>
                      ) : null}
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
        id="agent-edit-form"
        onSubmit={saveUser}
        className="mb-8 rounded-2xl border border-line bg-white/85 p-5 shadow-soft"
      >
        <h2 className="font-display text-2xl text-ink">
          {editingEmail ? "Edit agent" : "Add agent"}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {editingEmail
            ? `Updating ${editingEmail}. Name and role can change; email stays the same.`
            : `Add someone who hasn’t appeared on calls yet, or create a Workspace email (e.g. tr@${domain}).`}
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
              disabled={!!editingEmail}
              className="w-full rounded-lg border border-line px-3 py-2 disabled:bg-wash disabled:text-ink-soft"
              placeholder={`diana@${domain}`}
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
            <option value="Admin">Admin</option>
          </select>
        </label>
        {role === "Admin" ? (
          <p className="mt-2 text-xs text-ink-soft">
            Admins automatically get every module (Call QA, Users, and future
            tools).
          </p>
        ) : (
          <fieldset className="mt-3">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Modules
            </legend>
            <div className="flex flex-wrap gap-4">
              {ALL_MODULE_IDS.map((id) => (
                <label
                  key={id}
                  className="flex items-center gap-2 text-sm text-ink"
                >
                  <input
                    type="checkbox"
                    checked={modules.includes(id)}
                    onChange={(e) => {
                      setModules((prev) => {
                        if (e.target.checked) {
                          return prev.includes(id) ? prev : [...prev, id];
                        }
                        return prev.filter((m) => m !== id);
                      });
                    }}
                  />
                  {MODULES[id].label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            {saving ? "Saving…" : editingEmail ? "Update agent" : "Save agent"}
          </button>
          {editingEmail ? (
            <button
              type="button"
              onClick={clearEditForm}
              className="text-sm font-semibold text-ink-soft hover:underline"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      <section className="mb-8 rounded-2xl border border-line bg-white/85 p-5 shadow-soft">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl text-ink">Import & map</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Names detected on calls that still need a Workspace email. Default
              mapping is firstname (or first.last) @{domain}. Prefer mapping real
              staff in Team directory with an Ext — avoid importing every unknown name.
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
                      {row.current_email ? (
                        <div className="text-[11px] font-normal text-ink-soft">
                          currently {row.current_email || "unassigned"}
                        </div>
                      ) : (
                        <div className="text-[11px] font-normal text-ink-soft">
                          no email on calls yet
                        </div>
                      )}
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

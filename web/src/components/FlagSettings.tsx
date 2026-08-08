"use client";

import { useState } from "react";
import type { CallFlag, FlagSet } from "@/lib/database";

type Props = {
  initialFlagset: FlagSet;
};

export function FlagSettings({ initialFlagset }: Props) {
  const [flagset, setFlagset] = useState(initialFlagset);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState("critical");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const flags = flagset.flags || [];

  function editFlag(f: CallFlag) {
    setId(f.id);
    setLabel(f.label);
    setDescription(f.description || "");
    setSeverity(f.severity || "critical");
    setActive(f.active !== false);
  }

  async function saveFlag(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          id,
          label,
          description,
          severity,
          active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setFlagset(data.flagset);
      setMsg(`Saved flag ${id}`);
      setId("");
      setLabel("");
      setDescription("");
      setSeverity("critical");
      setActive(true);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(f: CallFlag) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_active",
          id: f.id,
          active: !(f.active !== false),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setFlagset(data.flagset);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-ink">Critical flags</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {flagset.name} · version <code>{flagset.version}</code>. Triggered flags
          alert managers and appear on call review — they are not automatic skill
          fails unless you treat them that way in coaching.
        </p>
      </div>

      {msg ? (
        <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          {msg}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-line bg-white/80">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Severity</th>
              <th className="px-4 py-3">When to trigger</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {flags.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-soft">
                  No flags yet. Seed with{" "}
                  <code className="text-xs">scripts/seed_call_flags.py --force</code>
                  .
                </td>
              </tr>
            ) : (
              flags.map((f) => (
                <tr key={f.id} className="border-b border-line/70 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{f.id}</td>
                  <td className="px-4 py-3 font-semibold">{f.label}</td>
                  <td className="px-4 py-3">{f.severity || "critical"}</td>
                  <td className="px-4 py-3 text-ink-soft">{f.description}</td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => toggleActive(f)}
                      className="text-sm font-semibold text-accent"
                    >
                      {f.active !== false ? "Active" : "Off"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => editFlag(f)}
                      className="text-sm font-semibold text-ink-soft hover:text-ink"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={saveFlag}
        className="space-y-3 rounded-2xl border border-line bg-white/80 p-4"
      >
        <h3 className="font-display text-lg text-ink">Add / update flag</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="font-semibold text-ink-soft">ID</span>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
              placeholder="urgent_clinical_language"
            />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-soft">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="text-sm">
            <span className="font-semibold text-ink-soft">Severity</span>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2"
            >
              <option value="critical">critical</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
            </select>
          </label>
          <label className="flex items-end gap-2 text-sm font-semibold text-ink-soft">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Active
          </label>
        </div>
        <label className="block text-sm">
          <span className="font-semibold text-ink-soft">When to trigger (for AI)</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save flag"}
        </button>
      </form>
    </div>
  );
}

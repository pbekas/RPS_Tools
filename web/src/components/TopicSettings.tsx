"use client";

import { useState } from "react";
import type { CallTopic, TopicSet } from "@/lib/firestore";

type Props = {
  initialTopicset: TopicSet;
};

export function TopicSettings({ initialTopicset }: Props) {
  const [topicset, setTopicset] = useState(initialTopicset);
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const topics = topicset.topics || [];

  async function refresh() {
    const res = await fetch("/api/topics");
    const data = await res.json();
    if (res.ok) setTopicset(data.topicset);
  }

  function editTopic(t: CallTopic) {
    setId(t.id);
    setLabel(t.label);
    setDescription(t.description || "");
    setActive(t.active !== false);
  }

  async function saveTopic(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          id,
          label,
          description,
          active,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setTopicset(data.topicset);
      setMsg(`Saved topic ${id}`);
      setId("");
      setLabel("");
      setDescription("");
      setActive(true);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(t: CallTopic) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_active",
          id: t.id,
          active: !(t.active !== false),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setTopicset(data.topicset);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-ink">Call topics</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {topicset.name} · version <code>{topicset.version}</code>. The AI picks
          one active topic id using these labels and details.
        </p>
        {topicset.description ? (
          <p className="mt-2 text-sm text-ink-soft">{topicset.description}</p>
        ) : null}
      </div>

      {msg ? (
        <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          {msg}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-line bg-white/80 shadow-soft">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Label</th>
              <th className="px-4 py-3">Details for AI</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {topics.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-soft">
                  No topics yet. Seed with{" "}
                  <code>python scripts/seed_call_topics.py --force</code>.
                </td>
              </tr>
            ) : (
              topics.map((t) => {
                const isActive = t.active !== false;
                return (
                  <tr key={t.id} className="border-b border-line/70 last:border-0 align-top">
                    <td className="px-4 py-3 font-mono text-xs text-ink">{t.id}</td>
                    <td className="px-4 py-3 font-semibold text-ink">{t.label}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {t.description || "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          isActive
                            ? "bg-emerald-100 text-pass"
                            : "bg-zinc-100 text-ink-soft"
                        }`}
                      >
                        {isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => editTopic(t)}
                        className="text-xs font-semibold text-accent hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => toggleActive(t)}
                        className="ml-3 text-xs font-semibold text-ink-soft hover:underline disabled:opacity-60"
                      >
                        {isActive ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <form
        onSubmit={saveTopic}
        className="rounded-2xl border border-line bg-white/85 p-5 shadow-soft"
      >
        <h3 className="font-display text-xl text-ink">Add / update topic</h3>
        <p className="mt-1 text-sm text-ink-soft">
          ID is the stable value the AI returns (e.g. <code>scheduling</code>).
          Details teach the model when to pick this topic.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              ID
            </span>
            <input
              required
              value={id}
              onChange={(e) => setId(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2 font-mono text-sm"
              placeholder="prior_auth"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Label
            </span>
            <input
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-2"
              placeholder="Prior authorization"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Details for AI
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 h-24 w-full rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="When should a call be classified as this topic?"
          />
        </label>
        <label className="mt-3 flex items-center gap-2 text-sm font-semibold text-ink-soft">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active (visible to AI)
        </label>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save topic"}
          </button>
          <button
            type="button"
            onClick={() => {
              setId("");
              setLabel("");
              setDescription("");
              setActive(true);
              void refresh();
            }}
            className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink-soft hover:bg-wash"
          >
            Clear
          </button>
        </div>
      </form>
    </div>
  );
}

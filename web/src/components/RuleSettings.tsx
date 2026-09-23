"use client";

import { useMemo, useRef, useState } from "react";
import type { CallTopic, QaRule, QaRuleset, UserDoc } from "@/lib/database";

type Props = {
  initialRuleset: QaRuleset;
  topics?: CallTopic[];
  users?: UserDoc[];
};

const CATEGORIES = ["Greeting", "Empathy", "Process", "Resolution", "Compliance"];

const emptyForm = {
  id: "",
  label: "",
  description: "",
  category: "Process",
  weight: "1",
  auto_fail: false,
  pass_criteria: "",
  active: true,
  topic_ids: [] as string[],
  user_emails: [] as string[],
};

export function RuleSettings({ initialRuleset, topics = [], users = [] }: Props) {
  const [ruleset, setRuleset] = useState(initialRuleset);
  const [form, setForm] = useState(emptyForm);
  const [topicFilter, setTopicFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [userQuery, setUserQuery] = useState("");
  const [meta, setMeta] = useState({
    name: initialRuleset.name || "",
    description: initialRuleset.description || "",
    auto_fail_quality_cap: String(initialRuleset.auto_fail_quality_cap ?? 4),
    empathy_pass_threshold: String(initialRuleset.empathy_pass_threshold ?? 7),
    transfer_soft_limit: String(initialRuleset.transfer_soft_limit ?? 1),
    transfer_auto_fail_at: String(initialRuleset.transfer_auto_fail_at ?? 3),
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const categories = useMemo(() => {
    const extra = form.category && !CATEGORIES.includes(form.category) ? [form.category] : [];
    return [...CATEGORIES, ...extra];
  }, [form.category]);

  const rules = ruleset.rules || [];
  const topicLabel = useMemo(() => {
    const map = new Map(topics.map((t) => [t.id, t.label]));
    return (id: string) => map.get(id) || id;
  }, [topics]);

  const userLabel = useMemo(() => {
    const map = new Map(
      users.map((u) => [u.email.toLowerCase(), u.name?.trim() || u.email])
    );
    return (email: string) => map.get(email.toLowerCase()) || email;
  }, [users]);

  const assignableUsers = useMemo(() => {
    const selected = new Set(form.user_emails.map((email) => email.toLowerCase()));
    return [...users]
      .filter((user) => {
        const email = (user.email || "").trim().toLowerCase();
        if (!email) return false;
        return user.active !== false || selected.has(email);
      })
      .sort((a, b) =>
        (a.name || a.email).localeCompare(b.name || b.email, undefined, {
          sensitivity: "base",
        })
      );
  }, [users, form.user_emails]);

  const visibleRules = useMemo(() => {
    return rules.filter((r) => {
      const topicIds = r.topic_ids || [];
      const emails = (r.user_emails || []).map((email) => email.toLowerCase());
      const topicOk =
        topicFilter === "all" ||
        (topicFilter === "global"
          ? topicIds.length === 0
          : topicIds.length === 0 || topicIds.includes(topicFilter));
      const agentOk =
        agentFilter === "all" ||
        (agentFilter === "global"
          ? emails.length === 0
          : emails.length === 0 || emails.includes(agentFilter));
      return topicOk && agentOk;
    });
  }, [rules, topicFilter, agentFilter]);

  function toggleFormTopic(id: string) {
    setForm((prev) => ({
      ...prev,
      topic_ids: prev.topic_ids.includes(id)
        ? prev.topic_ids.filter((item) => item !== id)
        : [...prev.topic_ids, id],
    }));
  }

  async function refresh() {
    const res = await fetch("/api/qa/rules");
    const data = await res.json();
    if (res.ok) {
      setRuleset(data.ruleset);
      setMeta({
        name: data.ruleset.name || "",
        description: data.ruleset.description || "",
        auto_fail_quality_cap: String(data.ruleset.auto_fail_quality_cap ?? 4),
        empathy_pass_threshold: String(
          data.ruleset.empathy_pass_threshold ?? 7
        ),
        transfer_soft_limit: String(data.ruleset.transfer_soft_limit ?? 1),
        transfer_auto_fail_at: String(data.ruleset.transfer_auto_fail_at ?? 3),
      });
    }
  }

  function toggleFormUser(email: string) {
    const key = email.trim().toLowerCase();
    setForm((prev) => ({
      ...prev,
      user_emails: prev.user_emails.includes(key)
        ? prev.user_emails.filter((item) => item !== key)
        : [...prev.user_emails, key],
    }));
  }

  function editRule(r: QaRule) {
    setForm({
      id: r.id,
      label: r.label,
      description: r.description || "",
      category: r.category || "Process",
      weight: String(r.weight ?? 1),
      auto_fail: !!r.auto_fail,
      pass_criteria: r.pass_criteria || "",
      active: r.active !== false,
      topic_ids: [...(r.topic_ids || [])],
      user_emails: [...(r.user_emails || [])].map((email) => email.toLowerCase()),
    });
    requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  async function saveMeta(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/qa/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_meta",
          name: meta.name,
          description: meta.description,
          auto_fail_quality_cap: Number(meta.auto_fail_quality_cap),
          empathy_pass_threshold: Number(meta.empathy_pass_threshold),
          transfer_soft_limit: Number(meta.transfer_soft_limit),
          transfer_auto_fail_at: Number(meta.transfer_auto_fail_at),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setRuleset(data.ruleset);
      setMsg("Saved scoring thresholds");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/qa/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          id: form.id,
          label: form.label,
          description: form.description,
          category: form.category,
          weight: Number(form.weight),
          auto_fail: form.auto_fail,
          pass_criteria: form.pass_criteria,
          active: form.active,
          topic_ids: form.topic_ids,
          user_emails: form.user_emails,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setRuleset(data.ruleset);
      setMsg(`Saved rule ${form.id}`);
      setForm(emptyForm);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(r: QaRule) {
    setSaving(true);
    setMsg("");
    try {
      const res = await fetch("/api/qa/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_active",
          id: r.id,
          active: !(r.active !== false),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      setRuleset(data.ruleset);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-ink">QA audit rules</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {ruleset.name} · version <code>{ruleset.version}</code>. A rule with
          no users selected applies to everyone. Select users to score that
          rule only on their calls. Topic limits work the same way: no topics
          means every call, otherwise only those topics. Changes apply to new
          analyses (and re-analyze).
        </p>
      </div>

      {msg ? (
        <p className="rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          {msg}
        </p>
      ) : null}

      <form
        onSubmit={saveMeta}
        className="rounded-2xl border border-line bg-white/85 p-5 shadow-soft"
      >
        <h3 className="font-display text-xl text-ink">Scoring thresholds</h3>
        <p className="mt-1 text-sm text-ink-soft">
          Global caps used when computing quality / auto-fail.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Rubric name
            </span>
            <input
              value={meta.name}
              onChange={(e) => setMeta({ ...meta, name: e.target.value })}
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Description
            </span>
            <textarea
              value={meta.description}
              onChange={(e) =>
                setMeta({ ...meta, description: e.target.value })
              }
              className="h-20 w-full rounded-lg border border-line px-3 py-2 text-sm"
            />
          </label>
          <NumberField
            label="Empathy pass threshold"
            value={meta.empathy_pass_threshold}
            onChange={(v) => setMeta({ ...meta, empathy_pass_threshold: v })}
          />
          <NumberField
            label="Auto-fail quality cap"
            value={meta.auto_fail_quality_cap}
            onChange={(v) => setMeta({ ...meta, auto_fail_quality_cap: v })}
          />
          <NumberField
            label="Transfer soft limit"
            value={meta.transfer_soft_limit}
            onChange={(v) => setMeta({ ...meta, transfer_soft_limit: v })}
          />
          <NumberField
            label="Transfer auto-fail at"
            value={meta.transfer_auto_fail_at}
            onChange={(v) => setMeta({ ...meta, transfer_auto_fail_at: v })}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          className="mt-4 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save thresholds"}
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-line bg-white/80 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-wash/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {visibleRules.length} rule{visibleRules.length === 1 ? "" : "s"}
            {topicFilter !== "all" || agentFilter !== "all" ? " in this view" : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Show
            </span>
            <select
              value={topicFilter}
              onChange={(e) => setTopicFilter(e.target.value)}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
            >
              <option value="all">All rules</option>
              <option value="global">All-topic rules only</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  Applies on {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Agents
            </span>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded-lg border border-line bg-white px-3 py-1.5 text-sm"
            >
              <option value="all">All assignments</option>
              <option value="global">Everyone</option>
              {assignableUsers.map((user) => (
                <option key={user.email} value={user.email.toLowerCase()}>
                  {user.name?.trim() || user.email}
                </option>
              ))}
            </select>
          </label>
          </div>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-wash/70 text-xs uppercase tracking-wide text-ink-soft">
            <tr>
              <th className="px-4 py-3">Rule</th>
              <th className="px-4 py-3">Topics</th>
              <th className="px-4 py-3">Agents</th>
              <th className="px-4 py-3">Category</th>
              <th className="px-4 py-3">Weight</th>
              <th className="px-4 py-3">Flags</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-soft">
                  No rules yet. Seed with{" "}
                  <code>python scripts/seed_qa_rules.py --force</code>.
                </td>
              </tr>
            ) : visibleRules.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-soft">
                  No rules match this filter.
                </td>
              </tr>
            ) : (
              visibleRules.map((r) => {
                const isActive = r.active !== false;
                const ids = r.topic_ids || [];
                const emails = r.user_emails || [];
                return (
                  <tr
                    key={r.id}
                    className="border-b border-line/70 last:border-0 align-top"
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-ink">{r.label}</div>
                      <div className="font-mono text-[11px] text-ink-soft">
                        {r.id}
                      </div>
                      {r.pass_criteria ? (
                        <p className="mt-1 line-clamp-2 text-xs text-ink-soft">
                          {r.pass_criteria}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {ids.length === 0 ? (
                        <span className="text-xs text-ink-soft">All topics</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {ids.map((id) => (
                            <span
                              key={id}
                              className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-ink"
                            >
                              {topicLabel(id)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {emails.length === 0 ? (
                        <span className="text-xs text-ink-soft">Everyone</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {emails.map((email) => (
                            <span
                              key={email}
                              className="rounded-full bg-wash px-2 py-0.5 text-[11px] font-semibold text-ink"
                            >
                              {userLabel(email)}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {r.category || "—"}
                    </td>
                    <td className="px-4 py-3 text-ink">{r.weight ?? 1}</td>
                    <td className="px-4 py-3">
                      {r.auto_fail ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-fail">
                          AUTO-FAIL
                        </span>
                      ) : (
                        <span className="text-xs text-ink-soft">—</span>
                      )}
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
                        onClick={() => editRule(r)}
                        className="text-xs font-semibold text-accent hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => toggleActive(r)}
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
        ref={formRef}
        onSubmit={saveRule}
        className="scroll-mt-6 rounded-2xl border border-line bg-white/85 p-5 shadow-soft"
      >
        <h3 className="font-display text-xl text-ink">Add / update rule</h3>
        <p className="mt-1 text-sm text-ink-soft">
          ID is the stable value the AI returns (e.g. <code>name_stated</code>).
          Pass criteria teach the model when the rule passes or fails.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              ID
            </span>
            <input
              required
              value={form.id}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              className="w-full rounded-lg border border-line px-3 py-2 font-mono text-sm"
              placeholder="name_stated"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Label
            </span>
            <input
              required
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              className="w-full rounded-lg border border-line px-3 py-2"
              placeholder="Agent stated their name"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Category
            </span>
            <select
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              className="w-full rounded-lg border border-line px-3 py-2"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Weight
            </span>
            <input
              required
              type="number"
              min="0"
              step="0.5"
              value={form.weight}
              onChange={(e) => setForm({ ...form, weight: e.target.value })}
              className="w-full rounded-lg border border-line px-3 py-2"
            />
          </label>
        </div>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Description
          </span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="h-16 w-full rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="Short manager-facing description"
          />
        </label>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Pass criteria (for AI)
          </span>
          <textarea
            value={form.pass_criteria}
            onChange={(e) =>
              setForm({ ...form, pass_criteria: e.target.value })
            }
            className="h-24 w-full rounded-lg border border-line px-3 py-2 text-sm"
            placeholder="When should this rule pass or fail?"
          />
        </label>
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Applies to topics
          </legend>
          <p className="mt-1 text-sm text-ink-soft">
            Leave all unchecked to score this rule on every call. Check one or
            more topics to score it only when the call is classified as those
            topics — for example New patient vs Billing.
          </p>
          {topics.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              Add topics in the Topics tab first, then assign them here.
            </p>
          ) : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {topics.map((t) => (
                <label
                  key={t.id}
                  className="flex items-start gap-2 text-sm font-semibold text-ink-soft"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.topic_ids.includes(t.id)}
                    onChange={() => toggleFormTopic(t.id)}
                  />
                  <span>
                    {t.label}
                    <span className="ml-1 font-mono text-[11px] font-normal">
                      {t.id}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
            Applies to agents
          </legend>
          <p className="mt-1 text-sm text-ink-soft">
            Leave everyone unchecked to score this rule on every agent. Check
            one or more people to score it only on their calls.
          </p>
          {assignableUsers.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              Add users in Users &amp; access first, then assign them here.
            </p>
          ) : (
            <>
              <input
                value={userQuery}
                onChange={(e) => setUserQuery(e.target.value)}
                className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Find a user"
              />
              <div className="mt-3 grid max-h-56 gap-2 overflow-y-auto sm:grid-cols-2">
                {assignableUsers
                  .filter((user) => {
                    const needle = userQuery.trim().toLowerCase();
                    if (!needle) return true;
                    return (
                      (user.name || "").toLowerCase().includes(needle) ||
                      user.email.toLowerCase().includes(needle)
                    );
                  })
                  .map((user) => {
                    const email = user.email.toLowerCase();
                    return (
                      <label
                        key={email}
                        className="flex items-start gap-2 text-sm font-semibold text-ink-soft"
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={form.user_emails.includes(email)}
                          onChange={() => toggleFormUser(email)}
                        />
                        <span>
                          {user.name?.trim() || email}
                          <span className="ml-1 block font-mono text-[11px] font-normal">
                            {email}
                          </span>
                        </span>
                      </label>
                    );
                  })}
              </div>
            </>
          )}
        </fieldset>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            Active (scored by AI)
          </label>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink-soft">
            <input
              type="checkbox"
              checked={form.auto_fail}
              onChange={(e) =>
                setForm({ ...form, auto_fail: e.target.checked })
              }
            />
            Auto-fail call when this rule fails
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save rule"}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm(emptyForm);
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

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </span>
      <input
        required
        type="number"
        min="0"
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line px-3 py-2"
      />
    </label>
  );
}

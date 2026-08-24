"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CallDoc, UserDoc } from "@/lib/database";
import { formatCallDate, formatDuration, formatPhone, resolveAgentLabel, resolveDoctorName, resolvePatientName } from "@/lib/format";
import { QUEUE_STORAGE_KEY, type StoredQueue } from "@/lib/qa";
import { QueueNav } from "@/components/QueueNav";

type Props = {
  call: CallDoc;
  isAdmin: boolean;
  agents?: UserDoc[];
};

function timestampToSeconds(ts?: string | null): number | null {
  if (!ts) return null;
  const parts = ts.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function CallReviewInner({ call, isAdmin, agents = [] }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const inQueue = searchParams.get("queue") === "1";
  const [activeTurn, setActiveTurn] = useState<number | null>(null);
  const [notes, setNotes] = useState(call.manager_notes || "");
  const [feedback, setFeedback] = useState(call.manager_feedback || "");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [agentEmail, setAgentEmail] = useState(call.agent_email || "");
  const [agentName, setAgentName] = useState(call.agent_name || "");
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState("");
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeMsg, setReanalyzeMsg] = useState("");

  const transcript = call.transcript || [];
  const rules = call.rule_results || [];
  const failed = useMemo(() => rules.filter((r) => !r.passed), [rules]);
  const criticalFlags = call.critical_flags || [];
  const sentimentLabel = (call.sentiment_label || "").toLowerCase();
  const sentimentTone =
    sentimentLabel === "positive"
      ? "bg-emerald-100 text-pass"
      : sentimentLabel === "negative"
        ? "bg-red-100 text-fail"
        : sentimentLabel === "mixed"
          ? "bg-amber-50 text-warn"
          : "bg-wash text-ink-soft";

  useEffect(() => {
    setNotes(call.manager_notes || "");
    setFeedback(call.manager_feedback || "");
    setAgentEmail(call.agent_email || "");
    setAgentName(call.agent_name || "");
    setActiveTurn(null);
    setSavedMsg("");
    setAssignMsg("");
    setReanalyzeMsg("");
  }, [call.id, call.manager_notes, call.manager_feedback, call.agent_email, call.agent_name]);

  function jumpToTurn(index: number | null | undefined, ts?: string | null) {
    if (index == null || index < 0 || index >= transcript.length) return;
    setActiveTurn(index);
    document
      .getElementById(`turn-${index}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    const seconds =
      timestampToSeconds(ts) ??
      timestampToSeconds(transcript[index]?.timestamp);
    if (seconds != null && audioRef.current) {
      audioRef.current.currentTime = Math.max(0, seconds);
      void audioRef.current.play().catch(() => undefined);
    }
  }

  function advanceQueue() {
    if (!inQueue) return;
    try {
      const raw = sessionStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return;
      const q = JSON.parse(raw) as StoredQueue;
      const idx = q.ids.indexOf(call.id);
      const nextId = idx >= 0 && idx < q.ids.length - 1 ? q.ids[idx + 1] : null;
      if (nextId) router.push(`/calls/${nextId}?queue=1`);
      else router.push("/queue");
    } catch {
      /* ignore */
    }
  }

  async function saveReview(andNext = false) {
    setSaving(true);
    setSavedMsg("");
    try {
      const res = await fetch(`/api/calls/${call.id}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          manager_feedback: feedback,
          manager_notes: notes,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSavedMsg("Saved");
      if (andNext) advanceQueue();
    } catch (e) {
      setSavedMsg(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveAgentAssignment() {
    setAssigning(true);
    setAssignMsg("");
    try {
      const body = { agent_email: agentEmail, agent_name: agentName };
      const res = await fetch(`/api/calls/${call.id}/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Assign failed");
      setAgentEmail(data.call?.agent_email || "");
      setAgentName(data.call?.agent_name || "");
      setAssignMsg("Agent updated");
      router.refresh();
    } catch (e) {
      setAssignMsg(e instanceof Error ? e.message : "Assign failed");
    } finally {
      setAssigning(false);
    }
  }

  async function reanalyzeCall() {
    setReanalyzing(true);
    setReanalyzeMsg("");
    try {
      const res = await fetch(`/api/calls/${call.id}/reanalyze`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Re-analyze failed");
      const flags = Array.isArray(data.critical_flags) ? data.critical_flags.length : 0;
      setReanalyzeMsg(
        flags
          ? `Re-scored · Q${data.quality_score ?? "—"} · ${flags} critical flag(s)`
          : `Re-scored · Q${data.quality_score ?? "—"}`
      );
      router.refresh();
    } catch (e) {
      setReanalyzeMsg(e instanceof Error ? e.message : "Re-analyze failed");
    } finally {
      setReanalyzing(false);
    }
  }

  const patientName = resolvePatientName(call);
  const doctorName = resolveDoctorName(call);
  const callerPhone = formatPhone(call.vonage_caller_id);
  const agent = resolveAgentLabel({
    agent_name: agentName || call.agent_name,
    agent_email: agentEmail || call.agent_email,
  });
  const isProvisional = (agentEmail || call.agent_email || "")
    .toLowerCase()
    .startsWith("unmapped.");

  return (
    <div>
      <QueueNav callId={call.id} />
      <div className="grid min-h-[calc(100vh-5.5rem)] grid-cols-1 gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="flex min-h-0 flex-col border-r border-line bg-white/70 backdrop-blur">
          <header className="border-b border-line px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent">
                  Call review
                </p>
                <h1 className="mt-1 font-display text-3xl text-ink">{patientName}</h1>
                {callerPhone || doctorName ? (
                  <p className="mt-1 text-ink-soft">
                    {[
                      callerPhone ? `Phone · ${callerPhone}` : null,
                      doctorName ? `Doctor · ${doctorName}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                <p className={`${callerPhone || doctorName ? "mt-0.5" : "mt-1"} text-ink-soft`}>
                  Agent · {agent.name}
                  {isProvisional || agent.unmapped ? " · needs Workspace email" : ""} ·{" "}
                  {call.topic || "General"} · {formatCallDate(call.call_date)} ·{" "}
                  {formatDuration(call.duration_seconds)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ScorePill label="Quality" value={`${call.quality_score ?? "—"}/10`} />
                <ScorePill label="Empathy" value={`${call.ai_empathy_score ?? "—"}/10`} />
                <ScorePill label="Transfers" value={`${call.transfer_count ?? 0}`} />
                <ScorePill label="FCR" value={call.fcr ? "Yes" : "No"} />
                {call.sentiment_label ? (
                  <div className={`rounded-xl border border-line px-3 py-2 shadow-sm ${sentimentTone}`}>
                    <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                      Sentiment
                    </div>
                    <div className="text-sm font-semibold capitalize">
                      {call.sentiment_label}
                      {call.sentiment_score != null ? ` · ${call.sentiment_score}/10` : ""}
                    </div>
                  </div>
                ) : null}
                {call.auto_failed ? (
                  <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-fail">
                    Auto-fail
                  </span>
                ) : null}
                {criticalFlags.length ? (
                  <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-fail">
                    {criticalFlags.length} critical
                  </span>
                ) : null}
              </div>
            </div>
            {criticalFlags.length ? (
              <div className="mt-4 space-y-2 rounded-xl border border-red-200 bg-red-50/80 px-4 py-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-fail">
                  Critical flags
                </div>
                {criticalFlags.map((f) => (
                  <button
                    key={f.flag_id || f.label}
                    type="button"
                    onClick={() =>
                      jumpToTurn(f.evidence_turn_index ?? null, f.evidence_timestamp)
                    }
                    className="block w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-left hover:shadow-sm"
                  >
                    <div className="font-semibold text-fail">{f.label || f.flag_id}</div>
                    <p className="mt-1 text-sm text-ink-soft">
                      {f.evidence || f.notes || "—"}
                    </p>
                    {f.evidence_timestamp ? (
                      <div className="mt-1 text-xs font-semibold text-accent">
                        Jump · {f.evidence_timestamp}
                      </div>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
            {call.sentiment_notes ? (
              <p className="mt-3 text-sm text-ink-soft">
                <span className="font-semibold text-ink">Tone: </span>
                {call.sentiment_notes}
              </p>
            ) : null}
            <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink-soft">
              {call.ai_summary || "No summary available."}
            </p>
            <div className="mt-4">
              {call.recording_url ? (
                <audio
                  ref={audioRef}
                  controls
                  className="w-full"
                  src={call.recording_url}
                  preload="metadata"
                />
              ) : (
                <p className="text-sm text-ink-soft">No playable recording URL.</p>
              )}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {transcript.length === 0 ? (
                <p className="text-ink-soft">No transcript stored.</p>
              ) : (
                transcript.map((turn, i) => {
                  const speaker = turn.speaker || "Unknown";
                  const side =
                    speaker === "Agent"
                      ? "agent"
                      : speaker === "System"
                        ? "system"
                        : "patient";
                  const active = activeTurn === i;
                  return (
                    <button
                      key={`${i}-${turn.timestamp}`}
                      id={`turn-${i}`}
                      type="button"
                      onClick={() => jumpToTurn(i, turn.timestamp)}
                      className={`flex w-full ${
                        side === "agent"
                          ? "justify-end"
                          : side === "system"
                            ? "justify-center"
                            : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[78%] rounded-2xl px-4 py-3 text-left transition ${
                          side === "agent"
                            ? "bg-agent"
                            : side === "system"
                              ? "bg-zinc-100 text-ink-soft"
                              : "bg-patient"
                        } ${active ? "ring-2 ring-accent shadow-soft" : "ring-1 ring-black/5"}`}
                      >
                        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                          {speaker}
                          {turn.timestamp ? ` · ${turn.timestamp}` : ""}
                        </div>
                        <div className="text-[15px] leading-relaxed text-ink">
                          {turn.text}
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col bg-wash/60">
          {isAdmin ? (
            <div className="border-b border-line bg-white/90 px-4 py-4">
              <h2 className="font-display text-xl text-ink">Manager review</h2>
              <p className="text-sm text-ink-soft">
                Confirm the agent, then capture coaching notes.
              </p>

              <div className="mt-3 rounded-xl border border-line bg-wash/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                      Re-analyze
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">
                      Re-score with current QA rules and critical flags (uses stored
                      transcript).
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={reanalyzing || !(call.transcript || []).length}
                    onClick={() => void reanalyzeCall()}
                    className="shrink-0 rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent hover:bg-white disabled:opacity-60"
                  >
                    {reanalyzing ? "Scoring…" : "Re-analyze"}
                  </button>
                </div>
                {reanalyzeMsg ? (
                  <p className="mt-2 text-xs text-ink-soft">{reanalyzeMsg}</p>
                ) : null}
              </div>

              <div className="mt-3 rounded-xl border border-line bg-wash/50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
                  Agent
                </div>
                <select
                  value={agentEmail}
                  onChange={(e) => {
                    const email = e.target.value;
                    setAgentEmail(email);
                    const match = agents.find((a) => a.email === email);
                    setAgentName(match?.name || "");
                  }}
                  className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                >
                  <option value="">Select agent…</option>
                  {agents
                    .filter(
                      (a) =>
                        !a.provisional &&
                        !a.email.startsWith("unmapped.")
                    )
                    .map((a) => (
                      <option key={a.email} value={a.email}>
                        {a.name || a.email}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={assigning}
                  onClick={saveAgentAssignment}
                  className="mt-2 w-full rounded-lg border border-accent px-3 py-2 text-sm font-semibold text-accent hover:bg-white disabled:opacity-60"
                >
                  {assigning ? "Updating…" : "Update agent"}
                </button>
                {assignMsg ? (
                  <p className="mt-1 text-center text-xs text-ink-soft">{assignMsg}</p>
                ) : null}
              </div>

              <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="mt-1 h-16 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              />
              <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Feedback
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className="mt-1 h-20 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
              />
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveReview(false)}
                  className="w-full rounded-lg bg-accent px-3 py-2.5 text-sm font-semibold text-white hover:bg-accent-deep disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save review"}
                </button>
                {inQueue ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => saveReview(true)}
                      className="w-full rounded-lg border border-accent px-3 py-2.5 text-sm font-semibold text-accent hover:bg-wash disabled:opacity-60"
                    >
                      Save & next
                    </button>
                    <button
                      type="button"
                      onClick={advanceQueue}
                      className="w-full rounded-lg border border-line px-3 py-2 text-sm font-semibold text-ink-soft hover:bg-wash"
                    >
                      Skip
                    </button>
                  </>
                ) : null}
              </div>
              {savedMsg ? (
                <p className="mt-2 text-center text-xs text-ink-soft">{savedMsg}</p>
              ) : null}
            </div>
          ) : call.manager_feedback ? (
            <div className="border-b border-line bg-white/90 px-4 py-4">
              <h2 className="font-display text-xl text-ink">Manager feedback</h2>
              <p className="mt-2 text-sm text-ink-soft">{call.manager_feedback}</p>
            </div>
          ) : null}

          <div className="border-b border-line px-5 py-3">
            <h2 className="font-display text-lg text-ink">Audit checklist</h2>
            <p className="text-sm text-ink-soft">
              Click a fail to jump to the moment and scrub audio.
              {call.topic
                ? ` Scored for ${call.topic} (topic-specific rules only).`
                : ""}
            </p>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {rules.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No rule results yet.
                {isAdmin
                  ? " Use Re-analyze above to score with the current rules."
                  : ""}
              </p>
            ) : (
              rules.map((r) => {
                const passed = !!r.passed;
                return (
                  <button
                    key={r.rule_id}
                    type="button"
                    onClick={() =>
                      jumpToTurn(r.evidence_turn_index ?? null, r.evidence_timestamp)
                    }
                    className={`w-full rounded-xl border px-3 py-3 text-left transition hover:shadow-soft ${
                      passed ? "border-emerald-200 bg-white" : "border-red-200 bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          passed ? "bg-emerald-100 text-pass" : "bg-red-100 text-fail"
                        }`}
                      >
                        {passed ? "PASS" : "FAIL"}
                      </span>
                      <span className="text-[11px] uppercase tracking-wide text-ink-soft">
                        {r.category}
                      </span>
                    </div>
                    <div className="mt-1 font-semibold text-ink">{r.label}</div>
                    {r.score_1_to_10 != null ? (
                      <div className="text-xs text-ink-soft">{r.score_1_to_10}/10</div>
                    ) : null}
                    <p className="mt-2 line-clamp-3 text-sm text-ink-soft">
                      {r.evidence || r.notes || "—"}
                    </p>
                    {r.evidence_timestamp ? (
                      <div className="mt-2 text-xs font-semibold text-accent">
                        Jump · {r.evidence_timestamp}
                      </div>
                    ) : null}
                  </button>
                );
              })
            )}
            {failed.length > 0 ? (
              <p className="pt-2 text-xs text-ink-soft">
                {failed.length} failed rule{failed.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function CallReview(props: Props) {
  return (
    <Suspense fallback={<div className="p-8 text-ink-soft">Loading review…</div>}>
      <CallReviewInner {...props} />
    </Suspense>
  );
}

function ScorePill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-white px-3 py-2 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </div>
      <div className="text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

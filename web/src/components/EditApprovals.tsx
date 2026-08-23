"use client";

import { useState } from "react";
import type { TimeEntryEditRequest, TimeClockSettings } from "@/lib/timeClockTypes";
import { formatDateTime } from "@/lib/timeClockFormat";

type Props = {
  initialRequests: TimeEntryEditRequest[];
  settings: TimeClockSettings;
};

export function EditApprovals({ initialRequests, settings }: Props) {
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  async function review(requestId: string, approve: boolean) {
    setBusyId(requestId);
    setMsg("");
    try {
      const res = await fetch("/api/time-clock/edit-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: approve ? "approve" : "reject",
          request_id: requestId,
          review_notes: notes[requestId] || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      setRequests((prev) => prev.filter((r) => r.id !== requestId));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusyId(null);
    }
  }

  if (!requests.length) {
    return (
      <p className="rounded-xl border border-dashed border-line bg-white/60 px-4 py-8 text-center text-sm text-ink-soft">
        No pending edit requests.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {msg ? <p className="text-sm text-fail">{msg}</p> : null}
      {requests.map((request) => (
        <div key={request.id} className="rounded-xl border border-line bg-white/90 p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">
                {request.requester_name || request.requested_by}
              </p>
              <p className="text-sm text-ink-soft">{request.reason || "No reason provided"}</p>
            </div>
            <p className="text-xs text-ink-soft">
              Submitted {formatDateTime(request.created_at, settings.timezone)}
            </p>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-lg bg-wash/50 p-3 text-sm">
              <p className="font-semibold text-ink-soft">Current</p>
              <p>
                {formatDateTime(request.original_clock_in, settings.timezone)} →{" "}
                {formatDateTime(request.original_clock_out, settings.timezone)}
              </p>
              <p className="mt-1 text-ink-soft">{request.original_notes || "—"}</p>
            </div>
            <div className="rounded-lg border border-accent/20 bg-white p-3 text-sm">
              <p className="font-semibold text-accent">Proposed</p>
              <p>
                {formatDateTime(request.proposed_clock_in, settings.timezone)} →{" "}
                {formatDateTime(request.proposed_clock_out, settings.timezone)}
              </p>
              <p className="mt-1 text-ink-soft">{request.proposed_notes || "—"}</p>
            </div>
          </div>

          <textarea
            value={notes[request.id] || ""}
            onChange={(e) =>
              setNotes((prev) => ({ ...prev, [request.id]: e.target.value }))
            }
            placeholder="Optional review note"
            rows={2}
            className="mt-3 w-full rounded-lg border border-line px-3 py-2 text-sm"
          />

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busyId === request.id}
              onClick={() => review(request.id, true)}
              className="rounded-lg bg-pass px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={busyId === request.id}
              onClick={() => review(request.id, false)}
              className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-fail disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

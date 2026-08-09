"use client";

import { useMemo } from "react";
import type { AccessAuditEvent } from "@/lib/accessAuditTypes";

const ACTION_LABELS: Record<string, string> = {
  "contract.view": "Viewed",
  "contract.update": "Updated",
  "contract.upload": "Uploaded",
  "contract.download": "Downloaded PDF",
  "contract.delete": "Deleted",
  "contract.reprocess": "Re-ran Bedrock",
  "contract.accept": "Accepted extraction",
  "contract.family_link": "Linked related agreement",
  "contract.family_unlink": "Unlinked from family",
  "contract.obligation_upsert": "Updated obligation",
  "contract.obligation_delete": "Deleted obligation",
};

function formatWhen(value?: string) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function summarize(event: AccessAuditEvent): string {
  const meta = event.metadata || {};
  if (event.action === "contract.update" && meta.changes && typeof meta.changes === "object") {
    const keys = Object.keys(meta.changes as object);
    if (keys.length) return keys.join(", ");
  }
  if (event.action === "contract.download") {
    return String(meta.filename || meta.title || "");
  }
  if (event.action === "contract.obligation_upsert") {
    return `${meta.kind || "obligation"} · ${meta.status || ""}`.trim();
  }
  if (event.action === "contract.family_link") {
    return String(meta.family_name || "");
  }
  return "";
}

export function ContractAuditPanel({ events }: { events: AccessAuditEvent[] }) {
  const rows = useMemo(() => events, [events]);
  return (
    <section className="rounded-2xl border border-line bg-white/80 p-4">
      <h2 className="font-semibold text-ink">Audit trail</h2>
      <p className="mt-1 text-xs text-ink-soft">
        Who changed dates, linked files, or downloaded the PDF.
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">No activity recorded yet.</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {rows.map((event) => (
            <li key={event.id} className="border-l-2 border-line pl-3">
              <div className="text-sm font-semibold text-ink">
                {ACTION_LABELS[event.action] || event.action}
              </div>
              <div className="text-xs text-ink-soft">
                {event.actor_email || "Unknown"} · {formatWhen(event.occurred_at)}
              </div>
              {summarize(event) ? (
                <div className="mt-1 text-xs text-ink-soft">{summarize(event)}</div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

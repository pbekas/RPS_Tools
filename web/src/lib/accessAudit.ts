import "server-only";

import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";
import type { AccessAuditEvent } from "@/lib/accessAuditTypes";

export type { AccessAuditEvent };

export function clientIpFromRequest(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  const raw = (
    forwarded?.split(",")[0] ||
    req.headers.get("x-real-ip") ||
    ""
  ).trim();
  if (!raw) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(raw)) return raw.split(":")[0] || null;
  return raw;
}

function serializeEvent(row: QueryResultRow): AccessAuditEvent {
  const occurred = row.occurred_at;
  return {
    id: String(row.id),
    actor_email: row.actor_email ? String(row.actor_email) : null,
    action: String(row.action),
    resource_type: String(row.resource_type),
    resource_id: String(row.resource_id),
    request_id: row.request_id ? String(row.request_id) : null,
    source_ip: row.source_ip != null ? String(row.source_ip) : null,
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : {},
    occurred_at:
      occurred instanceof Date ? occurred.toISOString() : String(occurred || ""),
  };
}

export async function writeAccessAudit(input: {
  actorEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  sourceIp?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const metadata = JSON.stringify(input.metadata || {});
  const attempts = [input.sourceIp || null, null];
  let lastError: unknown;
  for (const ip of attempts) {
    try {
      await query(
        `INSERT INTO access_audit (
           actor_email, action, resource_type, resource_id, source_ip, metadata
         ) VALUES ($1, $2, $3, $4, $5::inet, $6::jsonb)`,
        [
          input.actorEmail || null,
          input.action,
          input.resourceType,
          input.resourceId,
          ip,
          metadata,
        ]
      );
      return;
    } catch (err) {
      lastError = err;
    }
  }
  console.error("access_audit write failed", lastError);
}

export async function listResourceAudit(input: {
  resourceType: string;
  resourceId: string;
  limit?: number;
}): Promise<AccessAuditEvent[]> {
  const limit = Math.min(Math.max(input.limit ?? 80, 1), 200);
  const rows = await query(
    `SELECT id, actor_email, action, resource_type, resource_id, request_id,
            source_ip::text AS source_ip, metadata, occurred_at
     FROM access_audit
     WHERE resource_type = $1 AND resource_id = $2
     ORDER BY occurred_at DESC
     LIMIT $3`,
    [input.resourceType, input.resourceId, limit]
  );
  return rows.map(serializeEvent);
}

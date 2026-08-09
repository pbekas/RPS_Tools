export type AccessAuditEvent = {
  id: string;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  request_id?: string | null;
  source_ip?: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
};

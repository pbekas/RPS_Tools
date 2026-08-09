import "server-only";

import { randomUUID } from "crypto";
import type { QueryResultRow } from "pg";
import { query } from "@/lib/postgres";

const usePostgres = () => process.env.DB_BACKEND?.trim().toLowerCase() === "postgres";

function requirePostgres() {
  if (!usePostgres()) {
    throw new Error("Contracts module requires DB_BACKEND=postgres");
  }
}

const NUMERIC_FIELDS = new Set([
  "cost_amount",
  "extraction_confidence",
  "notice_period_days",
  "sort_order",
  "version",
  "byte_size",
]);

function serializePgValue(value: unknown, key = ""): unknown {
  if (value == null) return value;
  if (value instanceof Date) {
    if (key.endsWith("_date") || key === "effective_date" || key === "term_end_date" || key === "expiration_date" || key === "next_payment_date") {
      return value.toISOString().slice(0, 10);
    }
    return value.toISOString();
  }
  if (Array.isArray(value)) return value.map((item) => serializePgValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        serializePgValue(child, childKey),
      ])
    );
  }
  if (NUMERIC_FIELDS.has(key) && typeof value === "string") {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  return value;
}

function serializeRow<T>(row: QueryResultRow): T {
  return serializePgValue(row) as T;
}

export type ContractGroup = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type Vendor = {
  id: string;
  name: string;
  notes?: string;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  contact_count?: number;
  contract_count?: number;
};

export type VendorContact = {
  id: string;
  vendor_id: string;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  is_primary?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ContractStatus =
  | "pending"
  | "processing"
  | "needs_review"
  | "active"
  | "expired"
  | "terminated"
  | "error";

export type CostFrequency = "monthly" | "annual" | "one_time" | "unknown";

export type Contract = {
  id: string;
  title: string;
  vendor_id?: string | null;
  group_id?: string | null;
  effective_date?: string | null;
  has_defined_term?: boolean;
  term_end_date?: string | null;
  expiration_date?: string | null;
  notice_period_days?: number | null;
  auto_renews?: boolean;
  cost_amount?: number | null;
  cost_currency?: string;
  cost_frequency?: CostFrequency;
  next_payment_date?: string | null;
  cost_notes?: string;
  summary?: string;
  status: ContractStatus;
  s3_key?: string;
  s3_uri?: string;
  original_filename?: string;
  content_type?: string;
  extracted_json?: Record<string, unknown>;
  extraction_confidence?: number | null;
  extracted_text?: string;
  error_message?: string | null;
  created_by?: string | null;
  deleted_at?: string | null;
  created_at?: string;
  updated_at?: string;
  vendor_name?: string | null;
  group_name?: string | null;
  group_slug?: string | null;
};

export type ContractDocument = {
  id: string;
  contract_id: string;
  version: number;
  s3_key: string;
  s3_uri?: string;
  original_filename?: string;
  content_type?: string;
  byte_size?: number | null;
  is_primary?: boolean;
  uploaded_by?: string | null;
  created_at?: string;
};

export type ContractListFilters = {
  q?: string;
  groupId?: string;
  vendorId?: string;
  status?: string;
  expiringSoon?: boolean;
  needsReview?: boolean;
  limit?: number;
  offset?: number;
};

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

function toDateOrNull(value: unknown): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function toNumberOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (value == null) return fallback;
  const s = String(value).toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

export async function listContractGroups(): Promise<ContractGroup[]> {
  requirePostgres();
  const rows = await query(
    "SELECT * FROM contract_groups ORDER BY sort_order ASC, name ASC"
  );
  return rows.map((row) => serializeRow<ContractGroup>(row));
}

export async function upsertContractGroup(input: {
  id?: string;
  name: string;
  slug?: string;
  sort_order?: number;
}): Promise<ContractGroup> {
  requirePostgres();
  const name = input.name.trim();
  if (!name) throw new Error("Group name is required");
  const slug =
    (input.slug || name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "group";
  const sortOrder = input.sort_order ?? 50;
  if (input.id) {
    const rows = await query(
      `UPDATE contract_groups
       SET name = $2, slug = $3, sort_order = $4, updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [input.id, name, slug, sortOrder]
    );
    if (!rows[0]) throw new Error("Group not found");
    return serializeRow<ContractGroup>(rows[0]);
  }
  const rows = await query(
    `INSERT INTO contract_groups (name, slug, sort_order)
     VALUES ($1, $2, $3)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       sort_order = EXCLUDED.sort_order,
       updated_at = now()
     RETURNING *`,
    [name, slug, sortOrder]
  );
  return serializeRow<ContractGroup>(rows[0]);
}

export async function deleteContractGroup(id: string): Promise<void> {
  requirePostgres();
  await query("UPDATE contracts SET group_id = NULL WHERE group_id = $1", [id]);
  await query("DELETE FROM contract_groups WHERE id = $1", [id]);
}

export async function listVendors(input?: {
  q?: string;
  activeOnly?: boolean;
}): Promise<Vendor[]> {
  requirePostgres();
  const params: unknown[] = [];
  const where: string[] = [];
  if (input?.activeOnly !== false) {
    where.push("v.active = true");
  }
  if (input?.q?.trim()) {
    params.push(`%${input.q.trim().toLowerCase()}%`);
    where.push(`lower(v.name) LIKE $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = await query(
    `SELECT v.*,
            (SELECT count(*)::int FROM vendor_contacts c WHERE c.vendor_id = v.id) AS contact_count,
            (SELECT count(*)::int FROM contracts ct
              WHERE ct.vendor_id = v.id AND ct.deleted_at IS NULL) AS contract_count
     FROM vendors v
     ${whereSql}
     ORDER BY v.name ASC
     LIMIT 500`,
    params
  );
  return rows.map((row) => serializeRow<Vendor>(row));
}

export async function getVendor(id: string): Promise<Vendor | null> {
  requirePostgres();
  const rows = await query("SELECT * FROM vendors WHERE id = $1 LIMIT 1", [id]);
  return rows[0] ? serializeRow<Vendor>(rows[0]) : null;
}

export async function upsertVendor(input: {
  id?: string;
  name: string;
  notes?: string;
  active?: boolean;
}): Promise<Vendor> {
  requirePostgres();
  const name = input.name.trim();
  if (!name) throw new Error("Vendor name is required");
  if (input.id) {
    const rows = await query(
      `UPDATE vendors
       SET name = $2,
           notes = COALESCE($3, notes),
           active = COALESCE($4, active),
           updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [input.id, name, input.notes ?? null, input.active ?? null]
    );
    if (!rows[0]) throw new Error("Vendor not found");
    return serializeRow<Vendor>(rows[0]);
  }
  const rows = await query(
    `INSERT INTO vendors (name, notes, active)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, input.notes || "", input.active ?? true]
  );
  return serializeRow<Vendor>(rows[0]);
}

export async function findVendorByName(name: string): Promise<Vendor | null> {
  requirePostgres();
  const cleaned = name.trim().toLowerCase();
  if (!cleaned) return null;
  const rows = await query(
    `SELECT * FROM vendors
     WHERE lower(name) = $1 OR lower(name) LIKE $2
     ORDER BY CASE WHEN lower(name) = $1 THEN 0 ELSE 1 END, name
     LIMIT 1`,
    [cleaned, `%${cleaned}%`]
  );
  return rows[0] ? serializeRow<Vendor>(rows[0]) : null;
}

export async function listVendorContacts(vendorId: string): Promise<VendorContact[]> {
  requirePostgres();
  const rows = await query(
    `SELECT * FROM vendor_contacts
     WHERE vendor_id = $1
     ORDER BY is_primary DESC, name ASC`,
    [vendorId]
  );
  return rows.map((row) => serializeRow<VendorContact>(row));
}

export async function upsertVendorContact(input: {
  id?: string;
  vendor_id: string;
  name: string;
  email?: string;
  phone?: string;
  title?: string;
  is_primary?: boolean;
}): Promise<VendorContact> {
  requirePostgres();
  const name = input.name.trim();
  if (!name) throw new Error("Contact name is required");
  if (input.is_primary) {
    await query(
      "UPDATE vendor_contacts SET is_primary = false WHERE vendor_id = $1",
      [input.vendor_id]
    );
  }
  if (input.id) {
    const rows = await query(
      `UPDATE vendor_contacts
       SET name = $2,
           email = $3,
           phone = $4,
           title = $5,
           is_primary = COALESCE($6, is_primary),
           updated_at = now()
       WHERE id = $1 AND vendor_id = $7
       RETURNING *`,
      [
        input.id,
        name,
        input.email || "",
        input.phone || "",
        input.title || "",
        input.is_primary ?? null,
        input.vendor_id,
      ]
    );
    if (!rows[0]) throw new Error("Contact not found");
    return serializeRow<VendorContact>(rows[0]);
  }
  const rows = await query(
    `INSERT INTO vendor_contacts (vendor_id, name, email, phone, title, is_primary)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.vendor_id,
      name,
      input.email || "",
      input.phone || "",
      input.title || "",
      !!input.is_primary,
    ]
  );
  return serializeRow<VendorContact>(rows[0]);
}

export async function deleteVendorContact(id: string): Promise<void> {
  requirePostgres();
  await query("DELETE FROM vendor_contacts WHERE id = $1", [id]);
}

export async function listContracts(
  filters: ContractListFilters = {}
): Promise<{ contracts: Contract[]; total: number }> {
  requirePostgres();
  const params: unknown[] = [];
  const where: string[] = ["c.deleted_at IS NULL"];

  if (filters.q?.trim()) {
    params.push(`%${filters.q.trim().toLowerCase()}%`);
    where.push(
      `(lower(c.title) LIKE $${params.length}
        OR lower(coalesce(v.name, '')) LIKE $${params.length}
        OR lower(coalesce(c.original_filename, '')) LIKE $${params.length})`
    );
  }
  if (filters.groupId) {
    params.push(filters.groupId);
    where.push(`c.group_id = $${params.length}`);
  }
  if (filters.vendorId) {
    params.push(filters.vendorId);
    where.push(`c.vendor_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    where.push(`c.status = $${params.length}`);
  }
  if (filters.needsReview) {
    where.push(`c.status = 'needs_review'`);
  }
  if (filters.expiringSoon) {
    where.push(
      `c.status = 'active'
       AND LEAST(
         COALESCE(c.expiration_date, '9999-12-31'::date),
         COALESCE(c.term_end_date, '9999-12-31'::date)
       ) <= (CURRENT_DATE + INTERVAL '90 days')
       AND LEAST(
         COALESCE(c.expiration_date, '9999-12-31'::date),
         COALESCE(c.term_end_date, '9999-12-31'::date)
       ) >= CURRENT_DATE`
    );
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  const offset = Math.max(filters.offset ?? 0, 0);
  params.push(limit, offset);

  const countRows = await query(
    `SELECT count(*)::int AS total
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     ${whereSql}`,
    params.slice(0, -2)
  );
  const rows = await query(
    `SELECT c.*,
            v.name AS vendor_name,
            g.name AS group_name,
            g.slug AS group_slug
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_groups g ON g.id = c.group_id
     ${whereSql}
     ORDER BY c.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    contracts: rows.map((row) => serializeRow<Contract>(row)),
    total: Number(countRows[0]?.total || 0),
  };
}

export async function getContract(id: string): Promise<Contract | null> {
  requirePostgres();
  const rows = await query(
    `SELECT c.*,
            v.name AS vendor_name,
            g.name AS group_name,
            g.slug AS group_slug
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_groups g ON g.id = c.group_id
     WHERE c.id = $1 AND c.deleted_at IS NULL
     LIMIT 1`,
    [id]
  );
  return rows[0] ? serializeRow<Contract>(rows[0]) : null;
}

export async function createContractUpload(input: {
  id?: string;
  original_filename: string;
  content_type: string;
  s3_key: string;
  s3_uri: string;
  created_by?: string | null;
  byte_size?: number;
}): Promise<Contract> {
  requirePostgres();
  const id = input.id || randomUUID();
  const title =
    input.original_filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ||
    "Untitled contract";
  const rows = await query(
    `INSERT INTO contracts (
       id, title, status, s3_key, s3_uri, original_filename, content_type, created_by
     ) VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      title,
      input.s3_key,
      input.s3_uri,
      input.original_filename,
      input.content_type || "application/pdf",
      input.created_by || null,
    ]
  );
  await query(
    `INSERT INTO contract_documents (
       contract_id, version, s3_key, s3_uri, original_filename, content_type, byte_size, is_primary, uploaded_by
     ) VALUES ($1, 1, $2, $3, $4, $5, $6, true, $7)`,
    [
      id,
      input.s3_key,
      input.s3_uri,
      input.original_filename,
      input.content_type || "application/pdf",
      input.byte_size ?? null,
      input.created_by || null,
    ]
  );
  return serializeRow<Contract>(rows[0]);
}

export async function updateContract(
  id: string,
  patch: Partial<Contract> & { accept_review?: boolean }
): Promise<Contract> {
  requirePostgres();
  const existing = await getContract(id);
  if (!existing) throw new Error("Contract not found");

  let status = patch.status ?? existing.status;
  if (patch.accept_review && existing.status === "needs_review") {
    status = "active";
  }

  const rows = await query(
    `UPDATE contracts SET
       title = COALESCE($2, title),
       vendor_id = CASE WHEN $3::boolean THEN $4::uuid ELSE vendor_id END,
       group_id = CASE WHEN $5::boolean THEN $6::uuid ELSE group_id END,
       effective_date = CASE WHEN $7::boolean THEN $8::date ELSE effective_date END,
       has_defined_term = COALESCE($9, has_defined_term),
       term_end_date = CASE WHEN $10::boolean THEN $11::date ELSE term_end_date END,
       expiration_date = CASE WHEN $12::boolean THEN $13::date ELSE expiration_date END,
       notice_period_days = CASE WHEN $14::boolean THEN $15::int ELSE notice_period_days END,
       auto_renews = COALESCE($16, auto_renews),
       cost_amount = CASE WHEN $17::boolean THEN $18::numeric ELSE cost_amount END,
       cost_currency = COALESCE($19, cost_currency),
       cost_frequency = COALESCE($20, cost_frequency),
       next_payment_date = CASE WHEN $21::boolean THEN $22::date ELSE next_payment_date END,
       cost_notes = COALESCE($23, cost_notes),
       summary = COALESCE($24, summary),
       status = COALESCE($25, status),
       updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [
      id,
      patch.title != null ? String(patch.title) : null,
      Object.prototype.hasOwnProperty.call(patch, "vendor_id"),
      emptyToNull(patch.vendor_id as string | null | undefined),
      Object.prototype.hasOwnProperty.call(patch, "group_id"),
      emptyToNull(patch.group_id as string | null | undefined),
      Object.prototype.hasOwnProperty.call(patch, "effective_date"),
      toDateOrNull(patch.effective_date),
      patch.has_defined_term != null ? toBool(patch.has_defined_term) : null,
      Object.prototype.hasOwnProperty.call(patch, "term_end_date"),
      toDateOrNull(patch.term_end_date),
      Object.prototype.hasOwnProperty.call(patch, "expiration_date"),
      toDateOrNull(patch.expiration_date),
      Object.prototype.hasOwnProperty.call(patch, "notice_period_days"),
      toNumberOrNull(patch.notice_period_days),
      patch.auto_renews != null ? toBool(patch.auto_renews) : null,
      Object.prototype.hasOwnProperty.call(patch, "cost_amount"),
      toNumberOrNull(patch.cost_amount),
      patch.cost_currency != null ? String(patch.cost_currency) : null,
      patch.cost_frequency != null ? String(patch.cost_frequency) : null,
      Object.prototype.hasOwnProperty.call(patch, "next_payment_date"),
      toDateOrNull(patch.next_payment_date),
      patch.cost_notes != null ? String(patch.cost_notes) : null,
      patch.summary != null ? String(patch.summary) : null,
      status,
    ]
  );
  if (!rows[0]) throw new Error("Contract not found");
  const updated = await getContract(id);
  if (!updated) throw new Error("Contract not found");
  return updated;
}

export async function softDeleteContract(id: string): Promise<void> {
  requirePostgres();
  await query(
    `UPDATE contracts
     SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
}

export async function markContractForReprocess(id: string): Promise<Contract> {
  requirePostgres();
  const rows = await query(
    `UPDATE contracts
     SET status = 'pending',
         error_message = NULL,
         updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id]
  );
  if (!rows[0]) throw new Error("Contract not found");
  return serializeRow<Contract>(rows[0]);
}

export async function acceptContractsReview(ids?: string[]): Promise<number> {
  requirePostgres();
  if (ids?.length) {
    const rows = await query(
      `UPDATE contracts
       SET status = 'active', updated_at = now()
       WHERE deleted_at IS NULL
         AND status = 'needs_review'
         AND id = ANY($1::uuid[])
       RETURNING id`,
      [ids]
    );
    return rows.length;
  }
  const rows = await query(
    `UPDATE contracts
     SET status = 'active', updated_at = now()
     WHERE deleted_at IS NULL AND status = 'needs_review'
     RETURNING id`
  );
  return rows.length;
}

import "server-only";

import { randomUUID } from "crypto";
import type { QueryResultRow } from "pg";
import { query, withTransaction } from "@/lib/postgres";
import type {
  Contract,
  ContractAssignee,
  ContractEntity,
  ContractFamily,
  ContractGroup,
  ContractListFilters,
  ContractObligation,
  FamilyRole,
  ObligationKind,
  ObligationStatus,
  Vendor,
  VendorContact,
  VendorDocKind,
  VendorDocument,
} from "@/lib/contractTypes";
import {
  CONTRACT_STATUSES,
  FAMILY_ROLES,
  OBLIGATION_KINDS,
  OBLIGATION_STATUSES,
  VENDOR_DOC_KINDS,
} from "@/lib/contractTypes";

export type {
  Contract,
  ContractAssignee,
  ContractDocument,
  ContractEntity,
  ContractFamily,
  ContractGroup,
  ContractListFilters,
  ContractObligation,
  ContractStatus,
  CONTRACT_STATUSES,
  CostFrequency,
  FamilyRole,
  ObligationKind,
  ObligationStatus,
  Vendor,
  VendorContact,
  VendorDocKind,
  VendorDocument,
} from "@/lib/contractTypes";
export {
  FAMILY_ROLES,
  OBLIGATION_KINDS,
  OBLIGATION_STATUSES,
} from "@/lib/contractTypes";

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

export async function listContractEntities(input?: {
  activeOnly?: boolean;
}): Promise<ContractEntity[]> {
  requirePostgres();
  const where = input?.activeOnly === false ? "" : "WHERE e.active = true";
  const rows = await query(
    `SELECT e.*,
            (SELECT count(*)::int FROM contracts ct
              WHERE ct.entity_id = e.id AND ct.deleted_at IS NULL) AS contract_count
     FROM contract_entities e
     ${where}
     ORDER BY e.sort_order ASC, e.name ASC`
  );
  return rows.map((row) => serializeRow<ContractEntity>(row));
}

export async function upsertContractEntity(input: {
  id?: string;
  name: string;
  slug?: string;
  aliases?: string[];
  sort_order?: number;
  active?: boolean;
}): Promise<ContractEntity> {
  requirePostgres();
  const name = input.name.trim();
  if (!name) throw new Error("Company name is required");
  const slug =
    (input.slug || name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "company";
  const aliases = (input.aliases || [])
    .map((a) => String(a).trim())
    .filter(Boolean);
  const sortOrder = input.sort_order ?? 50;
  if (input.id) {
    const rows = await query(
      `UPDATE contract_entities
       SET name = $2, slug = $3, aliases = $4, sort_order = $5,
           active = COALESCE($6, active), updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [input.id, name, slug, aliases, sortOrder, input.active ?? null]
    );
    if (!rows[0]) throw new Error("Company not found");
    return serializeRow<ContractEntity>(rows[0]);
  }
  const rows = await query(
    `INSERT INTO contract_entities (name, slug, aliases, sort_order, active)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       aliases = EXCLUDED.aliases,
       sort_order = EXCLUDED.sort_order,
       active = EXCLUDED.active,
       updated_at = now()
     RETURNING *`,
    [name, slug, aliases, sortOrder, input.active ?? true]
  );
  return serializeRow<ContractEntity>(rows[0]);
}

export async function deleteContractEntity(id: string): Promise<void> {
  requirePostgres();
  await query("UPDATE contracts SET entity_id = NULL WHERE entity_id = $1", [id]);
  await query("DELETE FROM contract_entities WHERE id = $1", [id]);
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
              WHERE ct.vendor_id = v.id AND ct.deleted_at IS NULL) AS contract_count,
            (SELECT count(*)::int FROM vendor_documents d WHERE d.vendor_id = v.id) AS document_count
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
  const rows = await query(
    `SELECT v.*,
            (SELECT count(*)::int FROM vendor_contacts c WHERE c.vendor_id = v.id) AS contact_count,
            (SELECT count(*)::int FROM contracts ct
              WHERE ct.vendor_id = v.id AND ct.deleted_at IS NULL) AS contract_count,
            (SELECT count(*)::int FROM vendor_documents d WHERE d.vendor_id = v.id) AS document_count
     FROM vendors v
     WHERE v.id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] ? serializeRow<Vendor>(rows[0]) : null;
}

export async function deleteVendor(id: string): Promise<void> {
  requirePostgres();
  const vendor = await getVendor(id);
  if (!vendor) throw new Error("Vendor not found");
  const rows = await query(
    `SELECT
       (SELECT count(*)::int FROM contracts WHERE vendor_id = $1) AS contracts,
       (SELECT count(*)::int FROM vendor_contacts WHERE vendor_id = $1) AS contacts,
       (SELECT count(*)::int FROM vendor_documents WHERE vendor_id = $1) AS documents`,
    [id]
  );
  const contracts = Number(rows[0]?.contracts || 0);
  const contacts = Number(rows[0]?.contacts || 0);
  const documents = Number(rows[0]?.documents || 0);
  if (contracts || contacts || documents) {
    const parts: string[] = [];
    if (contracts) {
      parts.push(`${contracts} contract${contracts === 1 ? "" : "s"}`);
    }
    if (contacts) {
      parts.push(`${contacts} contact${contacts === 1 ? "" : "s"}`);
    }
    if (documents) {
      parts.push(`${documents} file${documents === 1 ? "" : "s"}`);
    }
    throw new Error(`Remove ${parts.join(", ")} before deleting this vendor.`);
  }
  await query("DELETE FROM vendors WHERE id = $1", [id]);
}

export async function mergeVendors(keepId: string, absorbId: string): Promise<Vendor> {
  requirePostgres();
  if (!keepId || !absorbId) throw new Error("Both vendors are required");
  if (keepId === absorbId) throw new Error("Choose a different vendor to merge");
  const keep = await getVendor(keepId);
  const absorb = await getVendor(absorbId);
  if (!keep || !absorb) throw new Error("Vendor not found");

  await withTransaction(async (client) => {
    await client.query(
      "UPDATE contracts SET vendor_id = $1, updated_at = now() WHERE vendor_id = $2",
      [keepId, absorbId]
    );
    await client.query(
      `UPDATE vendor_contacts
       SET is_primary = false, vendor_id = $1, updated_at = now()
       WHERE vendor_id = $2`,
      [keepId, absorbId]
    );
    await client.query(
      "UPDATE vendor_documents SET vendor_id = $1 WHERE vendor_id = $2",
      [keepId, absorbId]
    );
    const notes = [keep.notes?.trim(), absorb.notes?.trim()]
      .filter(Boolean)
      .join("\n\n");
    await client.query(
      `UPDATE vendors
       SET notes = $2, updated_at = now()
       WHERE id = $1`,
      [keepId, notes]
    );
    await client.query("DELETE FROM vendors WHERE id = $1", [absorbId]);
  });

  const merged = await getVendor(keepId);
  if (!merged) throw new Error("Vendor not found");
  return merged;
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

function isVendorDocKind(value: string): value is VendorDocKind {
  return (VENDOR_DOC_KINDS as readonly string[]).includes(value);
}

export async function listVendorDocuments(vendorId: string): Promise<VendorDocument[]> {
  requirePostgres();
  const rows = await query(
    `SELECT * FROM vendor_documents
     WHERE vendor_id = $1
     ORDER BY created_at DESC`,
    [vendorId]
  );
  return rows.map((row) => serializeRow<VendorDocument>(row));
}

export async function getVendorDocument(id: string): Promise<VendorDocument | null> {
  requirePostgres();
  const rows = await query(
    "SELECT * FROM vendor_documents WHERE id = $1 LIMIT 1",
    [id]
  );
  return rows[0] ? serializeRow<VendorDocument>(rows[0]) : null;
}

export async function createVendorDocument(input: {
  vendor_id: string;
  doc_kind?: string;
  title?: string;
  s3_key: string;
  s3_uri: string;
  original_filename: string;
  content_type?: string;
  byte_size?: number;
  uploaded_by?: string | null;
}): Promise<VendorDocument> {
  requirePostgres();
  const kind = input.doc_kind && isVendorDocKind(input.doc_kind) ? input.doc_kind : "other";
  const title =
    (input.title || "").trim() ||
    input.original_filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() ||
    kind.toUpperCase();
  const rows = await query(
    `INSERT INTO vendor_documents (
       vendor_id, doc_kind, title, s3_key, s3_uri, original_filename, content_type, byte_size, uploaded_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.vendor_id,
      kind,
      title,
      input.s3_key,
      input.s3_uri,
      input.original_filename,
      input.content_type || "application/pdf",
      input.byte_size ?? null,
      input.uploaded_by || null,
    ]
  );
  return serializeRow<VendorDocument>(rows[0]);
}

export async function deleteVendorDocument(id: string): Promise<void> {
  requirePostgres();
  await query("DELETE FROM vendor_documents WHERE id = $1", [id]);
}

const CONTRACT_LIST_COLUMNS = `
  c.id, c.title, c.vendor_id, c.entity_id, c.group_id, c.family_id, c.family_role,
  c.effective_date, c.has_defined_term, c.term_end_date, c.expiration_date,
  c.notice_period_days, c.auto_renews, c.cost_amount, c.cost_currency, c.cost_frequency,
  c.next_payment_date, c.cost_notes, c.summary, c.status, c.s3_key, c.s3_uri,
  c.original_filename, c.content_type, c.extraction_confidence, c.error_message,
  c.created_by, c.deleted_at, c.created_at, c.updated_at,
  v.name AS vendor_name,
  e.name AS entity_name,
  g.name AS group_name,
  g.slug AS group_slug,
  f.name AS family_name
`;

export async function listContracts(
  filters: ContractListFilters = {}
): Promise<{ contracts: Contract[]; total: number }> {
  requirePostgres();
  if (Array.isArray(filters.allowedGroupIds) && filters.allowedGroupIds.length === 0) {
    return { contracts: [], total: 0 };
  }
  const params: unknown[] = [];
  const where: string[] = ["c.deleted_at IS NULL"];
  const searchText = filters.q?.trim() || "";
  let searchParam = 0;
  let likeParam = 0;

  if (searchText) {
    params.push(searchText);
    searchParam = params.length;
    params.push(`%${searchText.toLowerCase()}%`);
    likeParam = params.length;
    where.push(
      `(c.search_tsv @@ plainto_tsquery('english', $${searchParam})
        OR lower(c.title) LIKE $${likeParam}
        OR lower(coalesce(v.name, '')) LIKE $${likeParam}
        OR lower(coalesce(e.name, '')) LIKE $${likeParam}
        OR lower(coalesce(f.name, '')) LIKE $${likeParam}
        OR lower(coalesce(c.original_filename, '')) LIKE $${likeParam}
        OR lower(coalesce(c.summary, '')) LIKE $${likeParam})`
    );
  }
  if (filters.groupId) {
    params.push(filters.groupId);
    where.push(`c.group_id = $${params.length}`);
  }
  if (filters.allowedGroupIds?.length) {
    params.push(filters.allowedGroupIds);
    where.push(`c.group_id = ANY($${params.length}::uuid[])`);
  }
  if (filters.vendorId) {
    params.push(filters.vendorId);
    where.push(`c.vendor_id = $${params.length}`);
  }
  if (filters.entityId) {
    params.push(filters.entityId);
    where.push(`c.entity_id = $${params.length}`);
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
  const snippetSql = searchParam
    ? `, ts_headline(
         'english',
         left(c.extracted_text, 20000),
         plainto_tsquery('english', $${searchParam}),
         'MaxWords=28, MinWords=10, ShortWord=2, MaxFragments=1'
       ) AS search_snippet`
    : `, NULL::text AS search_snippet`;
  const sortMap: Record<string, string> = {
    title: "lower(c.title)",
    entity: "lower(coalesce(e.name, ''))",
    vendor: "lower(coalesce(v.name, ''))",
    group: "lower(coalesce(g.name, ''))",
    effective: "c.effective_date",
    expires: "coalesce(c.expiration_date, c.term_end_date)",
    cost: "c.cost_amount",
    status: "c.status",
    created: "c.created_at",
  };
  const sortCol = sortMap[filters.sort || ""] || "";
  const sortDir = filters.dir === "asc" ? "ASC" : "DESC";
  let orderSql = "ORDER BY c.created_at DESC";
  if (sortCol) {
    orderSql = `ORDER BY ${sortCol} ${sortDir} NULLS LAST, c.created_at DESC`;
  } else if (searchParam) {
    orderSql = `ORDER BY ts_rank_cd(c.search_tsv, plainto_tsquery('english', $${searchParam})) DESC, c.created_at DESC`;
  }

  const countRows = await query(
    `SELECT count(*)::int AS total
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_entities e ON e.id = c.entity_id
     LEFT JOIN contract_families f ON f.id = c.family_id
     ${whereSql}`,
    params.slice(0, -2)
  );
  const rows = await query(
    `SELECT ${CONTRACT_LIST_COLUMNS}
            ${snippetSql}
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_entities e ON e.id = c.entity_id
     LEFT JOIN contract_groups g ON g.id = c.group_id
     LEFT JOIN contract_families f ON f.id = c.family_id
     ${whereSql}
     ${orderSql}
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
            e.name AS entity_name,
            g.name AS group_name,
            g.slug AS group_slug,
            f.name AS family_name
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_entities e ON e.id = c.entity_id
     LEFT JOIN contract_groups g ON g.id = c.group_id
     LEFT JOIN contract_families f ON f.id = c.family_id
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

export async function stampRenewalContract(
  newId: string,
  sourceId: string
): Promise<Contract> {
  requirePostgres();
  const source = await getContract(sourceId);
  if (!source) throw new Error("Source agreement not found");

  let familyId = source.family_id || null;
  if (!familyId) {
    const name = `${source.vendor_name || source.title || "Agreement"} family`;
    const created = await query(
      `INSERT INTO contract_families (name) VALUES ($1) RETURNING id`,
      [name]
    );
    familyId = String(created[0].id);
    await query(
      `UPDATE contracts
       SET family_id = $2,
           family_role = CASE
             WHEN family_role IS NULL OR family_role = 'standalone' THEN 'original'
             ELSE family_role
           END,
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [source.id, familyId]
    );
  }

  await query(
    `UPDATE contracts
     SET family_id = $2,
         family_role = 'renewal',
         vendor_id = COALESCE($3::uuid, vendor_id),
         entity_id = COALESCE($4::uuid, entity_id),
         group_id = COALESCE($5::uuid, group_id),
         updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [
      newId,
      familyId,
      source.vendor_id || null,
      source.entity_id || null,
      source.group_id || null,
    ]
  );

  if (
    source.status === "active" ||
    source.status === "needs_review" ||
    source.status === "pending" ||
    source.status === "processing"
  ) {
    await query(
      `UPDATE contracts
       SET status = 'expired', updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL`,
      [source.id]
    );
  }

  const updated = await getContract(newId);
  if (!updated) throw new Error("Renewal upload not found");
  return updated;
}

export async function findRelatedAgreementCandidates(
  contract: Contract,
  limit = 5
): Promise<Contract[]> {
  requirePostgres();
  if (contract.family_id) return [];
  const extracted = (contract.extracted_json || {}) as Record<string, unknown>;
  const hint = String(
    extracted.related_agreement_hint || extracted.related_agreement || ""
  )
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const role = String(contract.family_role || extracted.document_role || "");
  if (!hint && (!role || role === "standalone")) return [];

  const like = hint ? `%${hint.toLowerCase()}%` : "%";
  const cap = Math.min(Math.max(limit, 1), 12);
  const sql = `
    SELECT ${CONTRACT_LIST_COLUMNS}, NULL::text AS search_snippet
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_entities e ON e.id = c.entity_id
     LEFT JOIN contract_groups g ON g.id = c.group_id
     LEFT JOIN contract_families f ON f.id = c.family_id
     WHERE c.deleted_at IS NULL
       AND c.id <> $1
       AND (
         ($2 <> '' AND (
           c.search_tsv @@ plainto_tsquery('english', $2)
           OR lower(c.title) LIKE $3
           OR lower(coalesce(c.original_filename, '')) LIKE $3
           OR lower(coalesce(c.summary, '')) LIKE $3
         ))
         OR (
           $2 = ''
           AND c.vendor_id IS NOT NULL
           AND c.vendor_id = $4::uuid
         )
       )
     ORDER BY
       CASE WHEN c.vendor_id IS NOT NULL AND c.vendor_id = $4::uuid THEN 0 ELSE 1 END,
       CASE
         WHEN $2 <> '' AND c.search_tsv @@ plainto_tsquery('english', $2) THEN 0
         ELSE 1
       END,
       c.created_at DESC
     LIMIT $5`;
  const params = [contract.id, hint, like, contract.vendor_id || null, cap];
  try {
    const rows = await query(sql, params);
    return rows.map((row) => serializeRow<Contract>(row));
  } catch {
    return [];
  }
}

export async function updateContract(
  id: string,
  patch: Partial<Contract> & { accept_review?: boolean }
): Promise<Contract> {
  requirePostgres();
  const existing = await getContract(id);
  if (!existing) throw new Error("Contract not found");

  let status = patch.status ?? existing.status;
  if (patch.status && !(CONTRACT_STATUSES as readonly string[]).includes(patch.status)) {
    throw new Error("Invalid status");
  }
  if (patch.accept_review && existing.status === "needs_review") {
    status = "active";
  }

  const rows = await query(
    `UPDATE contracts SET
       title = COALESCE($2, title),
       vendor_id = CASE WHEN $3::boolean THEN $4::uuid ELSE vendor_id END,
       entity_id = CASE WHEN $26::boolean THEN $27::uuid ELSE entity_id END,
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
      Object.prototype.hasOwnProperty.call(patch, "entity_id"),
      emptyToNull(patch.entity_id as string | null | undefined),
    ]
  );
  if (!rows[0]) throw new Error("Contract not found");
  await syncDerivedObligations(id);
  const updated = await getContract(id);
  if (!updated) throw new Error("Contract not found");
  return updated;
}

export async function softDeleteContract(id: string): Promise<void> {
  requirePostgres();
  const rows = await query(
    `UPDATE contracts
     SET deleted_at = now(), updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [id]
  );
  if (!rows[0]) throw new Error("Contract not found");
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

function isObligationKind(value: string): value is ObligationKind {
  return (OBLIGATION_KINDS as readonly string[]).includes(value);
}

function isObligationStatus(value: string): value is ObligationStatus {
  return (OBLIGATION_STATUSES as readonly string[]).includes(value);
}

function isFamilyRole(value: string): value is FamilyRole {
  return (FAMILY_ROLES as readonly string[]).includes(value);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function earliestIsoDate(
  ...values: Array<string | null | undefined>
): string | null {
  const dates = values
    .map((value) => (value ? String(value).slice(0, 10) : ""))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!dates.length) return null;
  return dates.sort()[0];
}

export async function syncDerivedObligations(contractId: string): Promise<void> {
  requirePostgres();
  const contract = await getContract(contractId);
  if (!contract) return;
  const end = earliestIsoDate(contract.expiration_date, contract.term_end_date);
  const derived: Array<{
    kind: ObligationKind;
    title: string;
    due_date: string;
    notes: string;
  }> = [];
  if (end) {
    derived.push({
      kind: "expiration",
      title: "Expiration / term end",
      due_date: end,
      notes: "",
    });
    if (contract.notice_period_days != null && contract.notice_period_days >= 0) {
      const noticeDue = addDaysIso(end, -Number(contract.notice_period_days));
      derived.push({
        kind: "notice_window",
        title: `${contract.notice_period_days}-day notice deadline`,
        due_date: noticeDue,
        notes: "",
      });
      if (contract.auto_renews) {
        derived.push({
          kind: "auto_renew",
          title: "Auto-renewal decision",
          due_date: noticeDue,
          notes: "Give notice before this date to avoid auto-renewal.",
        });
      }
    } else if (contract.auto_renews) {
      derived.push({
        kind: "auto_renew",
        title: "Auto-renewal decision",
        due_date: end,
        notes: "",
      });
    }
  }
  const keep = derived.map((item) => item.kind);
  if (keep.length) {
    await query(
      `DELETE FROM contract_obligations
       WHERE contract_id = $1 AND source = 'derived' AND NOT (kind = ANY($2::text[]))`,
      [contractId, keep]
    );
  } else {
    await query(
      `DELETE FROM contract_obligations
       WHERE contract_id = $1 AND source = 'derived'`,
      [contractId]
    );
  }
  for (const item of derived) {
    await query(
      `INSERT INTO contract_obligations (
         contract_id, kind, title, due_date, notes, source, status
       ) VALUES ($1, $2, $3, $4, $5, 'derived', 'open')
       ON CONFLICT (contract_id, kind) WHERE source = 'derived'
       DO UPDATE SET
         title = EXCLUDED.title,
         due_date = EXCLUDED.due_date,
         notes = EXCLUDED.notes,
         updated_at = now()`,
      [contractId, item.kind, item.title, item.due_date, item.notes]
    );
  }
}

export async function listContractAssignees(): Promise<ContractAssignee[]> {
  requirePostgres();
  const rows = await query(
    `SELECT email::text AS email, coalesce(nullif(name, ''), email::text) AS name
     FROM users
     ORDER BY coalesce(nullif(name, ''), email::text), email
     LIMIT 300`
  );
  return rows.map((row) => ({
    email: String(row.email),
    name: String(row.name || row.email),
  }));
}

export type ObligationListFilters = {
  contractId?: string;
  kind?: string;
  entityId?: string;
  ownerEmail?: string;
  status?: "open" | "done" | "dismissed" | "snoozed" | "overdue" | "upcoming";
  from?: string;
  to?: string;
  allowedGroupIds?: string[] | null;
  limit?: number;
};

export async function listContractObligations(
  filters: ObligationListFilters = {}
): Promise<ContractObligation[]> {
  requirePostgres();
  if (Array.isArray(filters.allowedGroupIds) && filters.allowedGroupIds.length === 0) {
    return [];
  }
  const params: unknown[] = [];
  const where = ["ct.deleted_at IS NULL", "o.kind <> 'payment'"];
  if (filters.contractId) {
    params.push(filters.contractId);
    where.push(`o.contract_id = $${params.length}`);
  }
  if (filters.kind && isObligationKind(filters.kind)) {
    params.push(filters.kind);
    where.push(`o.kind = $${params.length}`);
  }
  if (filters.entityId) {
    params.push(filters.entityId);
    where.push(`ct.entity_id = $${params.length}`);
  }
  if (filters.allowedGroupIds?.length) {
    params.push(filters.allowedGroupIds);
    where.push(`ct.group_id = ANY($${params.length}::uuid[])`);
  }
  if (filters.ownerEmail) {
    params.push(filters.ownerEmail);
    where.push(`o.owner_email = $${params.length}`);
  }
  if (filters.status === "overdue") {
    where.push(`o.status = 'open' AND o.due_date < CURRENT_DATE`);
  } else if (filters.status === "upcoming") {
    where.push(`o.status = 'open' AND o.due_date >= CURRENT_DATE`);
  } else if (filters.status && isObligationStatus(filters.status)) {
    params.push(filters.status);
    where.push(`o.status = $${params.length}`);
  }
  const from = toDateOrNull(filters.from);
  if (from) {
    params.push(from);
    where.push(
      `(o.due_date IS NULL OR o.due_date >= $${params.length}::date)`
    );
  }
  const to = toDateOrNull(filters.to);
  if (to) {
    params.push(to);
    where.push(`o.due_date <= $${params.length}::date`);
  }
  const limit = Math.min(Math.max(filters.limit ?? 250, 1), 500);
  params.push(limit);
  const rows = await query(
    `SELECT o.*,
            u.name AS owner_name,
            ct.title AS contract_title,
            ct.entity_id,
            v.name AS vendor_name,
            e.name AS entity_name
     FROM contract_obligations o
     JOIN contracts ct ON ct.id = o.contract_id
     LEFT JOIN users u ON u.email = o.owner_email
     LEFT JOIN vendors v ON v.id = ct.vendor_id
     LEFT JOIN contract_entities e ON e.id = ct.entity_id
     WHERE ${where.join(" AND ")}
     ORDER BY o.due_date ASC NULLS LAST, o.created_at ASC
     LIMIT $${params.length}`,
    params
  );
  return rows.map((row) => serializeRow<ContractObligation>(row));
}

export async function upsertContractObligation(input: {
  id?: string;
  contract_id: string;
  kind: string;
  title?: string;
  due_date?: string | null;
  owner_email?: string | null;
  status?: string;
  notes?: string;
  source?: "extracted" | "derived" | "manual";
}): Promise<ContractObligation> {
  requirePostgres();
  const kind = isObligationKind(input.kind) ? input.kind : "other";
  const status = input.status && isObligationStatus(input.status) ? input.status : "open";
  const title = (input.title || "").trim() || kind.replace(/_/g, " ");
  const owner = emptyToNull(input.owner_email);
  const due = toDateOrNull(input.due_date);
  const notes = input.notes ?? "";
  if (input.id) {
    const rows = await query(
      `UPDATE contract_obligations
       SET kind = $2,
           title = $3,
           due_date = $4,
           owner_email = $5,
           status = $6,
           notes = $7,
           updated_at = now()
       WHERE id = $1 AND contract_id = $8
       RETURNING *`,
      [input.id, kind, title, due, owner, status, notes, input.contract_id]
    );
    if (!rows[0]) throw new Error("Obligation not found");
    return serializeRow<ContractObligation>(rows[0]);
  }
  const source = input.source || "manual";
  const rows = await query(
    `INSERT INTO contract_obligations (
       contract_id, kind, title, due_date, owner_email, status, notes, source
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [input.contract_id, kind, title, due, owner, status, notes, source]
  );
  return serializeRow<ContractObligation>(rows[0]);
}

export async function deleteContractObligation(
  id: string,
  contractId?: string
): Promise<void> {
  requirePostgres();
  if (contractId) {
    await query(
      "DELETE FROM contract_obligations WHERE id = $1 AND contract_id = $2",
      [id, contractId]
    );
    return;
  }
  await query("DELETE FROM contract_obligations WHERE id = $1", [id]);
}

export async function listFamilyMembers(familyId: string): Promise<Contract[]> {
  requirePostgres();
  const rows = await query(
    `SELECT ${CONTRACT_LIST_COLUMNS}, NULL::text AS search_snippet
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_entities e ON e.id = c.entity_id
     LEFT JOIN contract_groups g ON g.id = c.group_id
     LEFT JOIN contract_families f ON f.id = c.family_id
     WHERE c.deleted_at IS NULL AND c.family_id = $1
     ORDER BY
       CASE c.family_role
         WHEN 'original' THEN 0
         WHEN 'amendment' THEN 1
         WHEN 'addendum' THEN 2
         WHEN 'assignment' THEN 3
         WHEN 'sublease' THEN 4
         WHEN 'renewal' THEN 5
         ELSE 9
       END,
       c.effective_date ASC NULLS LAST,
       c.created_at ASC`,
    [familyId]
  );
  return rows.map((row) => serializeRow<Contract>(row));
}

export async function listVendorSiblingContracts(
  contractId: string,
  vendorId?: string | null
): Promise<Contract[]> {
  requirePostgres();
  if (!vendorId) return [];
  const rows = await query(
    `SELECT ${CONTRACT_LIST_COLUMNS}, NULL::text AS search_snippet
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_entities e ON e.id = c.entity_id
     LEFT JOIN contract_groups g ON g.id = c.group_id
     LEFT JOIN contract_families f ON f.id = c.family_id
     WHERE c.deleted_at IS NULL
       AND c.id <> $1
       AND c.vendor_id = $2
     ORDER BY c.created_at DESC
     LIMIT 12`,
    [contractId, vendorId]
  );
  return rows.map((row) => serializeRow<Contract>(row));
}

export async function searchContractsForLink(
  q: string,
  excludeId?: string
): Promise<Contract[]> {
  requirePostgres();
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const rows = await query(
    `SELECT ${CONTRACT_LIST_COLUMNS}, NULL::text AS search_snippet
     FROM contracts c
     LEFT JOIN vendors v ON v.id = c.vendor_id
     LEFT JOIN contract_entities e ON e.id = c.entity_id
     LEFT JOIN contract_groups g ON g.id = c.group_id
     LEFT JOIN contract_families f ON f.id = c.family_id
     WHERE c.deleted_at IS NULL
       AND ($2::uuid IS NULL OR c.id <> $2)
       AND (
         lower(c.title) LIKE $1
         OR lower(coalesce(v.name, '')) LIKE $1
         OR lower(coalesce(c.original_filename, '')) LIKE $1
       )
     ORDER BY c.created_at DESC
     LIMIT 12`,
    [`%${needle}%`, excludeId || null]
  );
  return rows.map((row) => serializeRow<Contract>(row));
}

export async function updateContractFamilyRole(
  contractId: string,
  role: string
): Promise<Contract> {
  requirePostgres();
  const familyRole = isFamilyRole(role) ? role : "standalone";
  const rows = await query(
    `UPDATE contracts
     SET family_role = $2, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING id`,
    [contractId, familyRole]
  );
  if (!rows[0]) throw new Error("Contract not found");
  const updated = await getContract(contractId);
  if (!updated) throw new Error("Contract not found");
  return updated;
}

export async function renameContractFamily(
  familyId: string,
  name: string
): Promise<ContractFamily> {
  requirePostgres();
  const cleaned = name.trim();
  if (!cleaned) throw new Error("Family name is required");
  const rows = await query(
    `UPDATE contract_families
     SET name = $2, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [familyId, cleaned]
  );
  if (!rows[0]) throw new Error("Family not found");
  return serializeRow<ContractFamily>(rows[0]);
}

export async function linkContractsIntoFamily(input: {
  contractId: string;
  otherContractId: string;
  thisRole?: string;
  otherRole?: string;
  familyName?: string;
}): Promise<{ family: ContractFamily; members: Contract[] }> {
  requirePostgres();
  if (input.contractId === input.otherContractId) {
    throw new Error("Choose a different agreement to link");
  }
  const left = await getContract(input.contractId);
  const right = await getContract(input.otherContractId);
  if (!left || !right) throw new Error("Contract not found");

  const leftRole = isFamilyRole(input.thisRole || "")
    ? input.thisRole!
    : left.family_role && left.family_role !== "standalone"
      ? left.family_role
      : "original";
  const rightRole = isFamilyRole(input.otherRole || "")
    ? input.otherRole!
    : right.family_role && right.family_role !== "standalone"
      ? right.family_role
      : "amendment";

  let familyId = left.family_id || right.family_id || null;
  if (left.family_id && right.family_id && left.family_id !== right.family_id) {
    await query(
      `UPDATE contracts SET family_id = $1, updated_at = now()
       WHERE family_id = $2 AND deleted_at IS NULL`,
      [left.family_id, right.family_id]
    );
    await query("DELETE FROM contract_families WHERE id = $1", [right.family_id]);
    familyId = left.family_id;
  }
  if (!familyId) {
    const name =
      (input.familyName || "").trim() ||
      `${left.vendor_name || left.title || "Agreement"} family`;
    const created = await query(
      `INSERT INTO contract_families (name) VALUES ($1) RETURNING *`,
      [name]
    );
    familyId = String(created[0].id);
  } else if (input.familyName?.trim()) {
    await query(
      `UPDATE contract_families SET name = $2, updated_at = now() WHERE id = $1`,
      [familyId, input.familyName.trim()]
    );
  }

  await query(
    `UPDATE contracts
     SET family_id = $2, family_role = $3, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [left.id, familyId, leftRole]
  );
  await query(
    `UPDATE contracts
     SET family_id = $2, family_role = $3, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [right.id, familyId, rightRole]
  );

  const familyRows = await query(
    "SELECT * FROM contract_families WHERE id = $1 LIMIT 1",
    [familyId]
  );
  return {
    family: serializeRow<ContractFamily>(familyRows[0]),
    members: await listFamilyMembers(familyId),
  };
}

export async function unlinkContractFromFamily(contractId: string): Promise<Contract> {
  requirePostgres();
  const existing = await getContract(contractId);
  if (!existing) throw new Error("Contract not found");
  const familyId = existing.family_id;
  await query(
    `UPDATE contracts
     SET family_id = NULL, family_role = 'standalone', updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL`,
    [contractId]
  );
  if (familyId) {
    const remaining = await query(
      `SELECT count(*)::int AS n FROM contracts
       WHERE family_id = $1 AND deleted_at IS NULL`,
      [familyId]
    );
    if (Number(remaining[0]?.n || 0) < 2) {
      await query(
        `UPDATE contracts
         SET family_id = NULL, family_role = 'standalone', updated_at = now()
         WHERE family_id = $1 AND deleted_at IS NULL`,
        [familyId]
      );
      await query("DELETE FROM contract_families WHERE id = $1", [familyId]);
    }
  }
  const updated = await getContract(contractId);
  if (!updated) throw new Error("Contract not found");
  return updated;
}

export function diffContractFields(
  before: Contract,
  after: Contract
): Record<string, { from: unknown; to: unknown }> {
  const keys: Array<keyof Contract> = [
    "title",
    "vendor_id",
    "entity_id",
    "group_id",
    "family_id",
    "family_role",
    "effective_date",
    "has_defined_term",
    "term_end_date",
    "expiration_date",
    "notice_period_days",
    "auto_renews",
    "cost_amount",
    "cost_currency",
    "cost_frequency",
    "next_payment_date",
    "cost_notes",
    "summary",
    "status",
  ];
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of keys) {
    const prev = before[key] ?? null;
    const next = after[key] ?? null;
    if (String(prev ?? "") !== String(next ?? "")) {
      changes[key] = { from: prev, to: next };
    }
  }
  return changes;
}

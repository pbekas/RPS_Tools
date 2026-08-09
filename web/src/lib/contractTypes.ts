export type ContractGroup = {
  id: string;
  name: string;
  slug: string;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type ContractEntity = {
  id: string;
  name: string;
  slug: string;
  aliases?: string[];
  sort_order: number;
  active?: boolean;
  created_at?: string;
  updated_at?: string;
  contract_count?: number;
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

export const OBLIGATION_KINDS = [
  "notice_window",
  "auto_renew",
  "expiration",
  "rent_escalation",
  "insurance_coi",
  "personal_guarantee",
  "payment",
  "other",
] as const;

export type ObligationKind = (typeof OBLIGATION_KINDS)[number];

export const OBLIGATION_STATUSES = ["open", "done", "dismissed", "snoozed"] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

export const FAMILY_ROLES = [
  "standalone",
  "original",
  "amendment",
  "assignment",
  "sublease",
  "addendum",
  "renewal",
  "other",
] as const;

export type FamilyRole = (typeof FAMILY_ROLES)[number];

export type Contract = {
  id: string;
  title: string;
  vendor_id?: string | null;
  entity_id?: string | null;
  group_id?: string | null;
  family_id?: string | null;
  family_role?: FamilyRole;
  family_name?: string | null;
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
  entity_name?: string | null;
  group_name?: string | null;
  group_slug?: string | null;
  search_snippet?: string | null;
};

export type ContractObligation = {
  id: string;
  contract_id: string;
  kind: ObligationKind;
  title: string;
  due_date?: string | null;
  owner_email?: string | null;
  owner_name?: string | null;
  status: ObligationStatus;
  notes?: string;
  source: "extracted" | "derived" | "manual";
  extracted_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  contract_title?: string | null;
  vendor_name?: string | null;
  entity_name?: string | null;
  entity_id?: string | null;
};

export type ContractAssignee = {
  email: string;
  name: string;
};

export type ContractFamily = {
  id: string;
  name: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
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
  entityId?: string;
  status?: string;
  expiringSoon?: boolean;
  needsReview?: boolean;
  limit?: number;
  offset?: number;
};

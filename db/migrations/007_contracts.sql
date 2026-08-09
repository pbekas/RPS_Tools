-- Contracts management module: groups, vendors, contacts, contracts, documents.
-- Also adds users.modules for module grants (Admin always has all modules).

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS modules text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS contract_groups (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    notes text NOT NULL DEFAULT '',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendors_name_idx
    ON vendors (lower(name));
CREATE INDEX IF NOT EXISTS vendors_active_idx
    ON vendors (active, name);

CREATE TABLE IF NOT EXISTS vendor_contacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    name text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    phone text NOT NULL DEFAULT '',
    title text NOT NULL DEFAULT '',
    is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_contacts_vendor_idx
    ON vendor_contacts (vendor_id, is_primary DESC, name);

CREATE TABLE IF NOT EXISTS contracts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL DEFAULT '',
    vendor_id uuid REFERENCES vendors(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    group_id uuid REFERENCES contract_groups(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    effective_date date,
    has_defined_term boolean NOT NULL DEFAULT false,
    term_end_date date,
    expiration_date date,
    notice_period_days integer
        CHECK (notice_period_days IS NULL OR notice_period_days >= 0),
    auto_renews boolean NOT NULL DEFAULT false,
    cost_amount numeric(14, 2),
    cost_currency text NOT NULL DEFAULT 'USD',
    cost_frequency text NOT NULL DEFAULT 'unknown'
        CHECK (cost_frequency IN ('monthly', 'annual', 'one_time', 'unknown')),
    next_payment_date date,
    cost_notes text NOT NULL DEFAULT '',
    summary text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'processing',
            'needs_review',
            'active',
            'expired',
            'terminated',
            'error'
        )),
    s3_key text NOT NULL DEFAULT '',
    s3_uri text NOT NULL DEFAULT '',
    original_filename text NOT NULL DEFAULT '',
    content_type text NOT NULL DEFAULT 'application/pdf',
    extracted_json jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(extracted_json) = 'object'),
    extraction_confidence numeric(4, 3),
    extracted_text text NOT NULL DEFAULT '',
    error_message text,
    created_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    deleted_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contracts_status_idx
    ON contracts (status)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contracts_expiration_idx
    ON contracts (expiration_date)
    WHERE deleted_at IS NULL AND expiration_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_term_end_idx
    ON contracts (term_end_date)
    WHERE deleted_at IS NULL AND term_end_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS contracts_vendor_idx
    ON contracts (vendor_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contracts_group_idx
    ON contracts (group_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS contracts_created_at_idx
    ON contracts (created_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contract_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    version integer NOT NULL DEFAULT 1,
    s3_key text NOT NULL,
    s3_uri text NOT NULL DEFAULT '',
    original_filename text NOT NULL DEFAULT '',
    content_type text NOT NULL DEFAULT 'application/pdf',
    byte_size bigint,
    is_primary boolean NOT NULL DEFAULT true,
    uploaded_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_documents_contract_version_uq
    ON contract_documents (contract_id, version);
CREATE INDEX IF NOT EXISTS contract_documents_primary_idx
    ON contract_documents (contract_id)
    WHERE is_primary = true;

INSERT INTO contract_groups (name, slug, sort_order)
VALUES
    ('Leases', 'leases', 10),
    ('Employee', 'employee', 20),
    ('Vendors', 'vendors', 30),
    ('Other', 'other', 100)
ON CONFLICT (slug) DO NOTHING;

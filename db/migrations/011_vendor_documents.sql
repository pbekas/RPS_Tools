-- Supplemental vendor files (W-9, COI, etc.), distinct from agreement PDFs.

CREATE TABLE IF NOT EXISTS vendor_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    doc_kind text NOT NULL DEFAULT 'other'
        CHECK (doc_kind IN ('w9', 'coi', 'insurance', 'other')),
    title text NOT NULL DEFAULT '',
    s3_key text NOT NULL,
    s3_uri text NOT NULL DEFAULT '',
    original_filename text NOT NULL DEFAULT '',
    content_type text NOT NULL DEFAULT 'application/pdf',
    byte_size bigint,
    uploaded_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vendor_documents_vendor_idx
    ON vendor_documents (vendor_id, created_at DESC);

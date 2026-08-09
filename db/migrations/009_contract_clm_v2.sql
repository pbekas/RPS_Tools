-- Obligation calendar, contract families, full-text search, and family role.

CREATE TABLE IF NOT EXISTS contract_families (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL DEFAULT '',
    notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS family_id uuid REFERENCES contract_families(id)
        ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS family_role text NOT NULL DEFAULT 'standalone';

UPDATE contracts
SET family_role = 'standalone'
WHERE family_role IS NULL OR family_role = '';

ALTER TABLE contracts
    DROP CONSTRAINT IF EXISTS contracts_family_role_check;
ALTER TABLE contracts
    ADD CONSTRAINT contracts_family_role_check
    CHECK (family_role IN (
        'standalone',
        'original',
        'amendment',
        'assignment',
        'sublease',
        'addendum',
        'renewal',
        'other'
    ));

CREATE INDEX IF NOT EXISTS contracts_family_idx
    ON contracts (family_id)
    WHERE deleted_at IS NULL AND family_id IS NOT NULL;

ALTER TABLE contracts DROP COLUMN IF EXISTS search_tsv;
ALTER TABLE contracts
    ADD COLUMN search_tsv tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A')
        || setweight(to_tsvector('english', coalesce(summary, '')), 'B')
        || setweight(
            to_tsvector('english', left(coalesce(extracted_text, ''), 200000)),
            'C'
        )
    ) STORED;

CREATE INDEX IF NOT EXISTS contracts_search_tsv_idx
    ON contracts USING GIN (search_tsv)
    WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS contract_obligations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    kind text NOT NULL
        CHECK (kind IN (
            'notice_window',
            'auto_renew',
            'expiration',
            'rent_escalation',
            'insurance_coi',
            'personal_guarantee',
            'payment',
            'other'
        )),
    title text NOT NULL DEFAULT '',
    due_date date,
    owner_email citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'done', 'dismissed', 'snoozed')),
    notes text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT 'manual'
        CHECK (source IN ('extracted', 'derived', 'manual')),
    extracted_json jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(extracted_json) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_obligations_due_idx
    ON contract_obligations (due_date, status)
    WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS contract_obligations_contract_idx
    ON contract_obligations (contract_id, due_date);
CREATE INDEX IF NOT EXISTS contract_obligations_owner_idx
    ON contract_obligations (owner_email)
    WHERE owner_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contract_obligations_derived_kind_uq
    ON contract_obligations (contract_id, kind)
    WHERE source = 'derived';

INSERT INTO contract_obligations (contract_id, kind, title, due_date, source, status)
SELECT
    c.id,
    'expiration',
    'Expiration / term end',
    LEAST(
        COALESCE(c.expiration_date, DATE '9999-12-31'),
        COALESCE(c.term_end_date, DATE '9999-12-31')
    ),
    'derived',
    'open'
FROM contracts c
WHERE c.deleted_at IS NULL
  AND (c.expiration_date IS NOT NULL OR c.term_end_date IS NOT NULL)
  AND LEAST(
        COALESCE(c.expiration_date, DATE '9999-12-31'),
        COALESCE(c.term_end_date, DATE '9999-12-31')
      ) < DATE '9999-12-31'
ON CONFLICT (contract_id, kind) WHERE source = 'derived' DO NOTHING;

INSERT INTO contract_obligations (contract_id, kind, title, due_date, source, status)
SELECT
    c.id,
    'notice_window',
    (c.notice_period_days::text || '-day notice deadline'),
    (
        LEAST(
            COALESCE(c.expiration_date, DATE '9999-12-31'),
            COALESCE(c.term_end_date, DATE '9999-12-31')
        ) - (c.notice_period_days * INTERVAL '1 day')
    )::date,
    'derived',
    'open'
FROM contracts c
WHERE c.deleted_at IS NULL
  AND c.notice_period_days IS NOT NULL
  AND (c.expiration_date IS NOT NULL OR c.term_end_date IS NOT NULL)
  AND LEAST(
        COALESCE(c.expiration_date, DATE '9999-12-31'),
        COALESCE(c.term_end_date, DATE '9999-12-31')
      ) < DATE '9999-12-31'
ON CONFLICT (contract_id, kind) WHERE source = 'derived' DO NOTHING;

INSERT INTO contract_obligations (contract_id, kind, title, due_date, source, status)
SELECT
    c.id,
    'auto_renew',
    'Auto-renewal decision',
    CASE
        WHEN c.notice_period_days IS NOT NULL THEN (
            LEAST(
                COALESCE(c.expiration_date, DATE '9999-12-31'),
                COALESCE(c.term_end_date, DATE '9999-12-31')
            ) - (c.notice_period_days * INTERVAL '1 day')
        )::date
        ELSE LEAST(
            COALESCE(c.expiration_date, DATE '9999-12-31'),
            COALESCE(c.term_end_date, DATE '9999-12-31')
        )
    END,
    'derived',
    'open'
FROM contracts c
WHERE c.deleted_at IS NULL
  AND c.auto_renews = true
  AND (c.expiration_date IS NOT NULL OR c.term_end_date IS NOT NULL)
  AND LEAST(
        COALESCE(c.expiration_date, DATE '9999-12-31'),
        COALESCE(c.term_end_date, DATE '9999-12-31')
      ) < DATE '9999-12-31'
ON CONFLICT (contract_id, kind) WHERE source = 'derived' DO NOTHING;

INSERT INTO contract_obligations (contract_id, kind, title, due_date, source, status)
SELECT
    c.id,
    'payment',
    'Next payment',
    c.next_payment_date,
    'derived',
    'open'
FROM contracts c
WHERE c.deleted_at IS NULL
  AND c.next_payment_date IS NOT NULL
ON CONFLICT (contract_id, kind) WHERE source = 'derived' DO NOTHING;

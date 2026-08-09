-- Internal contracting companies (our legal entities), distinct from vendors.

CREATE TABLE IF NOT EXISTS contract_entities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE,
    aliases text[] NOT NULL DEFAULT '{}',
    sort_order integer NOT NULL DEFAULT 50,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS contract_entities_name_idx
    ON contract_entities (lower(name));
CREATE INDEX IF NOT EXISTS contract_entities_active_idx
    ON contract_entities (active, sort_order, name);

ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS entity_id uuid REFERENCES contract_entities(id)
        ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contracts_entity_idx
    ON contracts (entity_id)
    WHERE deleted_at IS NULL;

INSERT INTO contract_entities (name, slug, aliases, sort_order)
VALUES
    (
        'ACA Relevium',
        'aca-relevium',
        ARRAY['aca relevium', 'aca', 'relevium pain specialists', 'relevium'],
        10
    ),
    (
        'Andrew Hall MD PLLC',
        'andrew-hall-md-pllc',
        ARRAY['andrew hall md pllc', 'andrew hall', 'hall md pllc', 'andrew hall m.d.'],
        20
    ),
    (
        'Fort Apache Surgery Center',
        'fort-apache-surgery-center',
        ARRAY['fort apache surgery center', 'fasc', 'fort apache'],
        30
    )
ON CONFLICT (slug) DO NOTHING;

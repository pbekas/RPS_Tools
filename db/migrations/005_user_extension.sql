-- Agent extension mapping for CDR scorecards.
-- Known staff are identified by users.extension; unmapped CDR parties roll into Unknown.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS extension text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS users_extension_uidx
    ON users (extension)
    WHERE extension <> '';

CREATE TABLE IF NOT EXISTS vonage_extensions (
    extension text PRIMARY KEY,
    display_name text NOT NULL DEFAULT '',
    vbc_username text NOT NULL DEFAULT '',
    vbc_email text NOT NULL DEFAULT '',
    vbc_user_id text NOT NULL DEFAULT '',
    mapped_email citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    source text NOT NULL DEFAULT 'cdr'
        CHECK (source IN ('cdr', 'provisioning', 'manual')),
    raw jsonb NOT NULL DEFAULT '{}'::jsonb,
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS vonage_extensions_mapped_email_idx
    ON vonage_extensions (mapped_email)
    WHERE mapped_email IS NOT NULL;

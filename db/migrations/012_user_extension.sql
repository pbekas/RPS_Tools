-- Map Vonage recording extensions to directory users for agent credit.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS extension text;

-- One active mapping per extension (blank/null allowed many times).
CREATE UNIQUE INDEX IF NOT EXISTS users_extension_unique_idx
    ON users (extension)
    WHERE extension IS NOT NULL AND btrim(extension) <> '';

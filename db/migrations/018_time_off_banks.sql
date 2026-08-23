-- Annual time-off bank: default allotment and per-user yearly balances.

ALTER TABLE time_clock_settings
    ADD COLUMN IF NOT EXISTS default_annual_pto_hours numeric(7, 2) NOT NULL DEFAULT 80
        CHECK (default_annual_pto_hours >= 0 AND default_annual_pto_hours <= 2000);

CREATE TABLE IF NOT EXISTS time_off_banks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email citext NOT NULL REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    year integer NOT NULL
        CHECK (year >= 2000 AND year <= 2100),
    allotted_hours numeric(7, 2) NOT NULL DEFAULT 80
        CHECK (allotted_hours >= 0 AND allotted_hours <= 2000),
    notes text NOT NULL DEFAULT '',
    updated_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_email, year)
);

CREATE INDEX IF NOT EXISTS time_off_banks_year_idx
    ON time_off_banks (year DESC, user_email);

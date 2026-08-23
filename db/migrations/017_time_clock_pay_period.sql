-- Pay period preset for Plane-ready PDF exports.

ALTER TABLE time_clock_settings
    ADD COLUMN IF NOT EXISTS pay_period_anchor_date date NOT NULL DEFAULT '2026-01-01',
    ADD COLUMN IF NOT EXISTS pay_period_length_days integer NOT NULL DEFAULT 14
        CHECK (pay_period_length_days >= 7 AND pay_period_length_days <= 31);

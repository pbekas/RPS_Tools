-- Extended reminders, per-user timezone support, and PTO / time-off entries.

ALTER TABLE time_clock_settings
    ADD COLUMN IF NOT EXISTS remind_clock_in_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS remind_clock_in_after time NOT NULL DEFAULT '09:30',
    ADD COLUMN IF NOT EXISTS remind_clock_out_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS remind_clock_out_after time NOT NULL DEFAULT '18:00',
    ADD COLUMN IF NOT EXISTS remind_timesheet_enabled boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS remind_timesheet_weekday smallint NOT NULL DEFAULT 5
        CHECK (remind_timesheet_weekday >= 0 AND remind_timesheet_weekday <= 6),
    ADD COLUMN IF NOT EXISTS remind_timesheet_after time NOT NULL DEFAULT '15:00';

CREATE TABLE IF NOT EXISTS time_off_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email citext NOT NULL REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    entry_date date NOT NULL,
    kind text NOT NULL DEFAULT 'pto'
        CHECK (kind IN ('pto', 'sick', 'holiday', 'unpaid')),
    hours numeric(5, 2) NOT NULL DEFAULT 8
        CHECK (hours > 0 AND hours <= 24),
    notes text NOT NULL DEFAULT '',
    created_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_email, entry_date)
);

CREATE INDEX IF NOT EXISTS time_off_entries_user_date_idx
    ON time_off_entries (user_email, entry_date DESC);

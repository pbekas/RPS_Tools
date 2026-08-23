-- Weekly timesheet approval and per-user timezone for remote team visibility.

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS timezone text;

CREATE TABLE IF NOT EXISTS time_timesheets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email citext NOT NULL REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    week_start date NOT NULL,
    status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'submitted', 'approved', 'rejected')),
    total_hours numeric(8, 2) NOT NULL DEFAULT 0
        CHECK (total_hours >= 0),
    submitted_at timestamptz,
    reviewed_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    reviewed_at timestamptz,
    review_notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_email, week_start)
);

CREATE INDEX IF NOT EXISTS time_timesheets_status_week_idx
    ON time_timesheets (status, week_start DESC);

CREATE INDEX IF NOT EXISTS time_timesheets_user_week_idx
    ON time_timesheets (user_email, week_start DESC);

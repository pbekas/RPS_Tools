-- Time clock module: punch entries, edit approvals, and reminder settings.

CREATE TABLE IF NOT EXISTS time_clock_settings (
    id text PRIMARY KEY DEFAULT 'default',
    max_open_hours numeric(5, 2) NOT NULL DEFAULT 10
        CHECK (max_open_hours > 0 AND max_open_hours <= 24),
    reminder_enabled boolean NOT NULL DEFAULT true,
    timezone text NOT NULL DEFAULT 'America/Chicago',
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED
);

INSERT INTO time_clock_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS time_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_email citext NOT NULL REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    clock_in timestamptz NOT NULL,
    clock_out timestamptz,
    notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (clock_out IS NULL OR clock_out > clock_in)
);

CREATE INDEX IF NOT EXISTS time_entries_user_clock_in_idx
    ON time_entries (user_email, clock_in DESC);

CREATE INDEX IF NOT EXISTS time_entries_open_idx
    ON time_entries (user_email)
    WHERE clock_out IS NULL;

CREATE TABLE IF NOT EXISTS time_entry_edit_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id uuid NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
    requested_by citext NOT NULL REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    original_clock_in timestamptz NOT NULL,
    original_clock_out timestamptz,
    original_notes text NOT NULL DEFAULT '',
    proposed_clock_in timestamptz NOT NULL,
    proposed_clock_out timestamptz,
    proposed_notes text NOT NULL DEFAULT '',
    reason text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    reviewed_at timestamptz,
    review_notes text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (proposed_clock_out IS NULL OR proposed_clock_out > proposed_clock_in)
);

CREATE INDEX IF NOT EXISTS time_entry_edit_requests_status_idx
    ON time_entry_edit_requests (status, created_at DESC);

CREATE INDEX IF NOT EXISTS time_entry_edit_requests_entry_idx
    ON time_entry_edit_requests (entry_id, created_at DESC);

-- Time-off days become requests that supervisors/admins approve or deny.
-- Existing rows stay approved so current logged days remain in effect.

ALTER TABLE time_off_entries
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved';

ALTER TABLE time_off_entries
    DROP CONSTRAINT IF EXISTS time_off_entries_status_check;

ALTER TABLE time_off_entries
    ADD CONSTRAINT time_off_entries_status_check
    CHECK (status IN ('pending', 'approved', 'denied'));

ALTER TABLE time_off_entries
    ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE time_off_entries
    ADD COLUMN IF NOT EXISTS reviewed_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE time_off_entries
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE time_off_entries
    ADD COLUMN IF NOT EXISTS review_notes text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS time_off_entries_pending_idx
    ON time_off_entries (status, entry_date)
    WHERE status = 'pending';

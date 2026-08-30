-- Track manager/supervisor punch edits on the entry itself.
-- Audit log remains the source of history; these columns power the "Edited" badge.

ALTER TABLE time_entries
    ADD COLUMN IF NOT EXISTS last_edited_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_edited_by citext
        REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    ADD COLUMN IF NOT EXISTS last_edit_reason text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 0
        CHECK (edit_count >= 0);

CREATE INDEX IF NOT EXISTS time_entries_edited_idx
    ON time_entries (last_edited_at DESC)
    WHERE last_edited_at IS NOT NULL;

-- Stamp punches that already went through an approved employee edit request.
WITH latest AS (
    SELECT DISTINCT ON (entry_id)
        entry_id,
        reviewed_at,
        reviewed_by,
        reason
    FROM time_entry_edit_requests
    WHERE status = 'approved'
      AND reviewed_at IS NOT NULL
    ORDER BY entry_id, reviewed_at DESC
),
counts AS (
    SELECT entry_id, COUNT(*)::int AS cnt
    FROM time_entry_edit_requests
    WHERE status = 'approved'
    GROUP BY entry_id
)
UPDATE time_entries e
SET last_edited_at = latest.reviewed_at,
    last_edited_by = latest.reviewed_by,
    last_edit_reason = COALESCE(latest.reason, ''),
    edit_count = counts.cnt
FROM latest
JOIN counts ON counts.entry_id = latest.entry_id
WHERE e.id = latest.entry_id
  AND e.last_edited_at IS NULL;

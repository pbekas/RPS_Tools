-- At most one open punch per person. Close extras before adding the unique index.

WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY user_email
            ORDER BY clock_in DESC, id DESC
        ) AS rn
    FROM time_entries
    WHERE clock_out IS NULL
)
UPDATE time_entries e
SET
    clock_out = e.clock_in + interval '1 second',
    notes = CASE
        WHEN e.notes = '' THEN 'Auto-closed duplicate open punch'
        ELSE e.notes
    END,
    updated_at = now()
FROM ranked r
WHERE e.id = r.id
  AND r.rn > 1
  AND e.clock_out IS NULL;

DROP INDEX IF EXISTS time_entries_open_idx;

CREATE UNIQUE INDEX IF NOT EXISTS time_entries_one_open_uq
    ON time_entries (user_email)
    WHERE clock_out IS NULL;

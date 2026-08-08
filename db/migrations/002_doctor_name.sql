ALTER TABLE calls
    ADD COLUMN IF NOT EXISTS doctor_name text NOT NULL DEFAULT '';

UPDATE calls
SET doctor_name = analysis_raw->>'doctor_name'
WHERE doctor_name = ''
  AND NULLIF(analysis_raw->>'doctor_name', '') IS NOT NULL;

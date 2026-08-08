-- Optional first-class columns for translated call transcripts.
-- Until applied, these fields are also accepted via analysis_raw overflow.

ALTER TABLE calls
    ADD COLUMN IF NOT EXISTS transcript_original jsonb
        CHECK (transcript_original IS NULL OR jsonb_typeof(transcript_original) = 'array');

ALTER TABLE calls
    ADD COLUMN IF NOT EXISTS transcript_language text NOT NULL DEFAULT '';

ALTER TABLE calls
    ADD COLUMN IF NOT EXISTS transcript_translated boolean NOT NULL DEFAULT false;

ALTER TABLE calls
    ADD COLUMN IF NOT EXISTS stt_language text NOT NULL DEFAULT '';

UPDATE calls
SET
    transcript_original = CASE
        WHEN transcript_original IS NULL
             AND jsonb_typeof(analysis_raw->'transcript_original') = 'array'
        THEN analysis_raw->'transcript_original'
        ELSE transcript_original
    END,
    transcript_language = CASE
        WHEN transcript_language = ''
             AND NULLIF(analysis_raw->>'transcript_language', '') IS NOT NULL
        THEN analysis_raw->>'transcript_language'
        ELSE transcript_language
    END,
    transcript_translated = CASE
        WHEN transcript_translated = false
             AND (analysis_raw->>'transcript_translated') IN ('true', 't', '1')
        THEN true
        ELSE transcript_translated
    END,
    stt_language = CASE
        WHEN stt_language = ''
             AND NULLIF(analysis_raw->>'stt_language', '') IS NOT NULL
        THEN analysis_raw->>'stt_language'
        ELSE stt_language
    END
WHERE analysis_raw ? 'transcript_original'
   OR analysis_raw ? 'transcript_language'
   OR analysis_raw ? 'transcript_translated'
   OR analysis_raw ? 'stt_language';

-- Stub columns for true ASA / service level once Vonage or ACD exposes
-- ring / queue wait. VBC Reports call-logs do not include these today;
-- values remain NULL and Ops shows SLA proxies instead.

ALTER TABLE call_logs
    ADD COLUMN IF NOT EXISTS ring_seconds integer
        CHECK (ring_seconds IS NULL OR ring_seconds >= 0),
    ADD COLUMN IF NOT EXISTS wait_seconds integer
        CHECK (wait_seconds IS NULL OR wait_seconds >= 0),
    ADD COLUMN IF NOT EXISTS queue_seconds integer
        CHECK (queue_seconds IS NULL OR queue_seconds >= 0),
    ADD COLUMN IF NOT EXISTS answered_at timestamptz;

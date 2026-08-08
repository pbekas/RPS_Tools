CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
    email citext PRIMARY KEY,
    name text NOT NULL DEFAULT '',
    role text NOT NULL DEFAULT 'Agent'
        CHECK (role IN ('Admin', 'Agent')),
    rolling_ai_feedback text NOT NULL DEFAULT '',
    last_coaching_at timestamptz,
    active boolean NOT NULL DEFAULT true,
    provisional boolean NOT NULL DEFAULT false,
    linked_to citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_role_active_idx
    ON users (role, active);

CREATE TABLE IF NOT EXISTS calls (
    id text PRIMARY KEY,
    agent_email citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    agent_name text NOT NULL DEFAULT '',
    patient_name text NOT NULL DEFAULT '',
    call_date timestamptz NOT NULL,
    duration_seconds integer NOT NULL DEFAULT 0
        CHECK (duration_seconds >= 0),
    time_to_answer_seconds integer
        CHECK (time_to_answer_seconds IS NULL OR time_to_answer_seconds >= 0),
    topic text,
    topic_id text,
    ai_empathy_score numeric(4, 2),
    ai_name_stated boolean,
    ai_summary text,
    transcript jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(transcript) = 'array'),
    transfer_count integer NOT NULL DEFAULT 0
        CHECK (transfer_count >= 0),
    fcr boolean,
    quality_score numeric(4, 2),
    ruleset_version text,
    auto_failed boolean NOT NULL DEFAULT false,
    auto_fail_rules text[] NOT NULL DEFAULT '{}',
    flagset_version text,
    has_critical_flags boolean NOT NULL DEFAULT false,
    sentiment_label text,
    sentiment_score numeric(4, 2),
    sentiment_notes text,
    manager_feedback text NOT NULL DEFAULT '',
    manager_notes text NOT NULL DEFAULT '',
    reviewed_by citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    reviewed_at timestamptz,
    recording_url text,
    recording_storage_uri text,
    recording_gcs_path text,
    original_filename text,
    source text,
    status text NOT NULL DEFAULT 'pending',
    error_message text,
    vonage_call_id text,
    vonage_recording_id text,
    vonage_extension text,
    vonage_caller_id text,
    vonage_cnam text,
    vonage_dnis text,
    vonage_direction text,
    critical_alert_sent_at timestamptz,
    analysis_raw jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(analysis_raw) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calls_status_date_idx
    ON calls (status, call_date DESC);
CREATE INDEX IF NOT EXISTS calls_agent_status_date_idx
    ON calls (agent_email, status, call_date DESC);
CREATE INDEX IF NOT EXISTS calls_agent_name_date_idx
    ON calls (agent_name, call_date DESC);
CREATE INDEX IF NOT EXISTS calls_vonage_call_id_idx
    ON calls (vonage_call_id)
    WHERE vonage_call_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS calls_vonage_recording_id_uq
    ON calls (vonage_recording_id)
    WHERE vonage_recording_id IS NOT NULL AND vonage_recording_id <> '';
CREATE INDEX IF NOT EXISTS calls_unreviewed_complete_idx
    ON calls (call_date DESC)
    WHERE status = 'complete' AND reviewed_at IS NULL;

CREATE TABLE IF NOT EXISTS call_rule_results (
    call_id text NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    rule_id text NOT NULL,
    label text,
    category text,
    passed boolean NOT NULL,
    score_1_to_10 numeric(4, 2),
    evidence text,
    evidence_timestamp text,
    evidence_turn_index integer,
    notes text,
    auto_fail boolean NOT NULL DEFAULT false,
    weight numeric(8, 3),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (call_id, rule_id)
);

CREATE INDEX IF NOT EXISTS call_rule_results_rule_passed_idx
    ON call_rule_results (rule_id, passed, call_id);

CREATE TABLE IF NOT EXISTS call_flag_results (
    call_id text NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    flag_id text NOT NULL,
    label text,
    severity text,
    triggered boolean NOT NULL DEFAULT true,
    evidence text,
    evidence_timestamp text,
    evidence_turn_index integer,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (call_id, flag_id)
);

CREATE INDEX IF NOT EXISTS call_flag_results_flag_triggered_idx
    ON call_flag_results (flag_id, triggered, call_id);

CREATE TABLE IF NOT EXISTS call_logs (
    id text PRIMARY KEY,
    direction text,
    from_number text,
    to_number text,
    result text,
    recorded boolean,
    length_seconds integer NOT NULL DEFAULT 0
        CHECK (length_seconds >= 0),
    start_at timestamptz,
    end_at timestamptz,
    source_user text,
    source_user_full_name text,
    source_extension text,
    source_device_name text,
    source_sip_id text,
    destination_user text,
    destination_user_full_name text,
    destination_extension text,
    destination_device_name text,
    destination_sip_id text,
    custom_tag text,
    in_network boolean,
    international boolean,
    charge numeric(14, 6),
    rate numeric(14, 6),
    is_missed boolean NOT NULL DEFAULT false,
    is_unrecorded boolean NOT NULL DEFAULT false,
    matched_call_id text REFERENCES calls(id)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    raw jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(raw) = 'object'),
    synced_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_logs_start_idx
    ON call_logs (start_at DESC);
CREATE INDEX IF NOT EXISTS call_logs_result_start_idx
    ON call_logs (result, start_at DESC);
CREATE INDEX IF NOT EXISTS call_logs_missed_start_idx
    ON call_logs (start_at DESC)
    WHERE is_missed = true;
CREATE INDEX IF NOT EXISTS call_logs_matched_call_idx
    ON call_logs (matched_call_id)
    WHERE matched_call_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS feedback (
    id text PRIMARY KEY,
    call_id text NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    agent_email citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    agent_name text NOT NULL DEFAULT '',
    author_email citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    author_name text NOT NULL DEFAULT '',
    text text NOT NULL,
    call_date timestamptz,
    topic text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_agent_created_idx
    ON feedback (agent_email, created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_call_created_idx
    ON feedback (call_id, created_at DESC);

CREATE TABLE IF NOT EXISTS weekly_metrics (
    id text PRIMARY KEY,
    agent_email citext NOT NULL REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    agent_name text NOT NULL DEFAULT '',
    week_start date NOT NULL,
    week_end date NOT NULL,
    year integer NOT NULL,
    week integer NOT NULL CHECK (week BETWEEN 1 AND 53),
    call_count integer NOT NULL DEFAULT 0 CHECK (call_count >= 0),
    total_talk_time_seconds integer NOT NULL DEFAULT 0,
    avg_talk_time_seconds numeric(14, 3) NOT NULL DEFAULT 0,
    avg_empathy_score numeric(6, 3) NOT NULL DEFAULT 0,
    avg_quality_score numeric(6, 3) NOT NULL DEFAULT 0,
    fcr_rate numeric(6, 5) NOT NULL DEFAULT 0,
    avg_transfers numeric(8, 3) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (agent_email, week_start)
);

CREATE INDEX IF NOT EXISTS weekly_metrics_agent_week_idx
    ON weekly_metrics (agent_email, week_start DESC);

CREATE TABLE IF NOT EXISTS config_sets (
    kind text NOT NULL CHECK (kind IN ('qa_rules', 'call_topics', 'call_flags')),
    version text NOT NULL,
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    is_current boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS config_sets_one_current_per_kind_uq
    ON config_sets (kind)
    WHERE is_current = true;

CREATE TABLE IF NOT EXISTS alert_state (
    alert_key text PRIMARY KEY,
    sent_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_email citext,
    action text NOT NULL,
    resource_type text NOT NULL,
    resource_id text NOT NULL,
    request_id text,
    source_ip inet,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS access_audit_resource_idx
    ON access_audit (resource_type, resource_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS access_audit_actor_idx
    ON access_audit (actor_email, occurred_at DESC);

-- Teams / departments, Supervisor role, and immutable audit trail.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('Admin', 'Agent', 'Supervisor'));

CREATE TABLE IF NOT EXISTS time_clock_teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL,
    supervisor_email citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (slug)
);

CREATE TABLE IF NOT EXISTS time_clock_team_members (
    team_id uuid NOT NULL REFERENCES time_clock_teams(id) ON DELETE CASCADE,
    user_email citext NOT NULL REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_email)
);

CREATE UNIQUE INDEX IF NOT EXISTS time_clock_team_members_user_uq
    ON time_clock_team_members (user_email);

CREATE INDEX IF NOT EXISTS time_clock_teams_supervisor_idx
    ON time_clock_teams (supervisor_email)
    WHERE supervisor_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS time_clock_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_email citext REFERENCES users(email)
        ON UPDATE CASCADE ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    subject_email citext,
    team_id uuid REFERENCES time_clock_teams(id) ON DELETE SET NULL,
    before_data jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(before_data) = 'object'),
    after_data jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(after_data) = 'object'),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS time_clock_audit_log_created_idx
    ON time_clock_audit_log (created_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_audit_log_subject_idx
    ON time_clock_audit_log (subject_email, created_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_audit_log_team_idx
    ON time_clock_audit_log (team_id, created_at DESC);

CREATE INDEX IF NOT EXISTS time_clock_audit_log_actor_idx
    ON time_clock_audit_log (actor_email, created_at DESC);

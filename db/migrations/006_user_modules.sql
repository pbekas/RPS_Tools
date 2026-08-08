-- Optional per-user module grants. Empty ⇒ role defaults (Admin=all, Agent=call_qa).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS modules text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users.modules IS
  'Optional module grants (call_qa, users). Empty uses role defaults.';

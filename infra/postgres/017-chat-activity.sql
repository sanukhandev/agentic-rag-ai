ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

CREATE INDEX IF NOT EXISTS chat_sessions_activity_idx
  ON chat_sessions (tenant_id, last_activity_at);

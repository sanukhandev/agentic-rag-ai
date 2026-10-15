ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS persona_version_id uuid REFERENCES persona_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_sessions_persona_version_idx
  ON chat_sessions (tenant_id, persona_version_id);

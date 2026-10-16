ALTER TABLE agent_personas
  ADD COLUMN IF NOT EXISTS context_window_messages integer NOT NULL DEFAULT 10;

ALTER TABLE agent_personas
  DROP CONSTRAINT IF EXISTS agent_personas_context_window_messages_check;

ALTER TABLE agent_personas
  ADD CONSTRAINT agent_personas_context_window_messages_check CHECK (context_window_messages BETWEEN 1 AND 10);

ALTER TABLE persona_versions
  ADD COLUMN IF NOT EXISTS context_window_messages integer NOT NULL DEFAULT 10;

ALTER TABLE persona_versions
  DROP CONSTRAINT IF EXISTS persona_versions_context_window_messages_check;

ALTER TABLE persona_versions
  ADD CONSTRAINT persona_versions_context_window_messages_check CHECK (context_window_messages BETWEEN 1 AND 10);

ALTER TABLE action_requests
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS conversation_state jsonb NOT NULL DEFAULT '{"phase":"DISCOVERY","catalogVersionId":null,"candidateIntentKeys":[],"selectedIntentKey":null,"slotValues":{},"pendingPrompt":null,"rollingSummary":"","summaryRevision":0,"messageSequence":0,"workflowStatus":"none","contactConsent":"unknown","consentVersion":null,"consentCapturedAt":null}'::jsonb;

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS state_version integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS chat_sessions_state_version_idx ON chat_sessions (tenant_id, state_version);

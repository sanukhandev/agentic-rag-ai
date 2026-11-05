-- V2 goal confirmation is distinct from provider/action consent.
ALTER TABLE user_intent_documents
  ADD COLUMN IF NOT EXISTS goal_confirmation jsonb NULL;

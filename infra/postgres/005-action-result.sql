ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS result jsonb;
ALTER TABLE action_requests ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

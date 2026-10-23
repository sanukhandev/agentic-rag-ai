ALTER TABLE event_inbox
  ALTER COLUMN processed_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE event_inbox
SET state = 'completed', updated_at = COALESCE(processed_at, now())
WHERE state IS NULL OR state NOT IN ('pending', 'processing', 'completed', 'retry_scheduled', 'reconcile_required', 'dead_lettered');

ALTER TABLE event_inbox
  DROP CONSTRAINT IF EXISTS event_inbox_state_check;

ALTER TABLE event_inbox
  ADD CONSTRAINT event_inbox_state_check CHECK (state IN ('pending', 'processing', 'completed', 'retry_scheduled', 'reconcile_required', 'dead_lettered'));

CREATE INDEX IF NOT EXISTS event_inbox_recovery_idx
  ON event_inbox (state, retry_at, lease_expires_at, updated_at);

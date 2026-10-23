ALTER TABLE event_inbox
  ADD COLUMN IF NOT EXISTS dlq_event jsonb,
  ADD COLUMN IF NOT EXISTS dlq_reason text,
  ADD COLUMN IF NOT EXISTS dlq_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS dlq_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS event_inbox_dlq_projection_idx
  ON event_inbox (updated_at, consumer, event_id)
  WHERE state IN ('reconcile_required', 'dead_lettered')
    AND dlq_event IS NOT NULL
    AND dlq_published_at IS NULL;

ALTER TABLE action_executions
  ADD COLUMN IF NOT EXISTS event_id uuid,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS action_executions_event_idx
  ON action_executions (event_id, correlation_id)
  WHERE event_id IS NOT NULL;

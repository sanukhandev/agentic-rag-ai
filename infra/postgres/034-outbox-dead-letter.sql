ALTER TABLE event_outbox
  ADD COLUMN IF NOT EXISTS dead_lettered_at timestamptz;

CREATE INDEX IF NOT EXISTS event_outbox_pending_idx
  ON event_outbox (occurred_at, event_id)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

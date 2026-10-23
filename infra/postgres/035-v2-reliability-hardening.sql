ALTER TABLE event_outbox
  ADD COLUMN IF NOT EXISTS dead_letter_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_letter_lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS event_outbox_dead_letter_projection_idx
  ON event_outbox (dead_lettered_at, event_id)
  WHERE dead_lettered_at IS NOT NULL AND dead_letter_published_at IS NULL;

CREATE INDEX IF NOT EXISTS action_executions_deadline_idx
  ON action_executions (deadline_at, tenant_id)
  WHERE provider_status = 'accepted' AND deadline_at IS NOT NULL;

ALTER TABLE source_chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX IF NOT EXISTS source_chunks_search_vector_idx
  ON source_chunks USING gin (search_vector);

CREATE INDEX IF NOT EXISTS source_chunks_embedding_hnsw_idx
  ON source_chunks USING hnsw (embedding vector_cosine_ops);

BEGIN;

DO $$
DECLARE
  embedding_type text;
BEGIN
  SELECT format_type(att.atttypid, att.atttypmod)
    INTO embedding_type
    FROM pg_attribute att
   WHERE att.attrelid = 'public.source_chunks'::regclass
     AND att.attname = 'embedding'
     AND NOT att.attisdropped;

  IF embedding_type = 'vector(8)' THEN
    UPDATE knowledge_sources
       SET status = 'awaiting_review', approved_at = NULL
     WHERE status = 'active';

    ALTER TABLE source_chunks DROP COLUMN embedding;
    ALTER TABLE source_chunks
      ADD COLUMN embedding vector(1536) NOT NULL
      DEFAULT ('[' || repeat('0,', 1535) || '0]')::vector;
    ALTER TABLE source_chunks ALTER COLUMN embedding DROP DEFAULT;
  ELSIF embedding_type IS DISTINCT FROM 'vector(1536)' THEN
    RAISE EXCEPTION 'source_chunks.embedding must be vector(8) or vector(1536), found %', embedding_type;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS source_chunks_embedding_hnsw_idx
  ON source_chunks USING hnsw (embedding vector_cosine_ops);

COMMIT;

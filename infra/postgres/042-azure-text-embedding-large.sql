BEGIN;

DO $$
DECLARE
  embedding_type text;
  embedding_ready_existed boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'knowledge_sources'
       AND column_name = 'embedding_ready'
  ) INTO embedding_ready_existed;

  IF NOT embedding_ready_existed THEN
    ALTER TABLE knowledge_sources
      ADD COLUMN embedding_ready boolean NOT NULL DEFAULT true;
  END IF;

  SELECT format_type(att.atttypid, att.atttypmod)
    INTO embedding_type
    FROM pg_attribute att
   WHERE att.attrelid = 'public.source_chunks'::regclass
     AND att.attname = 'embedding'
     AND NOT att.attisdropped;

  IF embedding_type = 'vector(8)' OR (embedding_type = 'vector(1536)' AND NOT embedding_ready_existed) THEN
    UPDATE knowledge_sources
       SET embedding_ready = false;
  END IF;

  IF embedding_type = 'vector(8)' THEN
    UPDATE knowledge_sources
       SET status = CASE WHEN status = 'active' THEN 'awaiting_review' ELSE status END,
           approved_at = CASE WHEN status = 'active' THEN NULL ELSE approved_at END;

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

BEGIN;

DO $$
DECLARE
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
    UPDATE knowledge_sources
       SET embedding_ready = false;
  END IF;
END
$$;

COMMIT;

-- Forward-only catalog storage consolidation for the clean conversation engine.
-- Rename retained tables/columns in place; do not delete rows, vectors, knowledge,
-- evidence, audit logs, credentials or customer documents.
DO $$
BEGIN
  IF to_regclass('public.intent_catalog_v2_versions') IS NOT NULL
     AND to_regclass('public.business_catalog_versions') IS NULL THEN
    ALTER TABLE public.intent_catalog_v2_versions RENAME TO business_catalog_versions;
  END IF;
  IF to_regclass('public.v2_otp_challenges') IS NOT NULL
     AND to_regclass('public.otp_challenges') IS NULL THEN
    ALTER TABLE public.v2_otp_challenges RENAME TO otp_challenges;
  END IF;
END $$;

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT table_schema, table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'catalog_v2_version_ref'
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_schema = item.table_schema
      AND table_name = item.table_name AND column_name = 'business_catalog_ref'
    ) THEN
      RAISE EXCEPTION 'Catalog reference migration conflict on %.%', item.table_schema, item.table_name;
    END IF;
    EXECUTE format('ALTER TABLE %I.%I RENAME COLUMN catalog_v2_version_ref TO business_catalog_ref',
                   item.table_schema, item.table_name);
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.user_intent_documents') IS NOT NULL THEN
    ALTER TABLE public.user_intent_documents
      DROP CONSTRAINT IF EXISTS user_intent_documents_catalog_source_check;
    UPDATE public.user_intent_documents SET catalog_source = 'published'
      WHERE catalog_source = 'v2';
    ALTER TABLE public.user_intent_documents
      ADD CONSTRAINT user_intent_documents_catalog_source_check
      CHECK (catalog_source IN ('legacy_v1', 'published'));
  END IF;
  IF to_regclass('public.event_outbox') IS NOT NULL THEN
    UPDATE public.event_outbox SET stream = replace(stream, 'rag:v2:', 'rag:workflow:')
      WHERE stream LIKE 'rag:v2:%' AND published_at IS NULL;
  END IF;
END $$;

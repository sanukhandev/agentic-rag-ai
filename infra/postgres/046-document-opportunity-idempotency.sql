DROP INDEX IF EXISTS supporting_documents_scope_unique;

CREATE UNIQUE INDEX IF NOT EXISTS supporting_documents_scope_unique
  ON supporting_documents (
    tenant_id,
    session_id,
    sha256,
    COALESCE(opportunity_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(catalog_version_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(intent_key, ''),
    COALESCE(requirement_key, '')
  );

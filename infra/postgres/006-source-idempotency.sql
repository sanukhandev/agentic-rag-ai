CREATE UNIQUE INDEX IF NOT EXISTS knowledge_sources_tenant_hash_idx ON knowledge_sources (tenant_id, content_hash);

CREATE TABLE IF NOT EXISTS agentic_schema_migrations (
  migration_id integer PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  checksum text NOT NULL,
  source text NOT NULL DEFAULT 'runner',
  applied_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE agentic_schema_migrations IS
  'Forward-only application migration ledger; baseline rows are recorded by the VM migration runner.';

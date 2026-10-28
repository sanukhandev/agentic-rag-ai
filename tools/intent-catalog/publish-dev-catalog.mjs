import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import pg from 'pg';

const tenantId = process.env.CATALOG_TENANT_ID;
const catalogPath = process.env.CATALOG_PATH ?? '/tmp/catalog.json';
if (!tenantId) throw new Error('CATALOG_TENANT_ID is required');
const raw = await fs.readFile(catalogPath);
const parsed = JSON.parse(raw.toString('utf8'));
const catalog = parsed.catalog ?? parsed;
const sourceHash = crypto.createHash('sha256').update(raw).digest('hex');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query('SELECT id FROM intent_catalog_versions WHERE tenant_id = $1 FOR UPDATE', [tenantId]);
  const next = await client.query('SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM intent_catalog_versions WHERE tenant_id = $1', [tenantId]);
  const version = Number(next.rows[0].next_version);
  await client.query("UPDATE intent_catalog_versions SET status = 'draft', published_at = NULL WHERE tenant_id = $1 AND status = 'published'", [tenantId]);
  const id = crypto.randomUUID();
  await client.query(
    "INSERT INTO intent_catalog_versions (id, tenant_id, version, status, source_file_name, source_hash, parser_version, catalog_json, published_at) VALUES ($1, $2, $3, 'published', $4, $5, $6, $7::jsonb, now())",
    [id, tenantId, version, process.env.CATALOG_SOURCE_FILE ?? 'catalog-dev.json', sourceHash, 'intent-catalog-xlsx-1.4.0', JSON.stringify(catalog)],
  );
  await client.query('COMMIT');
  console.log(JSON.stringify({ id, tenantId, version, status: 'published', sourceHash }));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}

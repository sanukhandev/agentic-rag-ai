import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;
const catalogPath = new URL('../services/api/src/fixtures/ancfz-catalog-v2-seven-stage.json', import.meta.url);
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));

const sourceHash = createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
const newRef = `anc:r13:${sourceHash}`;

const client = new Client({
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'agentic',
  password: process.env.PGPASSWORD ?? 'agentic_local_only',
  database: process.env.PGDATABASE ?? 'agentic_rag',
});

async function main() {
  await client.connect();
  console.log('Connected to PostgreSQL');

  const tenantRes = await client.query("SELECT id, slug, name FROM tenants WHERE slug = 'anc'");
  if (!tenantRes.rows[0]) throw new Error('Tenant anc not found');
  const tenant = tenantRes.rows[0];
  console.log(`Found tenant: ${tenant.slug} (${tenant.id})`);

  const currentVersionRes = await client.query(
    "SELECT id, version, catalog_version_ref FROM intent_catalog_v2_versions WHERE tenant_id = $1 AND status = 'published' ORDER BY version DESC LIMIT 1",
    [tenant.id]
  );
  const oldVersion = currentVersionRes.rows[0];
  console.log(`Current published version: ${oldVersion?.version} (${oldVersion?.catalog_version_ref})`);

  // Unpublish current versions
  await client.query("UPDATE intent_catalog_v2_versions SET status = 'draft' WHERE tenant_id = $1", [tenant.id]);

  // Insert version 13
  const nextVersionNum = (oldVersion?.version ?? 12) + 1;
  const insertVersionRes = await client.query(
    `INSERT INTO intent_catalog_v2_versions (
      id, tenant_id, version, status, source_file_name, source_hash,
      parser_version, catalog_json, catalog_version_ref, published_at
    ) VALUES (
      gen_random_uuid(), $1, $2, 'published', 'ancfz-catalog-v2-seven-stage.json',
      $3, 'intent-catalog-v2-seven-stage-1.0.0', $4::jsonb, $5, now()
    ) RETURNING id, version, catalog_version_ref, status`,
    [tenant.id, nextVersionNum, sourceHash, JSON.stringify(catalog), newRef]
  );
  console.log('Published version:', insertVersionRes.rows[0]);

  // Copy approved package offerings for newRef
  if (oldVersion?.catalog_version_ref) {
    const copyRes = await client.query(
      `INSERT INTO package_offerings (
        id, tenant_id, catalog_version_id, package_key, name,
        eligible_entity_types, eligible_activities, included_visa_quantity,
        office_requirement, inclusions, price_minor, currency,
        pricing_effective_from, pricing_effective_to, additional_fees,
        processing_time, required_documents, exclusions, availability,
        approval_status, source_refs, created_at, catalog_v2_version_ref
      )
      SELECT gen_random_uuid(), p.tenant_id, NULL, p.package_key || '-r13', p.name,
        p.eligible_entity_types, p.eligible_activities, p.included_visa_quantity,
        p.office_requirement, p.inclusions, p.price_minor, p.currency,
        p.pricing_effective_from, p.pricing_effective_to, p.additional_fees,
        p.processing_time, p.required_documents, p.exclusions, p.availability,
        p.approval_status, p.source_refs, p.created_at, $1
      FROM package_offerings p
      WHERE p.tenant_id = $2
        AND p.catalog_v2_version_ref = $3
      ON CONFLICT (tenant_id, package_key) DO NOTHING
      RETURNING package_key, name, price_minor, currency`,
      [newRef, tenant.id, oldVersion.catalog_version_ref]
    );
    console.log(`Seeded ${copyRes.rowCount} package offerings for ${newRef}:`, copyRes.rows);
  }

  await client.end();
  console.log('Catalog publication complete!');
}

main().catch((err) => {
  console.error('Failed to publish catalog:', err);
  process.exit(1);
});

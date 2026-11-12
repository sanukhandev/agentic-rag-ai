import { readFileSync, writeFileSync } from 'node:fs';
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2 } from '../services/api/dist/conversation/catalog.js';

const catPath = new URL('../services/api/src/fixtures/ancfz-catalog-v2-seven-stage.json', import.meta.url);
const cat = JSON.parse(readFileSync(catPath, 'utf8'));

// Align tenant scope and key with tenant 'anc'
cat.manifest.catalogKey = 'anc';
cat.manifest.tenantScope = 'anc';
cat.manifest.revision = 13;
cat.sheets.CatalogManifest[0].catalogKey = 'anc';
cat.sheets.CatalogManifest[0].tenantScope = 'anc';
cat.sheets.CatalogManifest[0].revision = 13;

const validation = validateCatalogV2(cat);
if (!validation.ok || !validation.document) {
  throw new Error(`Catalog validation failed: ${validation.errors.join(' ')}`);
}

const doc = validation.document;
const newRef = catalogV2VersionRef(doc);
const hash = catalogV2Sha256(doc);
const jsonStr = JSON.stringify(doc);

const sql = `DO $$
DECLARE
  v_tenant_id uuid;
  v_old_version record;
  v_new_ref text := '${newRef}';
  v_source_hash text := '${hash}';
  v_catalog jsonb := $CATALOG$${jsonStr}$CATALOG$;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants WHERE slug = 'anc';
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant anc not found';
  END IF;

  SELECT v.* INTO v_old_version
  FROM intent_catalog_v2_versions v
  WHERE v.tenant_id = v_tenant_id AND v.status = 'published'
  ORDER BY v.version DESC
  LIMIT 1;

  -- Delete any existing v13 if re-running
  DELETE FROM package_offerings WHERE tenant_id = v_tenant_id AND catalog_v2_version_ref LIKE 'anc:r13:%';
  DELETE FROM intent_catalog_v2_versions WHERE tenant_id = v_tenant_id AND version = 13;

  UPDATE intent_catalog_v2_versions
  SET status = 'draft', published_at = NULL
  WHERE tenant_id = v_tenant_id;

  INSERT INTO intent_catalog_v2_versions (
    id, tenant_id, version, status, source_file_name, source_hash,
    parser_version, catalog_json, catalog_version_ref, published_at
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 13,
    'published', 'ancfz-catalog-v2-seven-stage.json',
    v_source_hash,
    'intent-catalog-v2-seven-stage-1.0.0',
    v_catalog,
    v_new_ref,
    now()
  );

  INSERT INTO package_offerings (
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
    p.approval_status, p.source_refs, p.created_at, v_new_ref
  FROM package_offerings p
  WHERE p.tenant_id = v_tenant_id
    AND p.catalog_v2_version_ref = (
      SELECT catalog_version_ref FROM intent_catalog_v2_versions 
      WHERE tenant_id = v_tenant_id AND version = 12 LIMIT 1
    )
  ON CONFLICT (tenant_id, package_key) DO NOTHING;
END $$;
`;

const outputPath = new URL('../infra/postgres/072-publish-v13-catalog.sql', import.meta.url);
writeFileSync(outputPath, sql, 'utf8');
console.log(`Generated SQL for newRef: ${newRef}`);

-- Development-only deterministic pricebook for the published ANCFZ Catalog V2.
-- This reuses the reviewed sandbox fixture values from migration 051, but keeps
-- canonical V2 identity separate from legacy UUID offerings. It is not official
-- ANCFZ pricing and must never be enabled for production or live Salesforce.
WITH target AS (
  SELECT t.id AS tenant_id, v.catalog_version_ref
  FROM tenants t
  JOIN intent_catalog_v2_versions v ON v.tenant_id = t.id AND v.status = 'published'
  WHERE t.slug = 'anc'
  ORDER BY v.version DESC
  LIMIT 1
)
INSERT INTO package_offerings (
  id, tenant_id, catalog_version_id, catalog_v2_version_ref, package_key, name,
  eligible_entity_types, eligible_activities, included_visa_quantity,
  office_requirement, inclusions, price_minor, currency, pricing_effective_from,
  pricing_effective_to, additional_fees, processing_time, required_documents,
  exclusions, availability, approval_status, source_refs
)
SELECT
  'b7b4b6de-8a74-4bd4-9b4f-cc8faefb1001', tenant_id, NULL, catalog_version_ref,
  'anc-v2-sandbox-basic', 'ANCFZ Sandbox Basic (development)',
  '["FZE","FZC"]'::jsonb, '[]'::jsonb, 1, 'shared',
  '["company registration","one included visa"]'::jsonb, 250000, 'AED',
  now(), now() + interval '365 days',
  '[{"name":"establishment card","amountMinor":25000,"currency":"AED"}]'::jsonb,
  'development fixture; provider timing not authoritative',
  '["synthetic_passport","synthetic_business_profile"]'::jsonb,
  '["third-party fees outside the fixture","not official ANCFZ pricing"]'::jsonb,
  'development_only', 'approved', '["sandbox-pricebook-v1"]'::jsonb
FROM target
ON CONFLICT (tenant_id, package_key) DO NOTHING;

WITH target AS (
  SELECT t.id AS tenant_id, v.catalog_version_ref
  FROM tenants t
  JOIN intent_catalog_v2_versions v ON v.tenant_id = t.id AND v.status = 'published'
  WHERE t.slug = 'anc'
  ORDER BY v.version DESC
  LIMIT 1
)
INSERT INTO package_offerings (
  id, tenant_id, catalog_version_id, catalog_v2_version_ref, package_key, name,
  eligible_entity_types, eligible_activities, included_visa_quantity,
  office_requirement, inclusions, price_minor, currency, pricing_effective_from,
  pricing_effective_to, additional_fees, processing_time, required_documents,
  exclusions, availability, approval_status, source_refs
)
SELECT
  'b7b4b6de-8a74-4bd4-9b4f-cc8faefb1002', tenant_id, NULL, catalog_version_ref,
  'anc-v2-sandbox-growth', 'ANCFZ Sandbox Growth (development)',
  '["FZE","FZC"]'::jsonb, '[]'::jsonb, 3, 'shared',
  '["company registration","three included visas","establishment card"]'::jsonb,
  450000, 'AED', now(), now() + interval '365 days',
  '[{"name":"additional shareholder","amountMinor":50000,"currency":"AED"}]'::jsonb,
  'development fixture; provider timing not authoritative',
  '["synthetic_passport","synthetic_business_profile","synthetic_shareholder_schedule"]'::jsonb,
  '["third-party fees outside the fixture","not official ANCFZ pricing"]'::jsonb,
  'development_only', 'approved', '["sandbox-pricebook-v1"]'::jsonb
FROM target
ON CONFLICT (tenant_id, package_key) DO NOTHING;

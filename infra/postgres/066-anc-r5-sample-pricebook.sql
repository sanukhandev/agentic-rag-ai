-- Development-only sample pricebook for the currently published ANCFZ catalog.
-- These values are synthetic and must never be presented as official ANCFZ pricing.
WITH target AS (
  SELECT t.id AS tenant_id, v.catalog_version_ref
  FROM tenants t
  JOIN intent_catalog_v2_versions v
    ON v.tenant_id = t.id
   AND v.status = 'published'
  WHERE t.slug = 'anc'
  ORDER BY v.version DESC
  LIMIT 1
), samples(package_key, name, included_visa_quantity, inclusions, price_minor, required_documents) AS (
  VALUES
    ('anc-r5-sample-starter', 'ANCFZ Starter (sample)', 1, '["company registration","one included visa"]'::jsonb, 249900, '["synthetic_passport","synthetic_business_profile"]'::jsonb),
    ('anc-r5-sample-growth', 'ANCFZ Growth (sample)', 2, '["company registration","two included visas"]'::jsonb, 499900, '["synthetic_passport","synthetic_business_profile"]'::jsonb),
    ('anc-r5-sample-premium', 'ANCFZ Premium (sample)', 3, '["company registration","three included visas","establishment card"]'::jsonb, 789900, '["synthetic_passport","synthetic_business_profile","synthetic_shareholder_schedule"]'::jsonb)
)
INSERT INTO package_offerings (
  id, tenant_id, catalog_version_id, catalog_v2_version_ref, package_key, name,
  eligible_entity_types, eligible_activities, included_visa_quantity,
  office_requirement, inclusions, price_minor, currency,
  pricing_effective_from, pricing_effective_to, additional_fees,
  processing_time, required_documents, exclusions, availability,
  approval_status, source_refs, created_at
)
SELECT
  gen_random_uuid(), target.tenant_id, NULL, target.catalog_version_ref,
  samples.package_key, samples.name, '["FZE","FZC"]'::jsonb, '[]'::jsonb,
  samples.included_visa_quantity, 'shared', samples.inclusions, samples.price_minor,
  'AED', now(), now() + interval '365 days', '[]'::jsonb,
  'development sample; provider timing not authoritative', samples.required_documents,
  '["third-party fees outside the sample","not official ANCFZ pricing"]'::jsonb,
  'development_only', 'approved', '["sample-pricebook-2026-11"]'::jsonb, now()
FROM target
CROSS JOIN samples
ON CONFLICT (tenant_id, package_key) DO NOTHING;

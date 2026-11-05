-- Development ANCFZ V2 revision: recognize reviewed planning/thinking formation
-- phrasing without treating a model proposal as customer confirmation.
-- Existing sessions remain pinned to their immutable catalog revision.
DO $$
DECLARE
  old_version record;
  revised_catalog jsonb;
  new_ref constant text := 'anc:r4:498ab48687d73b5d5da76d60bd2c6df6132fd1334e86742b16ad0e5688db261c';
BEGIN
  IF EXISTS (
    SELECT 1 FROM intent_catalog_v2_versions
    WHERE catalog_version_ref = new_ref
       OR catalog_version_ref LIKE 'anc:r4:%'
  ) THEN
    RETURN;
  END IF;

  SELECT v.* INTO old_version
  FROM intent_catalog_v2_versions v
  JOIN tenants t ON t.id = v.tenant_id
  WHERE t.slug = 'anc' AND v.status = 'published'
  ORDER BY v.version DESC
  LIMIT 1;

  IF old_version.id IS NULL THEN
    RETURN;
  END IF;

  revised_catalog := old_version.catalog_json;
  revised_catalog := jsonb_set(revised_catalog, '{manifest,revision}', '4'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{manifest,policyVersion}', '"ancfz-seven-stage-v2-p2"'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,revision}', '4'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,policyVersion}', '"ancfz-seven-stage-v2-p2"'::jsonb, true);
  revised_catalog := jsonb_set(
    revised_catalog,
    '{sheets,IntentSignals}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN signal->>'signalId' = 'signal.company.setup'
          THEN jsonb_set(signal, '{aliases}', COALESCE(signal->'aliases', '[]'::jsonb) || '["planning to start a business", "thinking of setting up a business"]'::jsonb, true)
          ELSE signal
        END
        ORDER BY ordinal
      )
      FROM jsonb_array_elements(revised_catalog->'sheets'->'IntentSignals') WITH ORDINALITY AS item(signal, ordinal)
    ),
    true
  );

  UPDATE intent_catalog_v2_versions
  SET status = 'draft', published_at = NULL
  WHERE id = old_version.id;

  INSERT INTO intent_catalog_v2_versions (
    id, tenant_id, version, status, source_file_name, source_hash,
    parser_version, catalog_json, catalog_version_ref, published_at
  ) VALUES (
    gen_random_uuid(), old_version.tenant_id,
    (SELECT COALESCE(MAX(version), 0) + 1 FROM intent_catalog_v2_versions WHERE tenant_id = old_version.tenant_id),
    'published', 'ancfz-catalog-v2-natural-initiation-aliases-r4.json',
    '498ab48687d73b5d5da76d60bd2c6df6132fd1334e86742b16ad0e5688db261c',
    'intent-catalog-v2-reviewed-dev-1.0.0', revised_catalog, new_ref, now()
  );

  -- Keep the development-only pricebook available under the new immutable pin.
  INSERT INTO package_offerings (
    id, tenant_id, catalog_version_id, package_key, name,
    eligible_entity_types, eligible_activities, included_visa_quantity,
    office_requirement, inclusions, price_minor, currency,
    pricing_effective_from, pricing_effective_to, additional_fees,
    processing_time, required_documents, exclusions, availability,
    approval_status, source_refs, created_at, catalog_v2_version_ref
  )
  SELECT gen_random_uuid(), p.tenant_id, NULL, p.package_key || '-r4', p.name,
    p.eligible_entity_types, p.eligible_activities, p.included_visa_quantity,
    p.office_requirement, p.inclusions, p.price_minor, p.currency,
    p.pricing_effective_from, p.pricing_effective_to, p.additional_fees,
    p.processing_time, p.required_documents, p.exclusions, p.availability,
    p.approval_status, p.source_refs, p.created_at, new_ref
  FROM package_offerings p
  WHERE p.tenant_id = old_version.tenant_id
    AND p.catalog_v2_version_ref = old_version.catalog_version_ref
  ON CONFLICT (tenant_id, package_key) DO NOTHING;
END $$;

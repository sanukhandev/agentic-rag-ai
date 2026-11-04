-- Development ANCFZ V2 catalog revision: approve the natural formation phrase
-- observed in live GPT planning without changing existing session pins.
-- The version/ref are immutable; existing V2 records remain on revision 2.
DO $$
DECLARE
  old_version record;
  revised_catalog jsonb;
  new_ref constant text := 'anc:r3:1de595abd94fc134b5e457113e927c323a29b89da60ffa2cf9dae0574c0d0858';
BEGIN
  IF EXISTS (
    SELECT 1 FROM intent_catalog_v2_versions
    WHERE catalog_version_ref = new_ref
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
  revised_catalog := jsonb_set(revised_catalog, '{manifest,revision}', '3'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{manifest,policyVersion}', '"ancfz-seven-stage-v2-p1"'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,revision}', '3'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,policyVersion}', '"ancfz-seven-stage-v2-p1"'::jsonb, true);
  revised_catalog := jsonb_set(
    revised_catalog,
    '{sheets,IntentSignals}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN signal->>'signalId' = 'signal.company.setup'
            AND NOT (COALESCE(signal->'aliases', '[]'::jsonb) @> '["set up a business"]'::jsonb)
          THEN jsonb_set(signal, '{aliases}', COALESCE(signal->'aliases', '[]'::jsonb) || '["set up a business"]'::jsonb, true)
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
    'published', 'ancfz-catalog-v2-natural-formation-aliases-r3.json',
    '1de595abd94fc134b5e457113e927c323a29b89da60ffa2cf9dae0574c0d0858',
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
  SELECT gen_random_uuid(), p.tenant_id, NULL, p.package_key || '-r3', p.name,
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

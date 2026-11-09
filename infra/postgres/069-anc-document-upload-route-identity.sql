-- Development ANCFZ V2 revision: make the OCR processing binding reachable from
-- the existing purpose-specific document upload tool without enabling SF-02 n8n.
DO $$
DECLARE
  old_version record;
  revised_catalog jsonb;
  new_ref constant text := 'anc:r8:ad28460d71a250eef0640e2cd6246e0a14025e6f6e7dde36eff91423a72645ad';
BEGIN
  IF EXISTS (SELECT 1 FROM intent_catalog_v2_versions WHERE catalog_version_ref = new_ref) THEN
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
  revised_catalog := jsonb_set(revised_catalog, '{manifest,revision}', '8'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{manifest,policyVersion}', '"ancfz-seven-stage-v2-p6"'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,revision}', '8'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,policyVersion}', '"ancfz-seven-stage-v2-p6"'::jsonb, true);
  revised_catalog := jsonb_set(
    revised_catalog,
    '{sheets,WorkflowBindings}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN row->>'workflowKey' = 'anc.document.ocr.extract' THEN jsonb_set(row, '{registryKey}', '"document.sf02.upload"'::jsonb, true)
          ELSE row
        END
        ORDER BY ordinal
      )
      FROM jsonb_array_elements(revised_catalog->'sheets'->'WorkflowBindings') WITH ORDINALITY AS item(row, ordinal)
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
    'published', 'ancfz-catalog-v2-document-upload-route-dev-r8.json',
    'ad28460d71a250eef0640e2cd6246e0a14025e6f6e7dde36eff91423a72645ad',
    'intent-catalog-v2-reviewed-dev-1.0.0', revised_catalog, new_ref, now()
  );

  INSERT INTO package_offerings (
    id, tenant_id, catalog_version_id, package_key, name,
    eligible_entity_types, eligible_activities, included_visa_quantity,
    office_requirement, inclusions, price_minor, currency,
    pricing_effective_from, pricing_effective_to, additional_fees,
    processing_time, required_documents, exclusions, availability,
    approval_status, source_refs, created_at, catalog_v2_version_ref
  )
  SELECT gen_random_uuid(), p.tenant_id, NULL, p.package_key || '-r8', p.name,
    p.eligible_entity_types, p.eligible_activities, p.included_visa_quantity,
    p.office_requirement, p.inclusions, p.price_minor, p.currency,
    p.pricing_effective_from, p.pricing_effective_to, p.additional_fees,
    p.processing_time, jsonb_build_array('identity_document'), p.exclusions, p.availability,
    p.approval_status, p.source_refs, p.created_at, new_ref
  FROM package_offerings p
  WHERE p.tenant_id = old_version.tenant_id
    AND p.catalog_v2_version_ref = old_version.catalog_version_ref
  ON CONFLICT (tenant_id, package_key) DO NOTHING;
END $$;

-- Development ANCFZ V2 revision: declare the OCR processing capability that
-- reaches the enabled OCR workflow binding.
DO $$
DECLARE
  old_version record;
  revised_catalog jsonb;
  new_ref constant text := 'anc:r9:399f45ea9cf7ed60bc69b49681ae2ee8c21215e93a42b7fe4911dcb2da8759c8';
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
  revised_catalog := jsonb_set(revised_catalog, '{manifest,revision}', '9'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{manifest,policyVersion}', '"ancfz-seven-stage-v2-p7"'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,revision}', '9'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,policyVersion}', '"ancfz-seven-stage-v2-p7"'::jsonb, true);
  revised_catalog := jsonb_set(
    revised_catalog,
    '{sheets,ToolBindings}',
    (revised_catalog->'sheets'->'ToolBindings') || jsonb_build_array(jsonb_build_object(
      'toolKey', 'document.ocr.extract',
      'goalKey', 'anc.company_formation',
      'stageKey', 'document_upload',
      'sideEffectClass', 'proposal',
      'argumentsSchemaRef', 'tool.document.ocr.extract.v1',
      'requiredKeys', jsonb_build_array('document_processing_consent', 'document_attachment_confirmation'),
      'consent', 'purpose_specific',
      'confirmation', 'explicit_customer',
      'registryKey', 'anc.document.ocr.extract',
      'enabled', true
    )),
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
    'published', 'ancfz-catalog-v2-document-ocr-dev-r9.json',
    '399f45ea9cf7ed60bc69b49681ae2ee8c21215e93a42b7fe4911dcb2da8759c8',
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
  SELECT gen_random_uuid(), p.tenant_id, NULL, p.package_key || '-r9', p.name,
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

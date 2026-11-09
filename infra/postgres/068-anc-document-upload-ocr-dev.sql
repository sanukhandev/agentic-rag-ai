-- Development ANCFZ V2 revision: expose the reviewed document intake path.
-- Customer upload is processed by the OCR worker; SF-02 remains a separate
-- provider attachment concern and is not activated through the placeholder n8n action template.
-- Existing sessions remain pinned to their immutable catalog revision.
DO $$
DECLARE
  old_version record;
  revised_catalog jsonb;
  new_ref constant text := 'anc:r7:fc2cf08aadb07aac1d541d021a53e982e7abea876016c1dd4f3a33bda6d99c5c';
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
  revised_catalog := jsonb_set(revised_catalog, '{manifest,revision}', '7'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{manifest,policyVersion}', '"ancfz-seven-stage-v2-p5"'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,revision}', '7'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,policyVersion}', '"ancfz-seven-stage-v2-p5"'::jsonb, true);
  revised_catalog := jsonb_set(
    revised_catalog,
    '{sheets,ToolBindings}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN row->>'toolKey' = 'document.sf02_upload' THEN jsonb_set(row, '{enabled}', 'true'::jsonb, true)
          ELSE row
        END
        ORDER BY ordinal
      )
      FROM jsonb_array_elements(revised_catalog->'sheets'->'ToolBindings') WITH ORDINALITY AS item(row, ordinal)
    ),
    true
  );
  revised_catalog := jsonb_set(
    revised_catalog,
    '{sheets,WorkflowBindings}',
    (revised_catalog->'sheets'->'WorkflowBindings') || jsonb_build_array(jsonb_build_object(
      'workflowKey', 'anc.document.ocr.extract',
      'registryKey', 'anc.document.ocr.extract',
      'providerType', 'node',
      'payloadSchemaRef', 'payload.anc.document.ocr.v1',
      'callbackSchemaRef', 'callback.anc.document.ocr.v1',
      'evidencePolicyKey', 'document.ocr.queued',
      'n8nWorkflowId', 'DOC01DocumentProcessing',
      'webhookPath', 'anc-test-document-ocr-wf-1',
      'payloadContract', 'anc-document-ocr-v1',
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
    'published', 'ancfz-catalog-v2-document-upload-dev-r7.json',
    'fc2cf08aadb07aac1d541d021a53e982e7abea876016c1dd4f3a33bda6d99c5c',
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
  SELECT gen_random_uuid(), p.tenant_id, NULL, p.package_key || '-r7', p.name,
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

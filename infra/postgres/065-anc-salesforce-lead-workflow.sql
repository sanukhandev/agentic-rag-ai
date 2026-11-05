-- Development ANCFZ V2 revision: enable only the reviewed Salesforce Lead
-- action after the sandbox create/readback contract was verified.
-- Existing sessions remain pinned to their immutable catalog revision.
DO $$
DECLARE
  old_version record;
  revised_catalog jsonb;
  new_ref constant text := 'anc:r5:dd211ab2ceb8033b242bbf3308afd306c98085495e1ce416416b90ccd0158214';
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
  revised_catalog := jsonb_set(revised_catalog, '{manifest,revision}', '5'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{manifest,policyVersion}', '"ancfz-seven-stage-v2-p3"'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,revision}', '5'::jsonb, true);
  revised_catalog := jsonb_set(revised_catalog, '{sheets,CatalogManifest,0,policyVersion}', '"ancfz-seven-stage-v2-p3"'::jsonb, true);
  revised_catalog := jsonb_set(
    revised_catalog,
    '{sheets,ToolBindings}',
    (
      SELECT jsonb_agg(
        CASE
          WHEN row->>'registryKey' = 'crm.lead.create' THEN jsonb_set(row, '{enabled}', 'true'::jsonb, true)
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
    (
      SELECT jsonb_agg(
        CASE
          WHEN row->>'workflowKey' = 'crm.lead.create' THEN row || jsonb_build_object(
            'enabled', true,
            'providerType', 'salesforce_sandbox',
            'n8nWorkflowId', 'ancfzV2LeadCreateR1',
            'webhookPath', 'ancfz/v2/lead-create',
            'payloadContract', 'ancfz-v2-stage-action-v1'
          )
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
    'published', 'ancfz-catalog-v2-salesforce-lead-dev-r5.json',
    'dd211ab2ceb8033b242bbf3308afd306c98085495e1ce416416b90ccd0158214',
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
  SELECT gen_random_uuid(), p.tenant_id, NULL, p.package_key || '-r5', p.name,
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

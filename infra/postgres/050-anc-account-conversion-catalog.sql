DO $$
DECLARE
  catalog_row RECORD;
  updated_catalog jsonb;
BEGIN
  SELECT v.id, v.catalog_json
  INTO catalog_row
  FROM intent_catalog_versions v
  JOIN tenants t ON t.id = v.tenant_id
  WHERE t.slug = 'anc' AND v.status = 'published'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  updated_catalog := catalog_row.catalog_json;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(updated_catalog->'intents', '[]'::jsonb)) item WHERE item->>'intentKey' = 'account.registration') THEN
    updated_catalog := jsonb_set(updated_catalog, '{intents}', COALESCE(updated_catalog->'intents', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'intentKey', 'account.registration', 'displayName', 'Account registration', 'description', 'Convert a verified Lead when the configured business gate is satisfied.', 'category', 'sales', 'workflowKey', 'crm.account.convert', 'minimumScore', 0, 'confidenceThreshold', 0, 'confirmationRequired', false, 'active', true, 'priority', 70, 'versionNote', 'Development sandbox account conversion binding.'
    )));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(updated_catalog->'workflowBindings', '[]'::jsonb)) item WHERE item->>'workflowKey' = 'crm.account.convert') THEN
    updated_catalog := jsonb_set(updated_catalog, '{workflowBindings}', COALESCE(updated_catalog->'workflowBindings', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'workflowKey', 'crm.account.convert', 'n8nWorkflowId', 'ANCAccountConversionWF1', 'webhookPath', 'anc-account-conversion-wf-1', 'payloadContract', 'anc-account-conversion-v1', 'sideEffectClass', 'crm_write', 'active', true
    )));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(updated_catalog->'crmAccountConversionPolicies', '[]'::jsonb)) item WHERE item->>'intentKey' = 'account.registration' AND item->>'conversionRule' = 'package_confirmed') THEN
    updated_catalog := jsonb_set(updated_catalog, '{crmAccountConversionPolicies}', COALESCE(updated_catalog->'crmAccountConversionPolicies', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'intentKey', 'account.registration', 'workflowKey', 'crm.account.convert', 'conversionRule', 'package_confirmed', 'active', true, 'notes', 'Development conversion is allowed after explicit package confirmation and verified Lead identity.'
    )));
  END IF;

  UPDATE intent_catalog_versions SET catalog_json = updated_catalog WHERE id = catalog_row.id;
END $$;

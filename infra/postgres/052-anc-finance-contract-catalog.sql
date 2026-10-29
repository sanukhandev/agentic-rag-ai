DO $$
DECLARE
  catalog_row RECORD;
  updated_catalog jsonb;
BEGIN
  SELECT v.id, v.catalog_json INTO catalog_row
  FROM intent_catalog_versions v JOIN tenants t ON t.id=v.tenant_id
  WHERE t.slug='anc' AND v.status='published' FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  updated_catalog := catalog_row.catalog_json;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(updated_catalog->'intents','[]'::jsonb)) item WHERE item->>'intentKey'='invoice.request') THEN
    updated_catalog := jsonb_set(updated_catalog, '{intents}', COALESCE(updated_catalog->'intents','[]'::jsonb) || jsonb_build_array(jsonb_build_object('intentKey','invoice.request','displayName','Invoice request','description','Prepare an authorized invoice after package confirmation.','category','sales','workflowKey','finance.invoice.create','minimumScore',0,'confidenceThreshold',0,'confirmationRequired',true,'active',true,'priority',60,'versionNote','Development sandbox billing binding.')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(updated_catalog->'intents','[]'::jsonb)) item WHERE item->>'intentKey'='contract.preparation') THEN
    updated_catalog := jsonb_set(updated_catalog, '{intents}', COALESCE(updated_catalog->'intents','[]'::jsonb) || jsonb_build_array(jsonb_build_object('intentKey','contract.preparation','displayName','Contract preparation','description','Prepare an authorized contract draft after verified prerequisites.','category','sales','workflowKey','legal.contract.prepare','minimumScore',0,'confidenceThreshold',0,'confirmationRequired',true,'active',true,'priority',50,'versionNote','Development sandbox contract binding.')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(updated_catalog->'workflowBindings','[]'::jsonb)) item WHERE item->>'workflowKey'='finance.invoice.create') THEN
    updated_catalog := jsonb_set(updated_catalog, '{workflowBindings}', COALESCE(updated_catalog->'workflowBindings','[]'::jsonb) || jsonb_build_array(jsonb_build_object('workflowKey','finance.invoice.create','n8nWorkflowId','ANCInvoiceGenerationWF1','webhookPath','anc-invoice-generation-wf-1','payloadContract','anc-invoice-generation-v1','sideEffectClass','finance_write','active',true)));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(updated_catalog->'workflowBindings','[]'::jsonb)) item WHERE item->>'workflowKey'='legal.contract.prepare') THEN
    updated_catalog := jsonb_set(updated_catalog, '{workflowBindings}', COALESCE(updated_catalog->'workflowBindings','[]'::jsonb) || jsonb_build_array(jsonb_build_object('workflowKey','legal.contract.prepare','n8nWorkflowId','ANCContractPreparationWF1','webhookPath','anc-contract-preparation-wf-1','payloadContract','anc-contract-preparation-v1','sideEffectClass','contract_write','active',true)));
  END IF;
  UPDATE intent_catalog_versions SET catalog_json=updated_catalog WHERE id=catalog_row.id;
END $$;

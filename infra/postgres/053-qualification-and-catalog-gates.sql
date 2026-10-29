ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS qualification_status text NOT NULL DEFAULT 'pending'
    CHECK (qualification_status IN ('pending','qualified','disqualified','reconcile_required'));
ALTER TABLE crm_leads
  ADD COLUMN IF NOT EXISTS qualification_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The starter pricebook is synthetic development data, not an approved ANCFZ source.
UPDATE package_offerings
SET approval_status = 'unavailable', price_minor = NULL, currency = NULL, source_refs = '[]'::jsonb
WHERE availability = 'development_only' AND source_refs @> '["sandbox-pricebook-v1"]'::jsonb;

-- Account creation follows qualification. Existing package/invoice policies remain
-- readable for legacy journeys but a new qualification policy is required.
UPDATE intent_catalog_versions
SET catalog_json = jsonb_set(
  catalog_json,
  '{crmAccountConversionPolicies}',
  COALESCE(catalog_json->'crmAccountConversionPolicies', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'intentKey', 'account.registration',
      'workflowKey', 'crm.account.convert',
      'conversionRule', 'qualification_verified',
      'active', true,
      'notes', 'Account conversion requires server-verified qualification and Lead identity.'
    )
  )
)
WHERE status = 'published'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(catalog_json->'crmAccountConversionPolicies', '[]'::jsonb)) item
    WHERE item->>'conversionRule' = 'qualification_verified'
  );

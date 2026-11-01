import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const apiBase = (process.env.API_BASE_URL ?? 'http://127.0.0.1:4100').replace(/\/$/u, '');
const outputDir = process.env.OUTPUT_DIR ?? 'artifacts/ancfz-stage5-api-uat';
const composeFile = process.env.UAT_COMPOSE_FILE ?? 'docker-compose.anc-mock-uat.yml';
const project = process.env.UAT_COMPOSE_PROJECT ?? 'anc-mock-uat';
const origin = process.env.UAT_ORIGIN ?? 'http://127.0.0.1:4100';
const platform = { email: 'anc-mock-platform@example.test', password: 'AncMockPlatform1Password' };
const tenants = [
  { slug: 'anc', name: 'ANC Mock UAT', adminEmail: 'anc-mock-admin@example.test', adminPassword: 'AncMockAdmin1Password', catalogId: '10000000-0000-4000-8000-000000000001', packageId: '20000000-0000-4000-8000-000000000001' },
  { slug: 'anc-empty', name: 'ANC Empty-RAG UAT', adminEmail: 'anc-empty-admin@example.test', adminPassword: 'AncEmptyAdmin1Password', catalogId: '10000000-0000-4000-8000-000000000002', packageId: '20000000-0000-4000-8000-000000000002' },
];

const request = async (path, options = {}, expected = [200]) => {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text.slice(0, 200) }; }
  if (!expected.includes(response.status)) throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

const ensurePlatform = async () => {
  const registered = await request('/api/v1/auth/register-platform', { method: 'POST', body: JSON.stringify(platform) }, [201, 409]);
  if (registered?.token) return registered.token;
  return (await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(platform) })).token;
};

const ensureTenant = async (platformToken, definition) => {
  const created = await request('/api/v1/admin/tenants', { method: 'POST', headers: auth(platformToken), body: JSON.stringify(definition) }, [201, 409]);
  let tenant = created?.tenant;
  if (!tenant) tenant = (await request('/api/v1/admin/tenants', { headers: auth(platformToken) })).items.find((item) => item.slug === definition.slug);
  assert.ok(tenant, `tenant ${definition.slug} should exist`);
  const admin = await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email: definition.adminEmail, password: definition.adminPassword }) });
  const headers = auth(admin.token);
  await request('/api/v1/admin/persona', { method: 'PUT', headers, body: JSON.stringify({ name: 'Zara', greeting: `Welcome to ${definition.name}.`, personality: 'Helpful, careful and precise.', tone: 'Warm and clear', speakingStyle: 'Short, natural answers', permittedLanguages: ['en'] }) });
  await request('/api/v1/admin/channel', { method: 'PATCH', headers, body: JSON.stringify({ publicOrigin: origin, publicChatEnabled: true }) });
  return { ...definition, tenant, adminToken: admin.token };
};

const workflowBindings = [
  { workflowKey: 'crm.lead.create', n8nWorkflowId: 'ANCMockLeadCreate', webhookPath: 'anc-lead-capture-wf-1', payloadContract: 'anc-lead-capture-v1', sideEffectClass: 'crm_write', active: true },
  { workflowKey: 'crm.account.convert', n8nWorkflowId: 'ANCMockAccountConvert', webhookPath: 'anc-account-conversion-wf-1', payloadContract: 'anc-account-conversion-v1', sideEffectClass: 'crm_write', active: true },
  { workflowKey: 'anc.document.ocr.extract', n8nWorkflowId: 'ANCMockDocumentOcr', webhookPath: 'anc-document-ocr-wf-1', payloadContract: 'anc-document-ocr-v1', sideEffectClass: 'crm_write', active: true },
];

const slot = (slotKey, dataType, collectionOrder, promptKey, validationRule, retentionClass = 'journey_fact') => ({ intentKey: 'anc.company_formation', slotKey, dataType, required: true, alternativeGroup: null, collectionOrder, promptKey, validationRule, retentionClass, qualityWeight: 1 });
const requirement = (requirementKey, requirementType, collectionOrder, promptKey, validationRule, slotKey = null, extra = {}) => ({ intentKey: 'anc.company_formation', requirementKey, requirementType, required: true, collectionOrder, promptKey, validationRule, slotKey, documentType: null, fulfillmentMode: 'conversation_ready', sourceOfTruth: 'customer', notes: 'Synthetic disposable UAT requirement.', ...extra });

const legacyCatalog = (tenantScope) => ({
  tenantScope,
  intents: [
    { intentKey: 'anc.company_formation', displayName: 'Company formation', description: 'Guide a customer through the synthetic company-formation journey.', category: 'company_formation', workflowKey: 'crm.lead.create', minimumScore: 50, confidenceThreshold: 0.5, confirmationRequired: true, active: true, priority: 100, versionNote: 'Disposable UAT catalog; no production provider.' },
    { intentKey: 'account.registration', displayName: 'Account creation', description: 'Create an Account only after verified qualification.', category: 'sales', workflowKey: 'crm.account.convert', minimumScore: 0, confidenceThreshold: 0, confirmationRequired: true, active: true, priority: 90, versionNote: 'Disposable UAT catalog; no production provider.' },
  ],
  signals: [
    { intentKey: 'anc.company_formation', signalId: 'anc-uat-company-formation', signalType: 'phrase', value: 'software consulting', language: 'en', matchMode: 'contains', weight: 90, relationGroup: null, notes: '' },
    { intentKey: 'anc.company_formation', signalId: 'anc-uat-start-company', signalType: 'keyword', value: 'company', language: 'en', matchMode: 'contains', weight: 20, relationGroup: null, notes: '' },
  ],
  slots: [
    slot('business_activity', 'text', 1, 'ask.business_activity', 'text:business_activity'),
    slot('entity_type', 'enum', 2, 'ask.entity_type', 'enum:FZE|FZC|LLC'),
    slot('visa_count', 'integer', 3, 'ask.visa_count', 'integer:positive'),
    slot('timeline', 'text', 4, 'ask.timeline', 'text:timeline'),
    slot('name', 'person_name', 5, 'ask.name', 'token:NAME', 'crm_contact'),
    slot('email', 'email', 6, 'ask.email', 'token:EMAIL', 'crm_contact'),
    slot('phone', 'phone', 7, 'ask.phone', 'token:PHONE', 'crm_contact'),
    { ...slot('contact_consent', 'boolean', 8, 'confirm.contact_consent', 'boolean:explicit_opt_in', 'crm_consent'), required: false },
  ],
  relations: [],
  workflowBindings,
  journeyRequirements: [
    requirement('business_activity', 'slot', 1, 'ask.business_activity', 'text:business_activity', 'business_activity'),
    requirement('entity_type', 'slot', 2, 'ask.entity_type', 'enum:FZE|FZC|LLC', 'entity_type'),
    requirement('visa_count', 'slot', 3, 'ask.visa_count', 'integer:positive', 'visa_count'),
    requirement('timeline', 'slot', 4, 'ask.timeline', 'text:timeline', 'timeline'),
    requirement('name', 'slot', 5, 'ask.name', 'token:NAME', 'name'),
    requirement('email', 'slot', 6, 'ask.email', 'token:EMAIL', 'email'),
    requirement('phone', 'slot', 7, 'ask.phone', 'token:PHONE', 'phone'),
    requirement('contact_consent', 'consent', 8, 'confirm.contact_consent', 'boolean:explicit_opt_in', null, { sourceOfTruth: 'customer', visitorConfirmationText: 'I consent to being contacted about this request.' }),
    requirement('business_supporting_document', 'document', 100, 'request.business_supporting_document', 'document:business_supporting_document', null, { required: false, documentType: 'business_supporting_document', fulfillmentMode: 'external_confirmation_required', sourceOfTruth: 'provider' }),
  ],
  journeyTransitions: [],
  businessStages: [
    ['lead_generation', 'Lead Generation', 'crm.lead.create'],
    ['lead_qualification', 'Lead Qualification', 'crm.lead.create'],
    ['account_creation', 'Account Creation', 'crm.account.convert'],
    ['package_selection', 'Package Selection', 'crm.account.convert'],
    ['document_upload', 'Document Upload', 'anc.document.ocr.extract'],
    ['billing_invoice', 'Payment Details & Invoice', 'crm.account.convert'],
    ['contract', 'Contract', 'crm.account.convert'],
  ].map(([stageKey, displayName, workflowKey], index) => ({ order: index + 1, stageKey, displayName, authoritativeOwner: 'Node UAT authority', prerequisiteExpression: 'verified prior stage', successEvidence: 'deterministic mock provider evidence', workflowKey, onFailure: 'stop and report pending or failed', testRequirement: 'synthetic API assertion', status: 'ACTIVE' })),
  documentPolicies: [{ intentKey: 'anc.company_formation', enabled: true, workflowKey: 'anc.document.ocr.extract', requestMode: 'explicit_upload', required: false, requestPromptKey: 'request.business_supporting_document', allowedDocumentTypes: ['business_supporting_document'], allowUserInitiated: true, consentRequired: true, preservePrimaryIntent: true, storeExtractedText: false, summaryTarget: 'journey', autoCreateLead: false, autoIndexInRag: false, notes: 'Synthetic PDF only; SF-02 is intentionally not claimed.' }],
  documentSettings: { schemaVersion: 'anc-mock-uat-v1', enabled: true, storageBackend: 'private_local', processingProvider: 'deterministic_mock', workflowKey: 'anc.document.ocr.extract', requireUploadConsent: true, maxFileBytes: 10 * 1024 * 1024, maxFilesPerRequest: 1, maxPdfPages: 20, ocrLanguages: ['eng'], allowedMimeTypes: ['application/pdf'], retentionPolicy: 'disposable_uat', allowPublicDocumentUrls: false, allowAutomaticKnowledgeIngestion: false, allowPersonalIdentityDocumentsByDefault: false, summaryRendering: 'redacted_summary_only', notes: 'No real identity documents permitted.' },
  crmAccountConversionPolicies: [{ intentKey: 'account.registration', workflowKey: 'crm.account.convert', conversionRule: 'qualification_verified', active: true, notes: 'Explicit confirmation plus verified qualification required.' }],
  qualityRules: [],
});

const sqlQuote = (value) => {
  let tag = 'uat';
  while (value.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${value}$${tag}$`;
};

const seedLegacyCatalog = (records) => {
  const statements = ['BEGIN'];
  for (const record of records) {
    const catalogJson = JSON.stringify(legacyCatalog(record.slug));
    const sourceHash = createHash('sha256').update(catalogJson).digest('hex');
    statements.push(`UPDATE intent_catalog_versions SET status = 'draft', published_at = NULL WHERE tenant_id = '${record.tenant.id}' AND status = 'published'`);
    statements.push(`INSERT INTO intent_catalog_versions (id, tenant_id, version, status, source_file_name, source_hash, parser_version, catalog_json, published_at) VALUES ('${record.catalogId}', '${record.tenant.id}', 1, 'published', 'anc-mock-uat-${record.slug}.json', '${sourceHash}', 'anc-mock-uat-v1', ${sqlQuote(catalogJson)}::jsonb, now()) ON CONFLICT (id) DO UPDATE SET status = 'published', source_hash = EXCLUDED.source_hash, catalog_json = EXCLUDED.catalog_json, published_at = now()`);
    statements.push(`INSERT INTO package_offerings (id, tenant_id, catalog_version_id, package_key, name, eligible_entity_types, eligible_activities, included_visa_quantity, office_requirement, inclusions, price_minor, currency, pricing_effective_from, pricing_effective_to, additional_fees, processing_time, required_documents, exclusions, availability, approval_status, source_refs) VALUES ('${record.packageId}', '${record.tenant.id}', '${record.catalogId}', 'anc-mock-basic', 'ANC Mock Basic', '["LLC","FZE","FZC"]'::jsonb, '["software consulting"]'::jsonb, 3, 'shared', '["company formation","three visas"]'::jsonb, 250000, 'AED', now(), now() + interval '30 days', '[]'::jsonb, 'not authoritative in UAT', '["business_supporting_document"]'::jsonb, '["third-party fees"]'::jsonb, 'development_only', 'approved', '["anc-mock-uat-pricebook-v1"]'::jsonb) ON CONFLICT (tenant_id, package_key) DO UPDATE SET catalog_version_id = EXCLUDED.catalog_version_id, approval_status = 'approved', price_minor = EXCLUDED.price_minor, source_refs = EXCLUDED.source_refs`);
  }
  statements.push('COMMIT');
  const result = spawnSync('docker', ['compose', '-p', project, '-f', composeFile, 'exec', '-T', 'postgres', 'psql', '-U', 'anc_mock_uat', '-d', 'anc_mock_uat', '-v', 'ON_ERROR_STOP=1'], { input: `${statements.join(';\n')};\n`, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`UAT catalog seed failed: ${String(result.stderr).slice(0, 500)}`);
};

const publishV2 = async (record) => {
  const fixture = JSON.parse(await readFile('services/api/src/fixtures/ancfz-catalog-v2.json', 'utf8'));
  fixture.manifest = { ...fixture.manifest, catalogKey: `anc-mock-uat-${record.slug}`, tenantScope: record.slug };
  fixture.sheets.CatalogManifest = [{ ...fixture.sheets.CatalogManifest[0], catalogKey: `anc-mock-uat-${record.slug}`, tenantScope: record.slug }];
  const headers = auth(record.adminToken);
  const sourceHash = createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
  const created = await request('/api/v2/admin/intent-catalog/versions', { method: 'POST', headers: { ...headers, 'x-tenant-id': record.tenant.id }, body: JSON.stringify({ sourceFileName: `anc-mock-uat-${record.slug}.json`, sourceHash, catalog: fixture }) }, [201, 409]);
  let version = created?.version;
  if (!version) version = (await request('/api/v2/admin/intent-catalog/versions', { headers: { ...headers, 'x-tenant-id': record.tenant.id } })).items.find((item) => item.sourceHash === sourceHash);
  assert.ok(version, `v2 catalog for ${record.slug} should exist`);
  if (version.status !== 'published') await request(`/api/v2/admin/intent-catalog/versions/${version.id}/publish`, { method: 'POST', headers: { ...headers, 'x-tenant-id': record.tenant.id } });
  return { v2VersionId: version.id, sourceHash };
};

const platformToken = await ensurePlatform();
const records = [];
for (const definition of tenants) records.push(await ensureTenant(platformToken, definition));
seedLegacyCatalog(records);
for (const record of records) record.v2 = await publishV2(record);
await mkdir(outputDir, { recursive: true });
const summary = {
  generatedAt: new Date().toISOString(),
  apiBase,
  project,
  modelMode: 'mock',
  tenantIds: Object.fromEntries(records.map((record) => [record.slug, record.tenant.id])),
  catalogIds: Object.fromEntries(records.map((record) => [record.slug, record.catalogId])),
  v2VersionIds: Object.fromEntries(records.map((record) => [record.slug, record.v2.v2VersionId])),
  syntheticOnly: true,
  sf02Verified: false,
};
await writeFile(`${outputDir}/bootstrap.json`, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));

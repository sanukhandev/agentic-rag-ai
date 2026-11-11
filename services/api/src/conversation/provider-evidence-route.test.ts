import request from 'supertest';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2, type CatalogV2Document } from './catalog.js';
import { newConversationState } from '../conversation-state.js';
import { initializeConfirmedV2Journey } from './journey-bootstrap.js';
import { MemoryStore } from '../store-memory.js';
import { TokenVault } from '../privacy.js';
import { DeterministicV2AccountProvider, V2OtpChallengeService } from './account-provider.js';
import { DeterministicV2DocumentProvider } from './document-provider.js';
import { DeterministicV2PaymentProvider } from './payment-provider.js';
import { DeterministicV2ContractProvider } from './contract-provider.js';
import { completeLifecycleStage } from '../lifecycle-state.js';
import { createApprovedQuote, proposePackageSelectionAfterLead } from '../business-lifecycle.js';

const catalog = (providerType: string): CatalogV2Document => {
  const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('../fixtures/ancfz-catalog-v2-seven-stage.json', import.meta.url), 'utf8')));
  if (!parsed.ok || !parsed.document) throw new Error('fixture invalid');
  const document = parsed.document;
  const tool = document.sheets.ToolBindings.find((candidate) => candidate.registryKey === 'crm.lead.create');
  const workflow = document.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === 'crm.lead.create');
  if (!tool || !workflow) throw new Error('lead binding missing');
  tool.enabled = true;
  workflow.enabled = true;
  workflow.providerType = providerType;
  workflow.n8nWorkflowId = 'ancfzV2LeadCreateR1';
  workflow.webhookPath = 'ancfz/v2/lead-create';
  workflow.payloadContract = 'ancfz-v2-stage-action-v1';
  const accountTool = document.sheets.ToolBindings.find((candidate) => candidate.registryKey === 'crm.account.create');
  const accountWorkflow = document.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === 'crm.account.create');
  if (!accountTool || !accountWorkflow) throw new Error('account binding missing');
  accountTool.enabled = true;
  accountWorkflow.enabled = true;
  accountWorkflow.providerType = providerType;
  accountWorkflow.n8nWorkflowId = 'ancfzV2AccountCreateR1';
  accountWorkflow.webhookPath = 'ancfz/v2/account-create';
  accountWorkflow.payloadContract = 'ancfz-v2-account-action-v1';
  const documentTool = document.sheets.ToolBindings.find((candidate) => candidate.registryKey === 'document.sf02.upload');
  const documentWorkflow = document.sheets.WorkflowBindings.find((candidate) => candidate.registryKey === 'document.sf02.upload');
  if (!documentTool || !documentWorkflow) throw new Error('document binding missing');
  documentTool.enabled = true;
  documentWorkflow.enabled = true;
  documentWorkflow.providerType = providerType;
  documentWorkflow.n8nWorkflowId = 'ancfzV2DocumentUploadR1';
  documentWorkflow.webhookPath = 'ancfz/v2/document-upload';
  documentWorkflow.payloadContract = 'ancfz-v2-document-upload-v1';
  document.sheets.ToolBindings.push({
    toolKey: 'document.ocr.extract',
    goalKey: 'anc.company_formation',
    stageKey: 'document_upload',
    sideEffectClass: 'proposal',
    argumentsSchemaRef: 'tool.document.ocr.extract.v1',
    requiredKeys: ['document_processing_consent', 'document_attachment_confirmation'],
    consent: 'purpose_specific',
    confirmation: 'explicit_customer',
    registryKey: 'anc.document.ocr.extract',
    enabled: true,
  });
  document.sheets.WorkflowBindings.push({
    workflowKey: 'anc.document.ocr.extract',
    registryKey: 'anc.document.ocr.extract',
    providerType: 'node',
    payloadSchemaRef: 'payload.anc.document.ocr.v1',
    callbackSchemaRef: 'callback.anc.document.ocr.v1',
    evidencePolicyKey: 'document.ocr.queued',
    n8nWorkflowId: 'DOC01DocumentProcessing',
    webhookPath: 'anc-test-document-ocr-wf-1',
    payloadContract: 'anc-document-ocr-v1',
    enabled: true,
  });
  const invoiceTool = document.sheets.ToolBindings.find((candidate) => candidate.toolKey === 'invoice.issue');
  const invoiceWorkflow = document.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === 'invoice.issue');
  if (!invoiceTool || !invoiceWorkflow) throw new Error('invoice binding missing');
  invoiceTool.enabled = true;
  invoiceWorkflow.enabled = true;
  invoiceWorkflow.providerType = providerType;
  invoiceWorkflow.n8nWorkflowId = 'ancfzV2InvoiceIssueR1';
  invoiceWorkflow.webhookPath = 'ancfz/v2/invoice-issue';
  invoiceWorkflow.payloadContract = 'ancfz-v2-invoice-issue-v1';
  for (const [toolKey, workflowKey, workflowId, webhookPath, payloadContract] of [
    ['payment.authorize', 'payment.authorize', 'ancfzV2PaymentAuthorizeR1', 'ancfz/v2/payment-authorize', 'ancfz-v2-payment-authorize-v1'],
    ['contract.send', 'contract.send', 'ancfzV2ContractSendR1', 'ancfz/v2/contract-send', 'ancfz-v2-contract-send-v1'],
  ] as const) {
    const paymentTool = document.sheets.ToolBindings.find((candidate) => candidate.toolKey === toolKey);
    const paymentWorkflow = document.sheets.WorkflowBindings.find((candidate) => candidate.workflowKey === workflowKey);
    if (!paymentTool || !paymentWorkflow) throw new Error(`${toolKey} binding missing`);
    paymentTool.enabled = true;
    paymentWorkflow.enabled = true;
    paymentWorkflow.providerType = providerType;
    paymentWorkflow.n8nWorkflowId = workflowId;
    paymentWorkflow.webhookPath = webhookPath;
    paymentWorkflow.payloadContract = payloadContract;
  }
  return document;
};

async function makeFixture(providerType: string, v2SalesforceLeadProvider?: { verify: (input: { request: { tenantId: string; sessionId: string; opportunityId: string; idempotencyKey: string }; providerRecordId: string }) => Promise<{ tenantId: string; sessionId: string; opportunityId: string; providerType: string; idempotencyKey: string; recordRef: string; evidenceTier: 'provider_record_verified'; verificationStatus: 'verified' }> }, v2SalesforceAccountProvider?: { verifyAccount: (input: { request: { tenantId: string; sessionId: string; opportunityId: string; idempotencyKey: string; leadExternalId: string }; providerRecordId: string }) => Promise<{ tenantId: string; sessionId: string; opportunityId: string; providerType: string; idempotencyKey: string; recordRef: string; evidenceTier: 'provider_record_verified'; verificationStatus: 'verified'; remoteAccountId: string; remoteContactId: string; remoteOpportunityId: string; leadExternalId: string; deduplicated: boolean }> }, v2SalesforceLeadMutationProvider?: { updateLeadDescription: (input: { providerRecordId: string; description: string }) => Promise<{ recordRef: string; description: string }>; createLeadAttachment: (input: { providerRecordId: string; fileName: string; contentBase64: string }) => Promise<{ attachmentRef: string; parentRef: string; fileName: string; sizeBytes: number }> }, documentStorageRoot?: string) {
  const store = new MemoryStore();
  const tokenVault = new TokenVault('provider-evidence-route-test-secret');
  const otp = new V2OtpChallengeService('provider-evidence-route-otp-secret');
  const accountProvider = new DeterministicV2AccountProvider();
  const documentProvider = new DeterministicV2DocumentProvider();
  const paymentProvider = new DeterministicV2PaymentProvider();
  const contractProvider = new DeterministicV2ContractProvider();
  const runtime = createApp({ store, nodeEnv: 'test', tokenVault, n8nCallbackSecret: 'n'.repeat(64), ingestionWorkerSecret: 'i'.repeat(64), v2AccountOtp: otp, ...(documentStorageRoot ? { documentStorageRoot } : {}), ...(v2SalesforceLeadProvider ? { v2SalesforceLeadProvider } : {}), ...(v2SalesforceAccountProvider ? { v2SalesforceAccountProvider } : {}), ...(v2SalesforceLeadMutationProvider ? { v2SalesforceLeadMutationProvider } : {}), v2AccountProvider: accountProvider, v2DocumentProvider: documentProvider, v2PaymentProvider: paymentProvider, v2ContractProvider: contractProvider });
  const tenant = await store.createTenant({ name: 'Provider Evidence', slug: `provider-evidence-${randomUUID()}` });
  const session = await store.createSession(tenant.id);
  const document = catalog(providerType);
  const version = await store.createIntentCatalogV2Version({ tenantId: tenant.id, status: 'draft', sourceFileName: 'fixture.json', sourceHash: catalogV2Sha256(document), parserVersion: 'test', catalogVersionRef: catalogV2VersionRef(document), catalog: document });
  const published = await store.publishIntentCatalogV2Version(tenant.id, version.id);
  if (!published) throw new Error('catalog publication failed');
  const timestamp = new Date().toISOString();
  const goalDocument = {
    id: randomUUID(), tenantId: tenant.id, sessionId: session.id, catalogSource: 'v2' as const,
    catalogVersionRef: published.catalogVersionRef, personaVersionId: null, opportunityId: null,
    businessGoalKey: 'anc.company_formation', turnIntentKey: 'goal.company_formation', currentStageKey: null,
    stageRevision: 0, goalConfirmed: true,
    goalConfirmation: { status: 'confirmed' as const, goalKey: 'anc.company_formation', proposalMessageId: randomUUID(), promptId: randomUUID(), catalogVersionRef: published.catalogVersionRef, personaVersionId: 'persona-test', sessionRevision: 1, intentRevision: 0, issuedAt: timestamp, customerMessageId: randomUUID(), customerClientMessageId: randomUUID(), decidedAt: timestamp },
    verifiedFacts: {}, pendingRequirementKey: null, lastQuestion: null, approvedResponse: null, toolRefs: [], sourceRefs: [], summary: '', summaryRevision: 0, revision: 1, createdAt: timestamp, updatedAt: timestamp,
  };
  const bootstrap = initializeConfirmedV2Journey(newConversationState(), goalDocument);
  const scopedSession = { ...session, conversationState: { ...bootstrap.state, catalogVersionId: published.id } };
  tokenVault.save(scopedSession, [{ token: '[NAME_1]', value: 'Synthetic Customer' }, { token: '[EMAIL_1]', value: 'synthetic.provider@example.test' }, { token: '[PHONE_1]', value: '+971501234567' }]);
  await store.updateSession(scopedSession);
  await store.createUserIntentDocument(bootstrap.document);
  const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'anc.company_formation', intentScore: 95, intentConfidence: 0.98, catalogVersionId: published.catalogVersionRef, opportunityId: bootstrap.document.opportunityId, actionKey: 'lead.create', actionRevision: 1, idempotencyKey: 'v2-provider-evidence-route', state: 'processing', opaqueReference: 'v2-provider-evidence-action', payload: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]', contactConsent: true, slotValues: { lead_contact_name: '[NAME_1]', lead_contact_channel: '[EMAIL_1]', lead_crm_consent: 'true', lead_action_confirmation: 'true', business_activity: 'technology consulting' } }, createdAt: timestamp, result: null });
  await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: tenant.id, role: 'user', maskedContent: 'I want to start a technology consulting company next month.', citations: [], clientMessageId: 'provider-evidence-user', response: null, createdAt: timestamp });
  const eventId = randomUUID();
  const correlationId = randomUUID();
  await store.claimActionExecution({ id: randomUUID(), actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, catalogVersionId: action.catalogVersionId ?? null, providerStatus: 'processing', n8nExecutionRef: 'n8n-provider-evidence-test', eventId, correlationId, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: timestamp, updatedAt: timestamp });
  return { runtime, store, tenant, session, published, action, eventId, correlationId, otp, providerRecordId: `mock-lead-${createHash('sha256').update(action.idempotencyKey).digest('hex').slice(0, 24)}` };
}

type ProviderFixture = Awaited<ReturnType<typeof makeFixture>>;

const bodyFor = (test: ProviderFixture) => ({
  actionId: test.action.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: test.action.opportunityId,
  stageKey: 'lead_generation', workflowKey: 'crm.lead.create', providerType: 'deterministic_mock', providerRecordId: test.providerRecordId,
  eventId: test.eventId, correlationId: test.correlationId, attempt: 1, idempotencyKey: test.action.idempotencyKey,
  catalogVersionId: test.published.catalogVersionRef, actionKey: test.action.actionKey, actionRevision: test.action.actionRevision,
});

describe('V2 provider evidence route', () => {
  it('does not let a pinned V2 session mint a quote through the legacy quote endpoint', async () => {
    const test = await makeFixture('deterministic_mock');
    await test.store.createCrmAccount({
      id: randomUUID(), tenantId: test.tenant.id, opportunityId: test.action.opportunityId!, leadId: randomUUID(),
      remoteAccountId: '001-v2-quote-gate', remoteContactId: '003-v2-quote-gate', remoteOpportunityId: '006-v2-quote-gate',
      status: 'verified', conversionRule: 'qualification_verified', verifiedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const offering = await test.store.createPackageOffering({
      id: randomUUID(), tenantId: test.tenant.id, catalogVersionId: null, catalogVersionRef: test.published.catalogVersionRef,
      packageKey: 'anc-v2-quote-gate', name: 'ANCFZ quote gate fixture', eligibleEntityTypes: [], eligibleActivities: [],
      includedVisaQuantity: 1, officeRequirement: 'shared', inclusions: ['synthetic quote'], priceMinor: 100000, currency: 'AED',
      pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development', requiredDocuments: [],
      exclusions: [], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['synthetic'], createdAt: new Date().toISOString(),
    });
    const response = await request(test.runtime.app)
      .post(`/api/v1/chat/sessions/${test.session.id}/packages/quotes`)
      .set('origin', 'http://localhost')
      .send({ opportunityId: test.action.opportunityId, packageOfferingId: offering.id });
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'QUOTE_WORKFLOW_REQUIRED' } });
    expect((await test.store.getQuote('00000000-0000-4000-8000-000000000099', test.tenant.id))).toBeNull();
  });

  it('generates and serves one development quote through the internal API boundary', async () => {
    const pdfBytes = Buffer.from('%PDF-1.4\nsynthetic quote fixture\n%%EOF');
    const artifactHash = createHash('sha256').update(pdfBytes).digest('hex');
    let renderPayload: Record<string, unknown> | null = null;
    const pdfServer = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/v1/render') {
        let body = '';
        for await (const chunk of req) body += chunk.toString();
        renderPayload = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ artifactId: artifactHash, sha256: artifactHash, bytes: pdfBytes.length }));
        return;
      }
      if (req.method === 'GET' && req.url === `/v1/artifacts/${artifactHash}`) {
        res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': pdfBytes.length });
        res.end(pdfBytes);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => pdfServer.listen(0, '127.0.0.1', resolve));
    const address = pdfServer.address();
    if (!address || typeof address === 'string') throw new Error('PDF test server did not bind.');
    const storageRoot = await mkdtemp(join(tmpdir(), 'anc-quote-api-'));
    const previous = { local: process.env.QUOTE_WORKFLOW_ENABLED, url: process.env.QUOTE_PDF_RENDER_URL, key: process.env.QUOTE_PDF_API_KEY };
    process.env.QUOTE_WORKFLOW_ENABLED = 'true';
    process.env.QUOTE_PDF_RENDER_URL = `http://127.0.0.1:${address.port}/v1/render`;
    process.env.QUOTE_PDF_API_KEY = 'synthetic-quote-api-key-1234567890';
    try {
      const test = await makeFixture('deterministic_mock', undefined, undefined, undefined, storageRoot);
      const opportunityId = test.action.opportunityId!;
      const currentSession = await test.store.getSession(test.session.id);
      if (!currentSession?.conversationState) throw new Error('session state missing');
      const intentKey = currentSession.conversationState.intentProgress?.activeIntentKey ?? 'anc.company_formation';
      const entry = currentSession.conversationState.intentProgress?.entries[intentKey];
      if (!entry?.lifecycle || !entry.journeyId) throw new Error('synthetic lifecycle missing');
      const qualified = completeLifecycleStage(completeLifecycleStage(completeLifecycleStage(entry.lifecycle, 'lead_generation', { leadVerified: true }), 'lead_qualification', { qualificationVerified: true }), 'account_creation', { accountProviderVerified: true });
      const advancedEntry = { ...entry, lifecycle: qualified, revision: entry.revision + 3 };
      const session = { ...currentSession, conversationState: { ...currentSession.conversationState, contactConsent: 'granted' as const, intentProgress: { ...currentSession.conversationState.intentProgress!, activeIntentKey: intentKey, entries: { ...currentSession.conversationState.intentProgress!.entries, [intentKey]: advancedEntry }, journeys: { ...currentSession.conversationState.intentProgress!.journeys, [entry.journeyId]: advancedEntry } } } };
      await test.store.updateSession(session);
      const currentDocument = await test.store.getUserIntentDocument(test.tenant.id, session.id);
      if (!currentDocument) throw new Error('synthetic intent document missing');
      await test.store.updateUserIntentDocument({ document: { ...currentDocument, currentStageKey: 'package_selection', stageRevision: qualified.stages.package_selection.revision, revision: currentDocument.revision + 1, updatedAt: new Date().toISOString() }, expectedRevision: currentDocument.revision });
      await test.store.createCrmLead({ id: randomUUID(), tenantId: test.tenant.id, actionId: test.action.id, sessionId: session.id, intent: 'anc.company_formation', secondaryIntentKeys: [], intentScore: 95, intentConfidence: 0.98, catalogVersionId: test.published.catalogVersionRef, score: 95, contactCompletenessScore: 100, validationPass: true, qualificationStatus: 'qualified', qualificationEvidence: { source: 'synthetic-quote-api-test' }, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, conversation: [], summary: null, summaryStatus: 'pending', leadId: '00Q-SYNTHETIC-QUOTE', remoteCrm: 'deterministic_mock', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      const offering = await test.store.createPackageOffering({ id: randomUUID(), tenantId: test.tenant.id, catalogVersionId: null, catalogVersionRef: test.published.catalogVersionRef, packageKey: 'anc-live-quote-test', name: 'ANCFZ synthetic quote package', eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 1, officeRequirement: 'shared', inclusions: ['synthetic quote'], priceMinor: 100000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development', requiredDocuments: ['identity_document'], exclusions: ['mock only'], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['synthetic-quote-api-test'], createdAt: new Date().toISOString() });
      const selection = await proposePackageSelectionAfterLead(test.store, session, offering.id);
      const action = await test.store.createAction({ id: randomUUID(), tenantId: test.tenant.id, sessionId: session.id, workflowKey: 'package.confirm', intentKey: 'anc.company_formation', catalogVersionId: test.published.catalogVersionRef, opportunityId, actionKey: 'package.confirm', actionRevision: 1, idempotencyKey: `package-confirm:${selection.id}`, state: 'approved', opaqueReference: 'synthetic-quote-action', payload: { contactConsent: true, slotValues: { packageKey: offering.packageKey, packageOfferingId: offering.id, selectionId: selection.id, packageConfirmation: 'true', packageActionConsent: 'true' } }, createdAt: new Date().toISOString(), result: null });
      const body = { actionId: action.id, tenantId: test.tenant.id, sessionId: session.id };
      const response = await request(test.runtime.app).post('/api/internal/workflows/quote-pdf/execute').set('x-agentic-internal-secret', 'n'.repeat(64)).send(body);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({ verified: true, mock: true, quote: { status: 'approved', amountMinor: 100000, currency: 'AED' }, artifact: { sha256: artifactHash, mimeType: 'application/pdf' }, action: { state: 'completed' } });
      expect(renderPayload).toMatchObject({ customer_name: 'Synthetic Customer', customer_email: 'synthetic.provider@example.test', customer_phone: '+971501234567' });
      expect(await test.store.getUserIntentDocument(test.tenant.id, session.id)).toMatchObject({ currentStageKey: 'document_upload', pendingRequirementKey: 'document.identity.review' });
      const transitionedSession = await test.store.getSession(session.id);
      expect(transitionedSession?.conversationState?.intentProgress?.entries[intentKey]).toMatchObject({ currentRequirementKey: 'document.identity.review', lifecycle: { currentStage: 'document_upload' } });
      const quoteId = response.body.quote.id as string;
      const replay = await request(test.runtime.app).post('/api/internal/workflows/quote-pdf/execute').set('x-agentic-internal-secret', 'n'.repeat(64)).send(body);
      expect(replay.status, JSON.stringify(replay.body)).toBe(200);
      expect(replay.body.action.result.externalReference).toBe(`quote-${quoteId}`);
      const persistedSelection = await test.store.getPackageSelection(selection.id, test.tenant.id);
      if (!persistedSelection) throw new Error('synthetic quote selection was not persisted');
      expect(persistedSelection.quoteId).toBe(quoteId);
      const download = await request(test.runtime.app).get(`/api/v1/chat/sessions/${session.id}/quotes/${quoteId}/download`).set('origin', 'http://localhost');
      expect(download.status, JSON.stringify(download.body)).toBe(200);
      expect(download.headers['content-type']).toMatch(/^application\/pdf/);
      expect(Buffer.compare(download.body, pdfBytes)).toBe(0);
    } finally {
      if (previous.local === undefined) delete process.env.QUOTE_WORKFLOW_ENABLED; else process.env.QUOTE_WORKFLOW_ENABLED = previous.local;
      if (previous.url === undefined) delete process.env.QUOTE_PDF_RENDER_URL; else process.env.QUOTE_PDF_RENDER_URL = previous.url;
      if (previous.key === undefined) delete process.env.QUOTE_PDF_API_KEY; else process.env.QUOTE_PDF_API_KEY = previous.key;
      await rm(storageRoot, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => pdfServer.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('verifies a deterministic mock record and completes the correlated Lead action', async () => {
    const test = await makeFixture('deterministic_mock');
    const response = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/verify').set('x-agentic-internal-secret', 'n'.repeat(64)).send(bodyFor(test));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ accepted: true, evidenceTier: 'mock_verified', providerRecordRef: test.providerRecordId, actionId: test.action.id, opportunityId: test.action.opportunityId, actionKey: test.action.actionKey, actionRevision: test.action.actionRevision });
    expect((await test.store.getAction(test.action.id))?.state).toBe('completed');
    expect(await test.store.getCrmLeadByActionId(test.action.id, test.tenant.id)).toMatchObject({ leadId: test.providerRecordId, remoteCrm: 'deterministic_mock' });
  });

  it('moves an unconfigured Salesforce provider to reconciliation instead of claiming success', async () => {
    const test = await makeFixture('salesforce_sandbox');
    const response = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/verify').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ ...bodyFor(test), providerType: 'salesforce_sandbox' });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ accepted: false, status: 'reconciliation_required' });
    expect((await test.store.getAction(test.action.id))?.state).toBe('reconcile_required');
    expect(await test.store.getCrmLeadByActionId(test.action.id, test.tenant.id)).toBeNull();
  });

  it('accepts Salesforce only after the injected Node adapter verifies the exact provider record', async () => {
    const providerRecordId = '00Q-sandbox-verified';
    const verify = vi.fn(async ({ request: providerRequest, providerRecordId: recordRef }: { request: { tenantId: string; sessionId: string; opportunityId: string; idempotencyKey: string }; providerRecordId: string }) => ({
      tenantId: providerRequest.tenantId,
      sessionId: providerRequest.sessionId,
      opportunityId: providerRequest.opportunityId,
      providerType: 'salesforce_sandbox',
      idempotencyKey: providerRequest.idempotencyKey,
      recordRef,
      evidenceTier: 'provider_record_verified' as const,
      verificationStatus: 'verified' as const,
    }));
    const test = await makeFixture('salesforce_sandbox', { verify });
    const response = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/verify').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ ...bodyFor(test), providerType: 'salesforce_sandbox', providerRecordId });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ accepted: true, evidenceTier: 'provider_record_verified', providerRecordRef: providerRecordId, actionId: test.action.id, opportunityId: test.action.opportunityId, actionKey: test.action.actionKey, actionRevision: test.action.actionRevision });
    expect(verify).toHaveBeenCalledOnce();
    expect((await test.store.getAction(test.action.id))?.state).toBe('completed');
    expect(await test.store.getCrmLeadByActionId(test.action.id, test.tenant.id)).toMatchObject({ leadId: providerRecordId, remoteCrm: 'salesforce_sandbox' });
  });

  it('does not let the legacy Account remote callback bypass V2 provider evidence', async () => {
    const test = await makeFixture('deterministic_mock');
    const account = await test.store.createCrmAccount({
      id: randomUUID(), tenantId: test.tenant.id, opportunityId: test.action.opportunityId!,
      leadId: randomUUID(), remoteAccountId: null, remoteContactId: null, remoteOpportunityId: null,
      status: 'pending', conversionRule: 'qualification_verified', verifiedAt: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const action = await test.store.createAction({
      ...test.action, id: randomUUID(), workflowKey: 'crm.account.create', actionKey: 'account.propose_creation',
      idempotencyKey: 'v2-provider-evidence-account', payload: { contactConsent: true, slotValues: { crmAccountId: account.id } },
    });
    const response = await request(test.runtime.app)
      .put(`/api/v1/internal/crm/accounts/${account.id}/remote`)
      .set('x-agentic-internal-secret', 'n'.repeat(64))
      .send({ tenantId: test.tenant.id, actionId: action.id, remoteAccountId: 'mock-account-bypass', remoteContactId: 'mock-contact-bypass', remoteOpportunityId: 'mock-opportunity-bypass' });
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'V2_PROVIDER_EVIDENCE_REQUIRED' } });
    expect(await test.store.getCrmAccount(account.id, test.tenant.id)).toMatchObject({ status: 'pending', remoteAccountId: null });
  });

  it('verifies a deterministic Account after OTP, qualified Lead and correlated action evidence', async () => {
    const test = await makeFixture('deterministic_mock');
    const leadEvidence = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/verify').set('x-agentic-internal-secret', 'n'.repeat(64)).send(bodyFor(test));
    expect(leadEvidence.status, JSON.stringify(leadEvidence.body)).toBe(200);
    const lead = await test.store.getCrmLeadByActionId(test.action.id, test.tenant.id);
    expect(lead).toBeTruthy();
    await test.store.updateCrmLeadQualification(lead!.id, test.tenant.id, 'qualified', { source: 'synthetic-test' });
    const qualifiedLead = await test.store.getCrmLead(lead!.id, test.tenant.id);
    const account = await test.store.createCrmAccount({ id: randomUUID(), tenantId: test.tenant.id, opportunityId: test.action.opportunityId!, leadId: lead!.id, remoteAccountId: null, remoteContactId: null, remoteOpportunityId: null, status: 'pending', conversionRule: 'qualification_verified', verifiedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const accountAction = await test.store.createAction({ ...test.action, id: randomUUID(), workflowKey: 'crm.account.create', actionKey: 'account.create', idempotencyKey: 'v2-account-provider-route', state: 'processing', opaqueReference: 'v2-account-provider-action', payload: { contactConsent: true, slotValues: { crmAccountId: account.id } }, result: null });
    const accountEventId = randomUUID();
    const accountCorrelationId = randomUUID();
    await test.store.claimActionExecution({ id: randomUUID(), actionId: accountAction.id, tenantId: test.tenant.id, workflowKey: accountAction.workflowKey, catalogVersionId: accountAction.catalogVersionId ?? null, providerStatus: 'processing', n8nExecutionRef: 'n8n-account-provider-test', eventId: accountEventId, correlationId: accountCorrelationId, idempotencyKey: accountAction.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const sessionAfterLead = await test.store.getSession(test.session.id);
    const intentKey = sessionAfterLead?.conversationState?.intentProgress?.activeIntentKey ?? 'anc.company_formation';
    const entry = sessionAfterLead!.conversationState!.intentProgress!.entries[intentKey]!;
    const advancedLifecycle = completeLifecycleStage(entry.lifecycle!, 'lead_qualification', { qualificationVerified: true });
    const advancedEntry = { ...entry, lifecycle: advancedLifecycle, revision: entry.revision + 1 };
    await test.store.updateSession({ ...sessionAfterLead!, conversationState: { ...sessionAfterLead!.conversationState!, intentProgress: { ...sessionAfterLead!.conversationState!.intentProgress!, entries: { ...sessionAfterLead!.conversationState!.intentProgress!.entries, [intentKey]: advancedEntry }, journeys: { ...sessionAfterLead!.conversationState!.intentProgress!.journeys, [entry.journeyId!]: advancedEntry } } } });
    const currentDocument = await test.store.getUserIntentDocument(test.tenant.id, test.session.id);
    await test.store.updateUserIntentDocument({ document: { ...currentDocument!, currentStageKey: 'account_creation', stageRevision: advancedLifecycle.stages.account_creation.revision, revision: currentDocument!.revision + 1, updatedAt: new Date().toISOString() }, expectedRevision: currentDocument!.revision });
    expect(await test.store.getUserIntentDocument(test.tenant.id, test.session.id)).toMatchObject({ currentStageKey: 'account_creation', opportunityId: accountAction.opportunityId });
    const issued = await request(test.runtime.app).post('/api/v2/internal/account-otp/issue').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ actionId: accountAction.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: accountAction.opportunityId, leadId: lead!.id, code: '123456' });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(accountAction).toMatchObject({ workflowKey: 'crm.account.create', actionKey: 'account.create', actionRevision: 1, catalogVersionId: test.published.catalogVersionRef, opportunityId: account.opportunityId, state: 'processing' });
    expect(account).toMatchObject({ status: 'pending', opportunityId: accountAction.opportunityId, leadId: lead!.id });
    expect(qualifiedLead).toMatchObject({ qualificationStatus: 'qualified', leadId: test.providerRecordId, remoteCrm: 'deterministic_mock' });
    const challengeId = issued.body.challenge.challengeId as string;
    const providerRecordId = `mock-account-${createHmac('sha256', 'v2-account-mock').update(accountAction.idempotencyKey).digest('hex').slice(0, 20)}`;
    const evidence = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/account').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ actionId: accountAction.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: accountAction.opportunityId, stageKey: 'account_creation', workflowKey: accountAction.workflowKey, providerType: 'deterministic_mock', providerRecordId, eventId: accountEventId, correlationId: accountCorrelationId, attempt: 1, idempotencyKey: accountAction.idempotencyKey, catalogVersionId: test.published.catalogVersionRef, actionKey: accountAction.actionKey, actionRevision: accountAction.actionRevision, otpChallengeId: challengeId, otpCode: '123456', explicitConfirmation: true });
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(200);
    expect(evidence.body).toMatchObject({ accepted: true, evidenceTier: 'mock_verified', providerRecordRef: providerRecordId, account: { status: 'verified', remoteAccountId: providerRecordId } });
    expect((await test.store.getAction(accountAction.id))?.state).toBe('completed');
    expect((await test.store.getCrmAccount(account.id, test.tenant.id))?.status).toBe('verified');
    expect((await test.store.getUserIntentDocument(test.tenant.id, test.session.id))?.currentStageKey).toBe('package_selection');
    expect((await test.store.getSession(test.session.id))?.conversationState).toMatchObject({ workflowStatus: 'succeeded', phase: 'SUCCEEDED' });
    const replay = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/account').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ actionId: accountAction.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: accountAction.opportunityId, stageKey: 'account_creation', workflowKey: accountAction.workflowKey, providerType: 'deterministic_mock', providerRecordId, eventId: accountEventId, correlationId: accountCorrelationId, attempt: 1, idempotencyKey: accountAction.idempotencyKey, catalogVersionId: test.published.catalogVersionRef, actionKey: accountAction.actionKey, actionRevision: accountAction.actionRevision, otpChallengeId: challengeId, otpCode: '123456', explicitConfirmation: true });
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
    const offering = await test.store.createPackageOffering({ id: randomUUID(), tenantId: test.tenant.id, catalogVersionId: null, catalogVersionRef: test.published.catalogVersionRef, packageKey: 'anc-development-standard', name: 'ANCFZ Development Standard', eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 1, officeRequirement: 'shared', inclusions: ['synthetic development offering'], priceMinor: 250000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development fixture', requiredDocuments: [], exclusions: ['not an official ANCFZ price'], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['pricebook:ancfz-development-v1'], createdAt: new Date().toISOString() });
    const proposal = await request(test.runtime.app).post(`/api/v1/chat/sessions/${test.session.id}/packages/proposals`).set('origin', 'http://localhost').send({ opportunityId: accountAction.opportunityId, packageOfferingId: offering.id });
    expect(proposal.status, JSON.stringify(proposal.body)).toBe(201);
    const quote = { body: { quote: await createApprovedQuote(test.store, (await test.store.getSession(test.session.id))!, accountAction.opportunityId!, offering.id) } };
    const confirmed = await request(test.runtime.app).post(`/api/v1/chat/sessions/${test.session.id}/packages/selections/${proposal.body.selection.id}/confirm`).set('origin', 'http://localhost').send({ quoteId: quote.body.quote.id });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect((await test.store.getUserIntentDocument(test.tenant.id, test.session.id))?.currentStageKey).toBe('document_upload');
  });

  it('accepts a V2 document upload against the pinned catalog reference', async () => {
    const mutation = {
      createLeadAttachment: vi.fn(async ({ providerRecordId, fileName, contentBase64 }: { providerRecordId: string; fileName: string; contentBase64: string }) => ({ attachmentRef: '00P-sandbox-document', parentRef: providerRecordId, fileName, sizeBytes: Buffer.from(contentBase64, 'base64').length })),
      updateLeadDescription: vi.fn(async ({ providerRecordId, description }: { providerRecordId: string; description: string }) => ({ recordRef: providerRecordId, description })),
    };
    const test = await makeFixture('deterministic_mock', undefined, undefined, mutation);
    const leadEvidence = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/verify').set('x-agentic-internal-secret', 'n'.repeat(64)).send(bodyFor(test));
    expect(leadEvidence.status, JSON.stringify(leadEvidence.body)).toBe(200);
    const lead = await test.store.getCrmLeadByActionId(test.action.id, test.tenant.id);
    expect(lead).toBeTruthy();
    await test.store.updateCrmLeadRemote({ id: lead!.id, tenantId: test.tenant.id, leadId: '00Q-sandbox-document', remoteCrm: 'salesforce_sandbox' });
    const account = await test.store.createCrmAccount({ id: randomUUID(), tenantId: test.tenant.id, opportunityId: test.action.opportunityId!, leadId: lead!.id, remoteAccountId: 'mock-account', remoteContactId: 'mock-contact', remoteOpportunityId: 'mock-opportunity', status: 'verified', conversionRule: 'qualification_verified', verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const sessionAfterLead = await test.store.getSession(test.session.id);
    const intentKey = sessionAfterLead?.conversationState?.intentProgress?.activeIntentKey ?? 'anc.company_formation';
    const entry = sessionAfterLead!.conversationState!.intentProgress!.entries[intentKey]!;
    const qualifiedLifecycle = completeLifecycleStage(entry.lifecycle!, 'lead_qualification', { qualificationVerified: true });
    const accountLifecycle = completeLifecycleStage(qualifiedLifecycle, 'account_creation', { accountProviderVerified: true });
    const advancedEntry = { ...entry, lifecycle: accountLifecycle, revision: entry.revision + 2 };
    await test.store.updateSession({ ...sessionAfterLead!, conversationState: { ...sessionAfterLead!.conversationState!, intentProgress: { ...sessionAfterLead!.conversationState!.intentProgress!, entries: { ...sessionAfterLead!.conversationState!.intentProgress!.entries, [intentKey]: advancedEntry }, journeys: { ...sessionAfterLead!.conversationState!.intentProgress!.journeys, [entry.journeyId!]: advancedEntry } } } });
    const currentDocument = await test.store.getUserIntentDocument(test.tenant.id, test.session.id);
    await test.store.updateUserIntentDocument({ document: { ...currentDocument!, currentStageKey: 'package_selection', stageRevision: accountLifecycle.stages.package_selection.revision, revision: currentDocument!.revision + 1, updatedAt: new Date().toISOString() }, expectedRevision: currentDocument!.revision });
    const offering = await test.store.createPackageOffering({ id: randomUUID(), tenantId: test.tenant.id, catalogVersionId: null, catalogVersionRef: test.published.catalogVersionRef, packageKey: 'anc-document-test', name: 'ANCFZ Document Test', eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 1, officeRequirement: 'shared', inclusions: ['synthetic development offering'], priceMinor: 250000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development fixture', requiredDocuments: ['identity_document'], exclusions: ['not an official ANCFZ price'], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['pricebook:ancfz-development-v1'], createdAt: new Date().toISOString() });
    const proposal = await request(test.runtime.app).post(`/api/v1/chat/sessions/${test.session.id}/packages/proposals`).set('origin', 'http://localhost').send({ opportunityId: account.opportunityId, packageOfferingId: offering.id });
    expect(proposal.status, JSON.stringify(proposal.body)).toBe(201);
    const quote = { body: { quote: await createApprovedQuote(test.store, (await test.store.getSession(test.session.id))!, account.opportunityId, offering.id) } };
    const confirmed = await request(test.runtime.app).post(`/api/v1/chat/sessions/${test.session.id}/packages/selections/${proposal.body.selection.id}/confirm`).set('origin', 'http://localhost').send({ quoteId: quote.body.quote.id });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const config = await request(test.runtime.app).get(`/api/v1/chat/sessions/${test.session.id}/documents/config`).set('origin', 'http://localhost');
    expect(config.status, JSON.stringify(config.body)).toBe(200);
    expect(config.body).toMatchObject({ enabled: true, workflowKey: 'anc.document.ocr.extract', requirements: expect.arrayContaining([expect.objectContaining({ documentType: 'identity_document' })]) });
    const pdf = Buffer.from('%PDF-1.4\nsynthetic identity fixture\n%%EOF').toString('base64');
    const upload = await request(test.runtime.app).post(`/api/v1/chat/sessions/${test.session.id}/documents`).set('origin', 'http://localhost').send({ fileName: 'identity.pdf', mimeType: 'application/pdf', contentBase64: pdf, processingConsent: true, primaryIntentKey: 'anc.company_formation' });
    expect(upload.status, JSON.stringify(upload.body)).toBe(202);
    expect(upload.body).toMatchObject({ accepted: true, jobId: expect.any(String), document: { status: 'queued', expectedDocumentType: 'identity_document' } });
    const worker = { 'x-ingestion-worker-secret': 'i'.repeat(64) };
    const claimed = await request(test.runtime.app).post('/api/v1/internal/document-jobs/claim-next').set(worker);
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200);
    expect(claimed.body.job.id).toBe(upload.body.jobId);
    const result = await request(test.runtime.app).post(`/api/v1/internal/document-jobs/${upload.body.jobId}/result`).set(worker).send({ tenantId: test.tenant.id, jobId: upload.body.jobId, extractedText: 'synthetic review', summary: 'synthetic identity reviewed', executionReference: 'document-worker-test' });
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(result.body.document).toMatchObject({ status: 'completed', id: upload.body.document.id });
    expect(result.body.salesforceLeadSyncVerified).toBe(true);
    expect(mutation.createLeadAttachment).toHaveBeenCalledWith(expect.objectContaining({ providerRecordId: '00Q-sandbox-document', fileName: 'identity.pdf' }));
    expect(mutation.updateLeadDescription).toHaveBeenCalledWith(expect.objectContaining({ providerRecordId: '00Q-sandbox-document', description: expect.stringContaining('document type: identity_document; status: completed') }));
    expect(mutation.updateLeadDescription).not.toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('synthetic identity reviewed') }));
    expect(mutation.updateLeadDescription).not.toHaveBeenCalledWith(expect.objectContaining({ description: expect.stringContaining('identity.pdf') }));
    expect((await test.store.listAudit(test.tenant.id)).some((event) => event.eventName === 'document.sf02_attachment_verified' && event.metadata.documentId === upload.body.document.id)).toBe(true);
    expect((await test.store.getUserIntentDocument(test.tenant.id, test.session.id))?.currentStageKey).toBe('payment_invoice');
    const invoiceResponse = await request(test.runtime.app).post(`/api/v1/chat/sessions/${test.session.id}/invoices`).set('origin', 'http://localhost').send({ opportunityId: account.opportunityId, quoteId: quote.body.quote.id });
    expect(invoiceResponse.status, JSON.stringify(invoiceResponse.body)).toBe(202);
    const invoiceAction = await test.store.getAction(invoiceResponse.body.actionProposal.id);
    expect(invoiceAction).toMatchObject({ workflowKey: 'invoice.issue', actionKey: 'invoice.issue' });
    const invoiceEventId = randomUUID();
    const invoiceCorrelationId = randomUUID();
    await test.store.transitionAction(invoiceAction!.id, test.tenant.id, 'awaiting_confirmation', 'processing', null);
    await test.store.claimActionExecution({ id: randomUUID(), actionId: invoiceAction!.id, tenantId: test.tenant.id, workflowKey: invoiceAction!.workflowKey, catalogVersionId: invoiceAction!.catalogVersionId ?? null, providerStatus: 'processing', n8nExecutionRef: 'n8n-invoice-test', eventId: invoiceEventId, correlationId: invoiceCorrelationId, idempotencyKey: invoiceAction!.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const invoiceRecordId = `mock-invoice-${createHash('sha256').update(invoiceAction!.idempotencyKey).digest('hex').slice(0, 24)}`;
    const invoiceEvidence = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/invoice').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ actionId: invoiceAction!.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: invoiceAction!.opportunityId, stageKey: 'payment_invoice', workflowKey: invoiceAction!.workflowKey, providerType: 'deterministic_mock', providerRecordId: invoiceRecordId, eventId: invoiceEventId, correlationId: invoiceCorrelationId, attempt: 1, idempotencyKey: invoiceAction!.idempotencyKey, catalogVersionId: test.published.catalogVersionRef, actionKey: invoiceAction!.actionKey, actionRevision: invoiceAction!.actionRevision });
    expect(invoiceEvidence.status, JSON.stringify(invoiceEvidence.body)).toBe(200);
    expect(invoiceEvidence.body.invoice).toMatchObject({ externalInvoiceId: invoiceRecordId, status: 'pending' });
    expect((await test.store.getUserIntentDocument(test.tenant.id, test.session.id))?.currentStageKey).toBe('payment_invoice');
    const invoice = invoiceEvidence.body.invoice;
    const paymentProposal = await request(test.runtime.app).post(`/api/v1/chat/sessions/${test.session.id}/payments`).set('origin', 'http://localhost').send({ opportunityId: account.opportunityId, invoiceId: invoice.id, paymentConfirmation: true });
    expect(paymentProposal.status, JSON.stringify(paymentProposal.body)).toBe(202);
    const paymentAction = await test.store.getAction(paymentProposal.body.actionProposal.id);
    expect(paymentAction).toMatchObject({ workflowKey: 'payment.authorize', actionKey: 'payment.authorize' });
    const paymentEventId = randomUUID();
    const paymentCorrelationId = randomUUID();
    await test.store.transitionAction(paymentAction!.id, test.tenant.id, 'awaiting_confirmation', 'processing', null);
    await test.store.claimActionExecution({ id: randomUUID(), actionId: paymentAction!.id, tenantId: test.tenant.id, workflowKey: paymentAction!.workflowKey, catalogVersionId: paymentAction!.catalogVersionId ?? null, providerStatus: 'processing', n8nExecutionRef: 'n8n-payment-test', eventId: paymentEventId, correlationId: paymentCorrelationId, idempotencyKey: paymentAction!.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const paymentRecordId = `mockpay_${createHash('sha256').update(paymentAction!.idempotencyKey).digest('hex').slice(0, 32)}`;
    const paymentEvidence = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/payment').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ actionId: paymentAction!.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: paymentAction!.opportunityId, stageKey: 'payment_invoice', workflowKey: paymentAction!.workflowKey, providerType: 'deterministic_mock', providerRecordId: paymentRecordId, eventId: paymentEventId, correlationId: paymentCorrelationId, attempt: 1, idempotencyKey: paymentAction!.idempotencyKey, catalogVersionId: test.published.catalogVersionRef, actionKey: paymentAction!.actionKey, actionRevision: paymentAction!.actionRevision, settle: true, paymentConfirmation: true });
    expect(paymentEvidence.status, JSON.stringify(paymentEvidence.body)).toBe(200);
    // Mock results are useful for diagnostics, but must not be treated as
    // financially settled or unlock the real contract stage.
    expect(paymentEvidence.body).toMatchObject({
      accepted: true, paymentVerified: false, simulationPaid: true,
      invoice: { status: 'pending', provider: 'deterministic_mock' },
      action: { state: 'processing' },
    });
    expect((await test.store.getUserIntentDocument(test.tenant.id, test.session.id))?.currentStageKey).toBe('payment_invoice');
    const contractProposal = await request(test.runtime.app).post(`/api/v1/chat/sessions/${test.session.id}/contracts`)
      .set('origin', 'http://localhost')
      .send({ opportunityId: account.opportunityId, packageSelectionId: proposal.body.selection.id, invoiceId: invoice.id });
    expect(contractProposal.status, JSON.stringify(contractProposal.body)).toBe(409);
  });

  it('moves a Salesforce Account result to reconciliation without claiming completion', async () => {
    const test = await makeFixture('salesforce_sandbox');
    const lead = await test.store.createCrmLead({ id: randomUUID(), tenantId: test.tenant.id, actionId: test.action.id, sessionId: test.session.id, intent: 'anc.company_formation', secondaryIntentKeys: [], intentScore: 95, intentConfidence: 0.98, catalogVersionId: test.published.catalogVersionRef, score: 95, contactCompletenessScore: 100, validationPass: true, qualificationStatus: 'qualified', qualificationEvidence: { source: 'synthetic-test' }, leadData: {}, conversation: [], summary: null, summaryStatus: 'pending', leadId: '00Q-SANDBOX-ACCOUNT-LEAD', remoteCrm: 'salesforce_sandbox', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const account = await test.store.createCrmAccount({ id: randomUUID(), tenantId: test.tenant.id, opportunityId: test.action.opportunityId!, leadId: lead.id, remoteAccountId: null, remoteContactId: null, remoteOpportunityId: null, status: 'pending', conversionRule: 'qualification_verified', verifiedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const action = await test.store.createAction({ ...test.action, id: randomUUID(), workflowKey: 'crm.account.create', actionKey: 'account.create', idempotencyKey: 'v2-account-salesforce-route', state: 'processing', opaqueReference: 'v2-account-salesforce-action', payload: { contactConsent: true, slotValues: { crmAccountId: account.id } }, result: null });
    const document = await test.store.getUserIntentDocument(test.tenant.id, test.session.id);
    await test.store.updateUserIntentDocument({ document: { ...document!, currentStageKey: 'account_creation', revision: document!.revision + 1, updatedAt: new Date().toISOString() }, expectedRevision: document!.revision });
    const eventId = randomUUID();
    const correlationId = randomUUID();
    await test.store.claimActionExecution({ id: randomUUID(), actionId: action.id, tenantId: test.tenant.id, workflowKey: action.workflowKey, catalogVersionId: action.catalogVersionId ?? null, providerStatus: 'processing', n8nExecutionRef: 'n8n-salesforce-account-test', eventId, correlationId, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const response = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/account').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ actionId: action.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: action.opportunityId, stageKey: 'account_creation', workflowKey: action.workflowKey, providerType: 'salesforce_sandbox', providerRecordId: '001-sandbox-account', eventId, correlationId, attempt: 1, idempotencyKey: action.idempotencyKey, catalogVersionId: test.published.catalogVersionRef, actionKey: action.actionKey, actionRevision: action.actionRevision, otpChallengeId: randomUUID(), otpCode: '123456', explicitConfirmation: true });
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(response.body).toMatchObject({ accepted: false, status: 'reconciliation_required' });
    expect((await test.store.getAction(action.id))?.state).toBe('reconcile_required');
    expect(await test.store.getCrmAccount(account.id, test.tenant.id)).toMatchObject({ status: 'reconcile_required', remoteAccountId: null });
  });

  it('completes a Salesforce Account only after OTP and injected relationship readback evidence', async () => {
    const leadRecordId = '00Q-sandbox-account-lead';
    const accountRecordId = '001-sandbox-verified';
    const verifyLead = async ({ request: providerRequest, providerRecordId }: { request: { tenantId: string; sessionId: string; opportunityId: string; idempotencyKey: string }; providerRecordId: string }) => ({
      tenantId: providerRequest.tenantId, sessionId: providerRequest.sessionId, opportunityId: providerRequest.opportunityId,
      providerType: 'salesforce_sandbox', idempotencyKey: providerRequest.idempotencyKey, recordRef: providerRecordId,
      evidenceTier: 'provider_record_verified' as const, verificationStatus: 'verified' as const,
    });
    const verifyAccount = async ({ request: providerRequest, providerRecordId }: { request: { tenantId: string; sessionId: string; opportunityId: string; idempotencyKey: string; leadExternalId: string }; providerRecordId: string }) => ({
      tenantId: providerRequest.tenantId, sessionId: providerRequest.sessionId, opportunityId: providerRequest.opportunityId,
      providerType: 'salesforce_sandbox', idempotencyKey: providerRequest.idempotencyKey, recordRef: providerRecordId,
      evidenceTier: 'provider_record_verified' as const, verificationStatus: 'verified' as const,
      remoteAccountId: providerRecordId, remoteContactId: '003-sandbox-contact', remoteOpportunityId: '006-sandbox-opportunity',
      leadExternalId: providerRequest.leadExternalId, deduplicated: false,
    });
    const test = await makeFixture('salesforce_sandbox', { verify: verifyLead }, { verifyAccount });
    const leadEvidence = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/verify').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ ...bodyFor(test), providerType: 'salesforce_sandbox', providerRecordId: leadRecordId });
    expect(leadEvidence.status, JSON.stringify(leadEvidence.body)).toBe(200);
    const lead = await test.store.getCrmLeadByActionId(test.action.id, test.tenant.id);
    expect(lead).toBeTruthy();
    await test.store.updateCrmLeadQualification(lead!.id, test.tenant.id, 'qualified', { source: 'synthetic-test' });
    const account = await test.store.createCrmAccount({ id: randomUUID(), tenantId: test.tenant.id, opportunityId: test.action.opportunityId!, leadId: lead!.id, remoteAccountId: null, remoteContactId: null, remoteOpportunityId: null, status: 'pending', conversionRule: 'qualification_verified', verifiedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const accountAction = await test.store.createAction({ ...test.action, id: randomUUID(), workflowKey: 'crm.account.create', actionKey: 'account.create', idempotencyKey: 'v2-account-salesforce-verified', opaqueReference: 'v2-account-salesforce-verified-ref', state: 'processing', payload: { contactConsent: true, slotValues: { crmAccountId: account.id } }, result: null });
    const sessionAfterLead = await test.store.getSession(test.session.id);
    const intentKey = sessionAfterLead?.conversationState?.intentProgress?.activeIntentKey ?? 'anc.company_formation';
    const entry = sessionAfterLead!.conversationState!.intentProgress!.entries[intentKey]!;
    const advancedLifecycle = completeLifecycleStage(entry.lifecycle!, 'lead_qualification', { qualificationVerified: true });
    const advancedEntry = { ...entry, lifecycle: advancedLifecycle, revision: entry.revision + 1 };
    await test.store.updateSession({ ...sessionAfterLead!, conversationState: { ...sessionAfterLead!.conversationState!, intentProgress: { ...sessionAfterLead!.conversationState!.intentProgress!, entries: { ...sessionAfterLead!.conversationState!.intentProgress!.entries, [intentKey]: advancedEntry }, journeys: { ...sessionAfterLead!.conversationState!.intentProgress!.journeys, [entry.journeyId!]: advancedEntry } } } });
    const currentDocument = await test.store.getUserIntentDocument(test.tenant.id, test.session.id);
    await test.store.updateUserIntentDocument({ document: { ...currentDocument!, currentStageKey: 'account_creation', stageRevision: advancedLifecycle.stages.account_creation.revision, revision: currentDocument!.revision + 1, updatedAt: new Date().toISOString() }, expectedRevision: currentDocument!.revision });
    const challenge = await test.otp.issue({ tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: accountAction.opportunityId!, leadId: lead!.id, code: '123456' });
    const eventId = randomUUID();
    const correlationId = randomUUID();
    await test.store.claimActionExecution({ id: randomUUID(), actionId: accountAction.id, tenantId: test.tenant.id, workflowKey: accountAction.workflowKey, catalogVersionId: accountAction.catalogVersionId ?? null, providerStatus: 'processing', n8nExecutionRef: 'n8n-salesforce-account-verified', eventId, correlationId, idempotencyKey: accountAction.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const response = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/account').set('x-agentic-internal-secret', 'n'.repeat(64)).send({ actionId: accountAction.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: accountAction.opportunityId, stageKey: 'account_creation', workflowKey: accountAction.workflowKey, providerType: 'salesforce_sandbox', providerRecordId: accountRecordId, eventId, correlationId, attempt: 1, idempotencyKey: accountAction.idempotencyKey, catalogVersionId: test.published.catalogVersionRef, actionKey: accountAction.actionKey, actionRevision: accountAction.actionRevision, otpChallengeId: challenge.challengeId, otpCode: '123456', explicitConfirmation: true });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ accepted: true, evidenceTier: 'provider_record_verified', providerRecordRef: accountRecordId, account: { status: 'verified', remoteAccountId: accountRecordId, remoteContactId: '003-sandbox-contact', remoteOpportunityId: '006-sandbox-opportunity' } });
    expect((await test.store.getAction(accountAction.id))?.state).toBe('completed');
    expect((await test.store.getUserIntentDocument(test.tenant.id, test.session.id))?.currentStageKey).toBe('package_selection');
  });

  it('records a correlated n8n failure without provider evidence or completion', async () => {
    const test = await makeFixture('salesforce_sandbox');
    const failure = {
      actionId: test.action.id, tenantId: test.tenant.id, sessionId: test.session.id,
      opportunityId: test.action.opportunityId, catalogVersionId: test.published.catalogVersionRef,
      idempotencyKey: test.action.idempotencyKey, actionKey: test.action.actionKey,
      actionRevision: test.action.actionRevision, eventId: test.eventId, correlationId: test.correlationId,
      attempt: 1, executionReference: 'n8n-provider-evidence-test', state: 'reconcile_required', reasonCode: 'salesforce_create_failed',
    };
    const response = await request(test.runtime.app).post('/api/v1/internal/workflow-events/fail')
      .set('x-agentic-internal-secret', 'n'.repeat(64)).send(failure);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.action).toMatchObject({ id: test.action.id, state: 'reconcile_required' });
    expect((await test.store.getActionExecution(test.action.id, test.tenant.id))?.outcome).toMatchObject({ reasonCode: 'salesforce_create_failed' });
    const replay = await request(test.runtime.app).post('/api/v1/internal/workflow-events/fail')
      .set('x-agentic-internal-secret', 'n'.repeat(64)).send(failure);
    expect(replay.status, JSON.stringify(replay.body)).toBe(200);
  });

  it('rejects stale and cross-tenant n8n failure callbacks', async () => {
    const test = await makeFixture('salesforce_sandbox');
    const base = {
      actionId: test.action.id, tenantId: test.tenant.id, sessionId: test.session.id,
      opportunityId: test.action.opportunityId, catalogVersionId: test.published.catalogVersionRef,
      idempotencyKey: test.action.idempotencyKey, actionKey: test.action.actionKey,
      actionRevision: test.action.actionRevision, eventId: test.eventId, correlationId: test.correlationId,
      executionReference: 'n8n-provider-evidence-test', state: 'failed', reasonCode: 'salesforce_readback_failed',
    };
    const stale = await request(test.runtime.app).post('/api/v1/internal/workflow-events/fail')
      .set('x-agentic-internal-secret', 'n'.repeat(64)).send({ ...base, attempt: 2 });
    expect(stale.status).toBe(409);
    const tenantMismatch = await request(test.runtime.app).post('/api/v1/internal/workflow-events/fail')
      .set('x-agentic-internal-secret', 'n'.repeat(64)).send({ ...base, tenantId: randomUUID(), attempt: 1 });
    expect(tenantMismatch.status).toBe(403);
    expect((await test.store.getAction(test.action.id))?.state).toBe('processing');
  });
});

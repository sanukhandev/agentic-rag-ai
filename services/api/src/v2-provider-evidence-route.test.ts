import request from 'supertest';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2, type CatalogV2Document } from './catalog-v2.js';
import { newConversationState } from './conversation-state.js';
import { initializeConfirmedV2Journey } from './v2-journey-bootstrap.js';
import { MemoryStore } from './store-memory.js';
import { TokenVault } from './privacy.js';

const catalog = (providerType: string): CatalogV2Document => {
  const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2-seven-stage.json', import.meta.url), 'utf8')));
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
  return document;
};

async function makeFixture(providerType: string) {
  const store = new MemoryStore();
  const tokenVault = new TokenVault('provider-evidence-route-test-secret');
  const runtime = createApp({ store, nodeEnv: 'test', tokenVault, n8nCallbackSecret: 'n'.repeat(64) });
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
  const scopedSession = { ...session, conversationState: bootstrap.state };
  tokenVault.save(scopedSession, [{ token: '[NAME_1]', value: 'Synthetic Customer' }, { token: '[EMAIL_1]', value: 'synthetic.provider@example.test' }, { token: '[PHONE_1]', value: '+971501234567' }]);
  await store.updateSession(scopedSession);
  await store.createUserIntentDocument(bootstrap.document);
  const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'anc.company_formation', intentScore: 95, intentConfidence: 0.98, catalogVersionId: published.catalogVersionRef, opportunityId: bootstrap.document.opportunityId, actionKey: 'lead.create', actionRevision: 1, idempotencyKey: 'v2-provider-evidence-route', state: 'processing', opaqueReference: 'v2-provider-evidence-action', payload: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]', contactConsent: true, slotValues: { lead_contact_name: '[NAME_1]', lead_contact_channel: '[EMAIL_1]', lead_crm_consent: 'true', lead_action_confirmation: 'true', business_activity: 'technology consulting' } }, createdAt: timestamp, result: null });
  await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: tenant.id, role: 'user', maskedContent: 'I want to start a technology consulting company next month.', citations: [], clientMessageId: 'provider-evidence-user', response: null, createdAt: timestamp });
  const eventId = randomUUID();
  const correlationId = randomUUID();
  await store.claimActionExecution({ id: randomUUID(), actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, catalogVersionId: action.catalogVersionId ?? null, providerStatus: 'processing', n8nExecutionRef: 'n8n-provider-evidence-test', eventId, correlationId, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: timestamp, updatedAt: timestamp });
  return { runtime, store, tenant, session, published, action, eventId, correlationId, providerRecordId: `mock-lead-${createHash('sha256').update(action.idempotencyKey).digest('hex').slice(0, 24)}` };
}

type ProviderFixture = Awaited<ReturnType<typeof makeFixture>>;

const bodyFor = (test: ProviderFixture) => ({
  actionId: test.action.id, tenantId: test.tenant.id, sessionId: test.session.id, opportunityId: test.action.opportunityId,
  stageKey: 'lead_generation', workflowKey: 'crm.lead.create', providerType: 'deterministic_mock', providerRecordId: test.providerRecordId,
  eventId: test.eventId, correlationId: test.correlationId, attempt: 1, idempotencyKey: test.action.idempotencyKey,
  catalogVersionId: test.published.catalogVersionRef, actionKey: test.action.actionKey, actionRevision: test.action.actionRevision,
});

describe('V2 provider evidence route', () => {
  it('verifies a deterministic mock record and completes the correlated Lead action', async () => {
    const test = await makeFixture('deterministic_mock');
    const response = await request(test.runtime.app).post('/api/v2/internal/provider-evidence/verify').set('x-agentic-internal-secret', 'n'.repeat(64)).send(bodyFor(test));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body).toMatchObject({ accepted: true, evidenceTier: 'mock_verified', providerRecordRef: test.providerRecordId });
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
});

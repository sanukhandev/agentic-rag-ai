import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateCatalogV2, type CatalogV2Document } from './catalog.js';
import { resolveV2WorkflowRoute } from './workflow-bridge.js';
import { MemoryStore } from '../store-memory.js';
import { randomUUID } from 'node:crypto';

const catalog = (): CatalogV2Document => {
  const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2-seven-stage.json', import.meta.url), 'utf8')));
  if (!parsed.ok || !parsed.document) throw new Error('fixture invalid');
  return parsed.document;
};

describe('V2 workflow bridge', () => {
  it('requires a published catalog binding with complete n8n transport identity', () => {
    const document = catalog();
    const binding = document.sheets.WorkflowBindings.find(row => row.workflowKey === 'crm.lead.create');
    if (!binding) throw new Error('lead binding missing');
    binding.enabled = true;
    binding.n8nWorkflowId = 'ancfzV2LeadCreateR1';
    binding.webhookPath = 'ancfz/v2/lead-create';
    binding.payloadContract = 'ancfz-v2-stage-action-v1';
    const version = { id: 'v2', tenantId: 'tenant', version: 1, status: 'published' as const, sourceFileName: 'fixture', sourceHash: 'hash', parserVersion: 'test', catalog: document, catalogVersionRef: 'anc:v2:test', createdAt: new Date().toISOString(), publishedAt: new Date().toISOString() };
    expect(resolveV2WorkflowRoute(version, 'crm.lead.create')).toEqual({ workflowKey: 'crm.lead.create', webhookPath: 'ancfz/v2/lead-create', n8nWorkflowId: 'ancfzV2LeadCreateR1', payloadContract: 'ancfz-v2-stage-action-v1' });
  });

  it('fails closed for disabled or unbound transport identity', () => {
    const document = catalog();
    const version = { id: 'v2', tenantId: 'tenant', version: 1, status: 'published' as const, sourceFileName: 'fixture', sourceHash: 'hash', parserVersion: 'test', catalog: document, catalogVersionRef: 'anc:v2:test', createdAt: new Date().toISOString(), publishedAt: new Date().toISOString() };
    expect(resolveV2WorkflowRoute(version, 'crm.lead.create')).toBeNull();
  });

  it('claims a published V2 action by canonical catalog reference', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'V2 bridge', slug: `v2-bridge-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    const document = catalog();
    const binding = document.sheets.WorkflowBindings.find(row => row.workflowKey === 'crm.lead.create');
    if (!binding) throw new Error('lead binding missing');
    binding.enabled = true;
    binding.n8nWorkflowId = 'ancfzV2LeadCreateR1';
    binding.webhookPath = 'ancfz/v2/lead-create';
    binding.payloadContract = 'ancfz-v2-stage-action-v1';
    const version = await store.createIntentCatalogV2Version({ tenantId: tenant.id, status: 'draft', sourceFileName: 'fixture', sourceHash: 'bridge-test', parserVersion: 'test', catalog: document, catalogVersionRef: 'anc:v2:' + 'b'.repeat(64) });
    await store.publishIntentCatalogV2Version(tenant.id, version.id);
    const opportunityId = randomUUID();
    const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'anc.company_formation', catalogVersionId: version.catalogVersionRef, opportunityId, actionKey: 'lead.create', actionRevision: 1, idempotencyKey: 'v2-bridge-idempotency', state: 'approved', opaqueReference: 'v2-bridge-action', payload: { contactConsent: true, slotValues: { lead_contact_name: '[NAME_1]' } }, createdAt: new Date().toISOString(), result: null });
    const eventId = randomUUID();
    const correlationId = randomUUID();
    await store.claimActionExecution({ id: randomUUID(), actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, catalogVersionId: action.catalogVersionId ?? null, providerStatus: 'dispatching', n8nExecutionRef: null, eventId, correlationId, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const claims = await store.claimWorkflowActionsWithExecutions({ actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, n8nWorkflowId: binding.n8nWorkflowId, executionReference: 'n8n-v2-claim', eventId, correlationId, attempt: 1, limit: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString() });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.action.state).toBe('processing');
    expect(claims[0]?.execution.n8nExecutionRef).toBe('n8n-v2-claim');
  });
});

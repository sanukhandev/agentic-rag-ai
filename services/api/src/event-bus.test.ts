import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { N8nEventBridge } from './event-bus.js';
import { validateBusinessCatalog } from './conversation-core/catalog/catalog.js';
import { MemoryStore } from './store-memory.js';

describe('N8n document event routing', () => {
  it.each(['queued', 'processing'] as const)('routes a catalog OCR job through the pinned published workflow binding while %s', async (status) => {
    const tenantId = '00000000-0000-4000-8000-000000000001';
    const documentId = '00000000-0000-4000-8000-000000000002';
    const catalogVersionRef = 'anc:r7:' + 'a'.repeat(64);
    const store = {
      getDocumentProcessingJob: async () => ({ documentId, tenantId, status, workflowKey: 'anc.document.ocr.extract' }),
      getSupportingDocument: async () => ({ id: documentId, tenantId, catalogVersionId: catalogVersionRef }),
      listBusinessCatalogVersions: async () => [{
        status: 'published',
        catalogVersionRef,
        catalog: { sheets: { WorkflowBindings: [{ workflowKey: 'anc.document.ocr.extract', registryKey: 'document.sf02.upload', providerType: 'node', payloadSchemaRef: 'payload.anc.document.ocr.v1', callbackSchemaRef: 'callback.anc.document.ocr.v1', evidencePolicyKey: 'document.ocr.queued', n8nWorkflowId: 'DOC01DocumentProcessing', webhookPath: 'anc-test-document-ocr-wf-1', payloadContract: 'anc-document-ocr-v1', enabled: true }] } },
      }],
    } as unknown as ConstructorParameters<typeof N8nEventBridge>[0];
    const bridge = new N8nEventBridge(store, 'http://n8n:5678', 'secret');
    const route = await (bridge as unknown as { documentRoute(input: { payloadRef: string; tenantId: string }): Promise<unknown> }).documentRoute({ payloadRef: '00000000-0000-4000-8000-000000000003', tenantId });
    expect(route).toEqual({ workflowKey: 'anc.document.ocr.extract', providerType: 'node', webhookPath: 'anc-test-document-ocr-wf-1', n8nWorkflowId: 'DOC01DocumentProcessing', payloadContract: 'anc-document-ocr-v1' });
  });

  it('delegates an enabled remote published action to the API PII boundary and records its normalized result', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Synthetic Remote Tenant', slug: `remote-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    const parsed = validateBusinessCatalog(JSON.parse(readFileSync(new URL('./fixtures/catalog-reference-seven-stage.json', import.meta.url), 'utf8')));
    if (!parsed.ok || !parsed.document) throw new Error('fixture invalid');
    const version = await store.createBusinessCatalogVersion({ tenantId: tenant.id, status: 'draft', sourceFileName: 'fixture', sourceHash: 'remote-event-test', parserVersion: 'test', catalog: parsed.document, catalogVersionRef: 'anc:v2:' + 'c'.repeat(64) });
    await store.publishBusinessCatalogVersion(tenant.id, version.id);
    const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'anc.company_formation', catalogVersionId: version.catalogVersionRef, opportunityId: randomUUID(), actionKey: 'lead.create', actionRevision: 1, idempotencyKey: 'remote-event-idempotency', state: 'approved', opaqueReference: 'remote-event-action', payload: { contactConsent: true, slotValues: { lead_contact_name: '[NAME_1]', lead_contact_channel: '[EMAIL_1]' } }, createdAt: new Date().toISOString(), result: null });
    const event: import('./types.js').OutboxEvent = { eventId: randomUUID(), eventType: 'intent.action.requested.v1', stream: 'rag:workflow:actions', tenantId: tenant.id, sessionId: session.id, actionId: action.id, aggregateId: action.id, aggregateVersion: 1, workflowKey: action.workflowKey, payloadRef: action.id, idempotencyKey: action.idempotencyKey, correlationId: randomUUID(), payload: {}, occurredAt: new Date().toISOString(), publishedAt: null, attempts: 1, leaseExpiresAt: null, lastError: null };
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://api:4000/api/internal/remote-workflows/execute');
      return new Response(JSON.stringify({ providerStatus: 'accepted', result: { externalReference: '00Q-SYNTHETIC-1', providerOutcome: 'success' }, outcome: { providerOutcome: 'success' } }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await new N8nEventBridge(store, 'http://n8n:5678', 'secret', 5_000, 60_000, 'http://api:4000').dispatch(event);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(await store.getAction(action.id)).toMatchObject({ state: 'processing', result: { externalReference: '00Q-SYNTHETIC-1', providerOutcome: 'success' } });
    expect(await store.getActionExecution(action.id, tenant.id)).toMatchObject({ providerStatus: 'accepted', outcome: { providerOutcome: 'success' } });
  });
});

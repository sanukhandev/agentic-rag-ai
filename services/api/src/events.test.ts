import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createOutboxEvent, eventFields, eventFromFields } from './events.js';
import { MemoryStore } from './store-memory.js';

describe('durable event contracts', () => {
  it('routes opaque action and document events to the intended streams', () => {
    const tenantId = randomUUID();
    const action = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId, aggregateId: randomUUID(), payloadRef: 'opaque-action', idempotencyKey: 'action-1', payload: { actionId: randomUUID(), workflowKey: 'crm.lead.create' } });
    const document = createOutboxEvent({ eventId: randomUUID(), eventType: 'document.extraction.requested.v1', tenantId, aggregateId: randomUUID(), payloadRef: 'job-1', idempotencyKey: 'document-1', payload: { documentId: randomUUID(), jobId: randomUUID() } });
    expect(action.stream).toBe('rag:v2:actions');
    expect(document.stream).toBe('rag:v2:documents');
    expect(eventFromFields(eventFields(action))).toMatchObject({ eventId: action.eventId, payloadRef: 'opaque-action' });
  });

  it('routes ingestion progress without accepting document content', () => {
    const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'ingestion.progress.v1', tenantId: randomUUID(), aggregateId: randomUUID(), payloadRef: 'job-1', idempotencyKey: 'ingestion-progress-1', payload: { jobId: randomUUID(), status: 'processing', stage: 'embedding', processed: 64, total: 2057, errorCode: null } });
    expect(event.stream).toBe('rag:v2:ingestion');
    expect(() => createOutboxEvent({ ...event, eventId: randomUUID(), idempotencyKey: 'ingestion-unsafe', payload: { ...event.payload, content: 'private document text' } })).toThrow('routing references only');
  });

  it('rejects identity-bearing event payloads before Redis publication', () => {
    expect(() => createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId: randomUUID(), aggregateId: randomUUID(), payloadRef: 'opaque', idempotencyKey: 'unsafe', payload: { email: 'person@example.com' } })).toThrow('routing references only');
  });

  it('persists approval and document events in the memory outbox', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Events', slug: `events-${Date.now()}` });
    const session = await store.createSession(tenant.id);
    const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', webhookPath: 'lead-capture', idempotencyKey: 'event-action', state: 'awaiting_confirmation', opaqueReference: 'opaque-action', payload: {}, createdAt: new Date().toISOString(), result: null });
    await store.approveAction({ ...action, state: 'approved' });
    const claimed = await store.claimOutboxEvents(10, 30_000);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ eventType: 'intent.action.requested.v1', actionId: action.id, payloadRef: 'opaque-action' });
  });
});

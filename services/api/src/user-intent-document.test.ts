import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from './store-memory.js';
import { assertSafeUserIntentDocument } from './user-intent-document.js';
import type { ActionRequest, UserIntentDocument, IntentTurnAssessment } from './types.js';

const hash = 'a'.repeat(64);
const documentFor = (tenantId: string, sessionId: string): UserIntentDocument => ({
  id: randomUUID(), tenantId, sessionId, opportunityId: null, catalogSource: 'v2', catalogVersionRef: `ancfz:r1:${hash}`, personaVersionId: null,
  businessGoalKey: 'anc.company_formation', turnIntentKey: 'goal.company_formation', currentStageKey: 'lead_generation', stageRevision: 0, goalConfirmed: false,
  verifiedFacts: { business_activity: { maskedValue: 'technology services', source: 'visitor', messageSequence: 1, evidenceRefs: ['turn:1'], corrected: false } },
  pendingRequirementKey: 'business_activity', lastQuestion: 'What will your business do?', approvedResponse: { answer: 'I can help with the next step.', grounded: false, citationRefs: [], pendingRequirementKey: 'business_activity' },
  toolRefs: ['tool:j1'], sourceRefs: [], summary: 'Synthetic company-formation discovery.', summaryRevision: 0, revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

const turnFor = (document: UserIntentDocument, clientMessageId: string, turnSequence: number, messageHash = hash): IntentTurnAssessment => ({
  id: randomUUID(), documentId: document.id, tenantId: document.tenantId, sessionId: document.sessionId, opportunityId: document.opportunityId, turnSequence, clientMessageId, messageHash,
  businessGoalKey: document.businessGoalKey, turnIntentKey: document.turnIntentKey, intentCategory: 'business_goal', verifiedFactPatch: {}, pendingRequirementKey: document.pendingRequirementKey,
  lastQuestion: document.lastQuestion, approvedResponse: document.approvedResponse, toolRefs: document.toolRefs, sourceRefs: document.sourceRefs, createdAt: new Date().toISOString(),
});

describe('durable v2 User Intent Document boundary', () => {
  it('reconstructs a discovery projection and append-only turns with CAS', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Intent Tenant', slug: 'intent-tenant' });
    const otherTenant = await store.createTenant({ name: 'Other Tenant', slug: 'other-tenant' });
    const session = await store.createSession(tenant.id);
    const document = await store.createUserIntentDocument(documentFor(tenant.id, session.id));
    const action: ActionRequest = { id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', idempotencyKey: randomUUID(), state: 'awaiting_customer', opaqueReference: 'opaque-test', payload: {}, createdAt: new Date().toISOString(), result: null };
    await store.createAction(action);
    await store.appendIntentTurn(turnFor(document, 'turn-1', 1));
    await store.appendIntentTurn(turnFor(document, 'turn-2', 2, 'b'.repeat(64)));
    expect((await store.listIntentTurns(tenant.id, session.id)).map((turn) => turn.turnSequence)).toEqual([1, 2]);
    expect((await store.getUserIntentDocument(tenant.id, session.id))?.opportunityId).toBeNull();
    const updated = await store.updateUserIntentDocument({ document: { ...document, summary: 'Updated synthetic discovery.', summaryRevision: 1 }, expectedRevision: 0 });
    expect(updated?.revision).toBe(1);
    expect(await store.updateUserIntentDocument({ document: { ...document, summary: 'Stale update.' }, expectedRevision: 0 })).toBeNull();
    expect(await store.getAction(action.id)).toEqual(action);
    expect(await store.getUserIntentDocument(otherTenant.id, session.id)).toBeNull();
    expect(await store.listIntentTurns(otherTenant.id, session.id)).toEqual([]);
  });

  it('is idempotent for the same client message and rejects conflicting replay', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Replay Tenant', slug: 'replay-tenant' });
    const session = await store.createSession(tenant.id);
    const document = await store.createUserIntentDocument(documentFor(tenant.id, session.id));
    const first = turnFor(document, 'same-message', 1);
    expect((await store.appendIntentTurn(first)).id).toBe(first.id);
    expect((await store.appendIntentTurn({ ...first, id: randomUUID() })).id).toBe(first.id);
    await expect(store.appendIntentTurn({ ...first, id: randomUUID(), messageHash: 'c'.repeat(64) })).rejects.toThrow('already bound');
    await expect(store.appendIntentTurn({ ...first, id: randomUUID(), clientMessageId: 'wrong-scope', opportunityId: randomUUID() })).rejects.toThrow('opportunity');
  });

  it('rejects raw PII and sensitive fields before persistence', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'Safety Tenant', slug: 'safety-tenant' });
    const session = await store.createSession(tenant.id);
    expect(() => assertSafeUserIntentDocument({ ...documentFor(tenant.id, session.id), summary: 'alice@example.com' })).toThrow('INTENT_DOCUMENT_UNSAFE_SUMMARY');
    expect(() => assertSafeUserIntentDocument({ ...documentFor(tenant.id, session.id), verifiedFacts: { otp: { maskedValue: '123456', source: 'visitor', messageSequence: 1, evidenceRefs: [], corrected: false } } })).toThrow('INTENT_DOCUMENT_UNSAFE_FACTS');
  });

  it('keeps the migration additive and free of destructive SQL', () => {
    const sql = readFileSync(new URL('../../../infra/postgres/056-user-intent-document.sql', import.meta.url), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS user_intent_documents');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS intent_turn_assessments');
    expect(sql).not.toMatch(/^\s*(?:DROP|DELETE|TRUNCATE)\b/imu);
  });
});

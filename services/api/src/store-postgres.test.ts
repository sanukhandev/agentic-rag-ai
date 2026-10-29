import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createOutboxEvent } from './events.js';
import { EventConsumer, N8nEventBridge, type StreamBus, type StreamMessage } from './event-bus.js';
import { PostgresStore } from './store-postgres.js';
import type { OutboxEvent } from './types.js';

const postgresEmbedding = [0.1, ...Array.from({ length: 1_535 }, () => 0)];

class PostgresTestBus implements StreamBus {
  readonly acknowledged: string[] = [];
  readonly deadLetters: OutboxEvent[] = [];
  private readonly messages: StreamMessage[];
  constructor(message: StreamMessage | StreamMessage[]) { this.messages = Array.isArray(message) ? [...message] : [message]; }
  enqueue(message: StreamMessage): void { this.messages.push(message); }
  async connect(): Promise<void> {}
  async close(): Promise<void> {}
  async ensureGroup(): Promise<void> {}
  async append(): Promise<string> { return '1-0'; }
  async read(): Promise<StreamMessage[]> { const next = this.messages.shift(); return next ? [next] : []; }
  async reclaim(): Promise<StreamMessage[]> { return []; }
  async acknowledge(_stream: string, _group: string, id: string): Promise<void> { this.acknowledged.push(id); }
  async deadLetter(event: OutboxEvent): Promise<void> { this.deadLetters.push(event); }
}

describe.skipIf(!process.env.DATABASE_URL)('PostgresStore integration', () => {
  it('atomically establishes a legacy journey and binds only the original pending action', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Legacy Association Test', slug: `legacy-association-${randomUUID()}` });
    try {
      const session = await store.createSession(tenant.id);
      const catalog = await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'published', sourceFileName: 'legacy-association.json', sourceHash: 'f'.repeat(64), parserVersion: 'test', catalog: { tenantScope: tenant.slug, intents: [], signals: [], slots: [], relations: [], workflowBindings: [] } });
      const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'legacy.workflow', intentKey: 'legacy.intent', catalogVersionId: catalog.id, idempotencyKey: randomUUID(), state: 'awaiting_confirmation', opaqueReference: 'legacy', payload: {}, result: { externalReference: 'preserve-me' }, createdAt: new Date().toISOString() });
      await store.updateAction({ ...action, result: { externalReference: 'preserve-me' } });
      session.conversationState = { ...session.conversationState!, selectedIntentKey: 'legacy.intent' };
      const opportunityId = randomUUID();
      const migration = await store.establishLegacyJourneyAndAssignAction({ session, actionId: action.id, intentKey: 'legacy.intent', catalogVersionId: catalog.id, opportunityId, eligibleStates: ['awaiting_confirmation'] });
      expect(migration.committed).toBe(true);
      expect(migration.assignment.action).toMatchObject({ id: action.id, opportunityId, result: action.result });
      const persisted = await store.getSession(session.id);
      expect(persisted?.conversationState?.selectedIntentKey).toBe('legacy.intent');

      const nullableAction = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'legacy.workflow', intentKey: 'legacy.null', catalogVersionId: null, idempotencyKey: randomUUID(), state: 'awaiting_customer', opaqueReference: 'legacy-null', payload: {}, result: null, createdAt: new Date().toISOString() });
      const nullable = await store.assignLegacyActionOpportunity({ tenantId: tenant.id, sessionId: session.id, actionId: nullableAction.id, intentKey: 'legacy.null', catalogVersionId: null, opportunityId: randomUUID(), eligibleStates: ['awaiting_customer'] });
      expect(nullable.status).toBe('assigned');

      const sessionForRace = await store.getSession(session.id);
      expect(sessionForRace).not.toBeNull();
      const raceAction = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'legacy.workflow', intentKey: 'legacy.race', catalogVersionId: catalog.id, idempotencyKey: randomUUID(), state: 'awaiting_confirmation', opaqueReference: 'legacy-race', payload: {}, result: null, createdAt: new Date().toISOString() });
      const raceSession = { ...sessionForRace!, conversationState: { ...sessionForRace!.conversationState!, selectedIntentKey: 'legacy.race' } };
      const [left, right] = await Promise.allSettled([
        store.establishLegacyJourneyAndAssignAction({ session: structuredClone(raceSession), actionId: raceAction.id, intentKey: 'legacy.race', catalogVersionId: catalog.id, opportunityId: randomUUID(), eligibleStates: ['awaiting_confirmation'] }),
        store.establishLegacyJourneyAndAssignAction({ session: structuredClone(raceSession), actionId: raceAction.id, intentKey: 'legacy.race', catalogVersionId: catalog.id, opportunityId: randomUUID(), eligibleStates: ['awaiting_confirmation'] }),
      ]);
      expect([left, right].filter((result) => result.status === 'fulfilled' && result.value.committed)).toHaveLength(1);
      expect((await store.getAction(raceAction.id))?.opportunityId).toBeTruthy();
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);

  it('rolls back the session identity when the legacy action is ineligible', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Legacy Rollback Test', slug: `legacy-rollback-${randomUUID()}` });
    try {
      const session = await store.createSession(tenant.id);
      const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'legacy.workflow', intentKey: 'legacy.rollback', idempotencyKey: randomUUID(), state: 'completed', opaqueReference: 'rollback', payload: {}, result: { externalReference: 'unchanged' }, createdAt: new Date().toISOString() });
      await store.updateAction({ ...action, result: { externalReference: 'unchanged' } });
      const candidate = { ...session, conversationState: { ...session.conversationState!, selectedIntentKey: 'legacy.rollback' } };
      const migration = await store.establishLegacyJourneyAndAssignAction({ session: candidate, actionId: action.id, intentKey: 'legacy.rollback', opportunityId: randomUUID(), eligibleStates: ['awaiting_confirmation'] });
      expect(migration.committed).toBe(false);
      expect((await store.getSession(session.id))?.stateVersion).toBe(session.stateVersion);
      expect((await store.getSession(session.id))?.conversationState?.selectedIntentKey).toBe(session.conversationState?.selectedIntentKey);
      expect((await store.getAction(action.id))?.opportunityId).toBeNull();
      expect((await store.getAction(action.id))?.result).toEqual(action.result);
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);

  it('claims only bounded actions for the matching catalog workflow binding', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Workflow Poll Test', slug: `workflow-poll-${randomUUID()}` });
    try {
      const session = await store.createSession(tenant.id);
      const catalog = (n8nWorkflowId: string, sideEffectClass = 'crm_write') => ({
        tenantScope: tenant.slug,
        intents: [{ intentKey: 'crm.lead.create.request', displayName: 'Lead request', description: 'Lead request', category: 'sales', workflowKey: 'crm.lead.create', minimumScore: 0, confidenceThreshold: 0, confirmationRequired: true, active: true, priority: 1, versionNote: '' }],
        signals: [], slots: [], relations: [],
        workflowBindings: [{ workflowKey: 'crm.lead.create', n8nWorkflowId, webhookPath: 'lead-capture', payloadContract: 'crm-lead-v1', sideEffectClass, active: true }]
      });
      const matchingCatalog = await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'published', sourceFileName: 'matching.json', sourceHash: 'a'.repeat(64), parserVersion: 'test', catalog: catalog('workflow-match') });
      const otherCatalog = await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'draft', sourceFileName: 'other.json', sourceHash: 'b'.repeat(64), parserVersion: 'test', catalog: catalog('workflow-other') });
      const reviewCatalog = await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'draft', sourceFileName: 'review.json', sourceHash: 'c'.repeat(64), parserVersion: 'test', catalog: catalog('workflow-review', 'human_review') });
      const createAction = (catalogVersionId: string, idempotencyKey: string) => store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'crm.lead.create.request', catalogVersionId, idempotencyKey, state: 'approved', opaqueReference: idempotencyKey, payload: {}, createdAt: new Date().toISOString(), result: null });
      const first = await createAction(matchingCatalog.id, 'matching-one');
      const second = await createAction(matchingCatalog.id, 'matching-two');
      const other = await createAction(otherCatalog.id, 'other-workflow');
      const review = await createAction(reviewCatalog.id, 'review-action');

      const firstClaim = await store.claimActionsForWorkflow('workflow-match', undefined, 1);
      expect(firstClaim).toHaveLength(1);
      expect([first.id, second.id]).toContain(firstClaim[0]?.id);
      expect((await store.getAction(other.id))?.state).toBe('approved');
      const secondClaim = await store.claimActionsForWorkflow('workflow-match', undefined, 10);
      expect(secondClaim).toHaveLength(1);
      expect([first.id, second.id]).toContain(secondClaim[0]?.id);
      expect(secondClaim[0]?.id).not.toBe(firstClaim[0]?.id);
      const reviewClaim = await store.claimActionsForWorkflow('workflow-review', undefined, 1);
      expect(reviewClaim.map((action) => action.id)).toEqual([review.id]);
      expect((await store.getAction(review.id))?.state).toBe('processing');
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);

  it('atomically claims a poll action with a dispatching lease and rolls back an execution failure', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Atomic Poll Claim Test', slug: `atomic-poll-${randomUUID()}` });
    try {
      const session = await store.createSession(tenant.id);
      const catalog = await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'published', sourceFileName: 'atomic-poll.json', sourceHash: 'd'.repeat(64), parserVersion: 'test', catalog: {
        tenantScope: tenant.slug,
        intents: [{ intentKey: 'crm.lead.create.request', displayName: 'Lead request', description: 'Lead request', category: 'sales', workflowKey: 'crm.lead.create', minimumScore: 0, confidenceThreshold: 0, confirmationRequired: true, active: true, priority: 1, versionNote: '' }],
        signals: [], slots: [], relations: [], workflowBindings: [{ workflowKey: 'crm.lead.create', n8nWorkflowId: 'atomic-poll-workflow', webhookPath: 'lead-capture', payloadContract: 'crm-lead-v1', sideEffectClass: 'crm_write', active: true }]
      } });
      const failedInsertAction = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'crm.lead.create.request', catalogVersionId: catalog.id, idempotencyKey: 'atomic-poll-failed-insert', state: 'approved', opaqueReference: 'atomic-poll-failed-insert', payload: {}, createdAt: new Date().toISOString(), result: null });
      await expect(store.claimWorkflowActionsWithExecutions({ n8nWorkflowId: 'atomic-poll-workflow', workflowKey: 'crm.lead.create', executionReference: 'atomic-poll-invalid', limit: 1, attempt: 1, deadlineAt: 'not-a-timestamp' })).rejects.toThrow();
      expect((await store.getAction(failedInsertAction.id))?.state).toBe('approved');
      expect(await store.getActionExecution(failedInsertAction.id, tenant.id)).toBeNull();
      await store.transitionAction(failedInsertAction.id, tenant.id, 'approved', 'failed', null);

      const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'crm.lead.create.request', catalogVersionId: catalog.id, idempotencyKey: 'atomic-poll-recovery', state: 'approved', opaqueReference: 'atomic-poll-recovery', payload: {}, createdAt: new Date().toISOString(), result: null });
      const claim = await store.claimWorkflowActionsWithExecutions({ n8nWorkflowId: 'atomic-poll-workflow', workflowKey: 'crm.lead.create', executionReference: 'atomic-poll-recovery-execution', limit: 1, attempt: 1, deadlineAt: new Date(Date.now() - 1_000).toISOString() });
      expect(claim).toHaveLength(1);
      expect(claim[0]).toMatchObject({ action: { id: action.id, state: 'processing' }, execution: { actionId: action.id, providerStatus: 'dispatching', n8nExecutionRef: 'atomic-poll-recovery-execution', attempt: 1 } });
      const recovered = await store.reconcileExpiredActionExecutions(new Date().toISOString());
      expect(recovered).toMatchObject([{ actionId: action.id, providerStatus: 'reconcile_required' }]);
      expect((await store.getAction(action.id))?.state).toBe('reconcile_required');
      expect((await store.getActionExecution(action.id, tenant.id))?.providerStatus).toBe('reconcile_required');
      expect((await store.getSession(session.id))?.conversationState).toMatchObject({ workflowStatus: 'reconcile_required', phase: 'RECONCILE_REQUIRED' });
      expect((await store.listAudit(tenant.id)).some((event) => event.eventName === 'workflow.reconcile_required' && event.metadata.actionId === action.id)).toBe(true);
      expect(await store.claimWorkflowActionsWithExecutions({ n8nWorkflowId: 'atomic-poll-workflow', workflowKey: 'crm.lead.create', executionReference: 'atomic-poll-recovery-execution-2', limit: 1, attempt: 1, deadlineAt: new Date().toISOString() })).toHaveLength(0);
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);

  it('reuses the bridge execution for a webhook claim and rejects mismatched tuples', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const api = request(createApp({ store, nodeEnv: 'test', n8nCallbackSecret: 'postgres-claim-secret' }).app);
    const tenant = await store.createTenant({ name: 'Webhook Claim Test', slug: `webhook-claim-${randomUUID()}` });
    try {
      const session = await store.createSession(tenant.id);
      const catalog = await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'published', sourceFileName: 'webhook-claim.json', sourceHash: 'e'.repeat(64), parserVersion: 'test', catalog: {
        tenantScope: tenant.slug,
        intents: [{ intentKey: 'crm.lead.create.request', displayName: 'Lead request', description: 'Lead request', category: 'sales', workflowKey: 'crm.lead.create', minimumScore: 0, confidenceThreshold: 0, confirmationRequired: true, active: true, priority: 1, versionNote: '' }],
        signals: [], slots: [], relations: [], workflowBindings: [{ workflowKey: 'crm.lead.create', n8nWorkflowId: 'webhook-claim-workflow', webhookPath: 'lead-capture', payloadContract: 'crm-lead-v1', sideEffectClass: 'crm_write', active: true }]
      } });
      const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'crm.lead.create.request', catalogVersionId: catalog.id, idempotencyKey: 'webhook-claim-action', state: 'approved', opaqueReference: 'webhook-claim-action', payload: {}, createdAt: new Date().toISOString(), result: null });
      const eventId = randomUUID();
      const correlationId = randomUUID();
      const execution = await store.claimActionExecution({ id: randomUUID(), actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, catalogVersionId: catalog.id, providerStatus: 'dispatching', n8nExecutionRef: null, eventId, correlationId, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: { eventId, correlationId }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      expect(execution.claimed).toBe(true);

      await api.post('/api/v1/internal/workflow-events/claim').set('x-agentic-internal-secret', 'postgres-claim-secret').send({ actionId: action.id, tenantId: tenant.id, n8nWorkflowId: 'webhook-claim-workflow', workflowKey: 'crm.lead.create', eventId: randomUUID(), correlationId, attempt: 1, executionReference: 'wrong-event-execution', limit: 1 }).expect(409);
      await api.post('/api/v1/internal/workflow-events/claim').set('x-agentic-internal-secret', 'postgres-claim-secret').send({ actionId: action.id, tenantId: randomUUID(), n8nWorkflowId: 'webhook-claim-workflow', workflowKey: 'crm.lead.create', eventId, correlationId, attempt: 1, executionReference: 'wrong-tenant-execution', limit: 1 }).expect(409);

      const [webhookClaim, scheduledPoll] = await Promise.all([
        api.post('/api/v1/internal/workflow-events/claim').set('x-agentic-internal-secret', 'postgres-claim-secret').send({ actionId: action.id, tenantId: tenant.id, n8nWorkflowId: 'webhook-claim-workflow', workflowKey: 'crm.lead.create', eventId, correlationId, attempt: 1, executionReference: 'n8n-execution-1', limit: 1 }),
        api.post('/api/v1/internal/workflow-events/claim').set('x-agentic-internal-secret', 'postgres-claim-secret').send({ n8nWorkflowId: 'webhook-claim-workflow', workflowKey: 'crm.lead.create', executionReference: 'poll-execution-1', limit: 1 }),
      ]);
      expect(webhookClaim.status).toBe(200);
      expect(webhookClaim.body.items).toHaveLength(1);
      expect(webhookClaim.body.items[0]).toMatchObject({ actionId: action.id, eventId, correlationId, attempt: 1 });
      expect(scheduledPoll.status).toBe(200);
      expect(scheduledPoll.body.items).toHaveLength(0);
      expect((await store.getActionExecution(action.id, tenant.id))?.id).toBe(execution.execution.id);

      const duplicateAction = await store.createAction({ ...action, id: randomUUID(), idempotencyKey: 'webhook-claim-duplicate', state: 'approved' });
      const duplicateEventId = randomUUID();
      const duplicateCorrelationId = randomUUID();
      await store.claimActionExecution({ id: randomUUID(), actionId: duplicateAction.id, tenantId: tenant.id, workflowKey: duplicateAction.workflowKey, catalogVersionId: catalog.id, providerStatus: 'dispatching', n8nExecutionRef: null, eventId: duplicateEventId, correlationId: duplicateCorrelationId, idempotencyKey: duplicateAction.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: { eventId: duplicateEventId, correlationId: duplicateCorrelationId }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      const [ownerA, ownerB] = await Promise.all([
        api.post('/api/v1/internal/workflow-events/claim').set('x-agentic-internal-secret', 'postgres-claim-secret').send({ actionId: duplicateAction.id, tenantId: tenant.id, n8nWorkflowId: 'webhook-claim-workflow', workflowKey: 'crm.lead.create', eventId: duplicateEventId, correlationId: duplicateCorrelationId, attempt: 1, executionReference: 'duplicate-owner-a', limit: 1 }),
        api.post('/api/v1/internal/workflow-events/claim').set('x-agentic-internal-secret', 'postgres-claim-secret').send({ actionId: duplicateAction.id, tenantId: tenant.id, n8nWorkflowId: 'webhook-claim-workflow', workflowKey: 'crm.lead.create', eventId: duplicateEventId, correlationId: duplicateCorrelationId, attempt: 1, executionReference: 'duplicate-owner-b', limit: 1 }),
      ]);
      expect([ownerA.status, ownerB.status].sort()).toEqual([200, 409]);
      expect((await store.getActionExecution(duplicateAction.id, tenant.id))?.n8nExecutionRef).toMatch(/duplicate-owner-[ab]/u);

      await api.post('/api/v1/internal/workflow-events/complete').set('x-agentic-internal-secret', 'postgres-claim-secret').send({ actionId: action.id, tenantId: tenant.id, state: 'completed', externalReference: 'remote-lead-1', executionReference: 'n8n-execution-1', eventId, correlationId, attempt: 1 }).expect(200);
      expect((await store.getAction(action.id))?.state).toBe('completed');
      expect((await store.getActionExecution(action.id, tenant.id))?.providerStatus).toBe('completed');
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);

  it('persists tenant-scoped sources, encrypted token values and durable responses', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Postgres Test', slug: `postgres-${randomUUID()}` });
    try {
      expect((await store.setTenantPublicOrigin(tenant.id, 'https://store.example'))?.publicOrigin).toBe('https://store.example');
      expect((await store.setTenantPublicChatEnabled(tenant.id, false))?.publicChatEnabled).toBe(false);
      expect((await store.setTenantPublicChatEnabled(tenant.id, true))?.publicChatEnabled).toBe(true);
      const member = await store.createUser({ email: `member-${randomUUID()}@example.test`, passwordHash: 'hash', role: 'tenant_editor', tenantId: tenant.id });
      expect(await store.updateUserRole(member.id, tenant.id, 'tenant_viewer')).toMatchObject({ id: member.id, role: 'tenant_viewer' });
      const domain = await store.addDomain({ tenantId: tenant.id, hostname: 'chat.postgres.example' });
      expect(await store.listDomains(tenant.id)).toMatchObject([{ id: domain.id, hostname: 'chat.postgres.example' }]);
      expect(await store.removeDomain(domain.id, tenant.id)).toBe(true);
      const personaVersion = await store.createPersonaVersion({ tenantId: tenant.id, name: 'Ava', greeting: 'Hello', personality: 'Precise', tone: 'Clear', speakingStyle: 'Short', permittedLanguages: ['en'], contextWindowMessages: 10, voiceName: '', voiceLanguage: 'en-US', voiceRate: 1, voicePitch: 1, voiceVolume: 1, status: 'draft' });
      expect(personaVersion.version).toBe(1);
      await expect(store.publishPersonaVersion(tenant.id, personaVersion.id)).resolves.toMatchObject({ status: 'published', version: 1 });
      expect(await store.getPersona(tenant.id)).toMatchObject({ name: 'Ava' });
      const session = await store.createSession(tenant.id, personaVersion.id);
      expect((await store.getSession(session.id))?.personaVersionId).toBe(personaVersion.id);
      session.tokenMap.set('[EMAIL_1]', 'v1.ciphertext');
      await store.updateSession(session);
      expect((await store.getSession(session.id))?.tokenMap.get('[EMAIL_1]')).toBe('v1.ciphertext');
      const sourceId = randomUUID();
      const versionId = randomUUID();
      const source = await store.createSource({ id: sourceId, tenantId: tenant.id, title: 'FAQ', mimeType: 'text/plain', sourceUrl: null, audience: 'public', status: 'awaiting_review', embeddingReady: true, versionId, contentHash: 'hash', chunks: [{ id: randomUUID(), sourceId, tenantId: tenant.id, versionId, ordinal: 0, locator: 'section 1', content: 'Pricing is 100 credits.', contentHash: 'chunk-hash', embedding: postgresEmbedding }] });
      const job = await store.createIngestionJob({ id: randomUUID(), tenantId: tenant.id, title: 'FAQ', mimeType: 'text/plain', sourceUrl: null, audience: 'public' });
      const claimedJob = await store.claimIngestionJob(job.id, 60_000);
      expect(claimedJob).toMatchObject({ status: 'processing', attempts: 1 });
      const nextJob = await store.createIngestionJob({ id: randomUUID(), tenantId: tenant.id, title: 'Next FAQ', mimeType: 'text/plain', sourceUrl: null, audience: 'public' });
      expect(await store.claimNextIngestionJob(60_000)).toMatchObject({ id: nextJob.id, status: 'processing', attempts: 1 });
      const completedJob = await store.updateIngestionJob({ ...claimedJob!, sourceId: source.id, status: 'completed', errorCode: null, leaseExpiresAt: null, updatedAt: new Date().toISOString() });
      expect(await store.getIngestionJob(job.id)).toMatchObject({ id: job.id, sourceId: source.id, status: 'completed', attempts: 1 });
      expect(completedJob.errorCode).toBeNull();
      const callbackNonce = randomUUID();
      expect(await store.claimCallbackNonce(callbackNonce, new Date(Date.now() + 60_000).toISOString())).toBe(true);
      expect(await store.claimCallbackNonce(callbackNonce, new Date(Date.now() + 60_000).toISOString())).toBe(false);
      await store.setSourceStatus(source.id, tenant.id, 'active');
      expect((await store.listSearchableChunks(tenant.id, 'public')).length).toBe(1);
      expect((await store.searchSearchableChunks(tenant.id, 'public', postgresEmbedding, 4)).length).toBe(1);
      const userMessage = await store.addMessage({ id: randomUUID(), sessionId: session.id, tenantId: tenant.id, role: 'user', maskedContent: 'What is pricing?', citations: [], clientMessageId: 'client-1', response: null, createdAt: new Date().toISOString() });
      await store.updateMessage({ ...userMessage, response: { answer: 'Pricing is 100 credits.' } });
      expect((await store.getMessageByClientId(session.id, 'client-1'))?.response).toMatchObject({ answer: 'Pricing is 100 credits.' });
      expect(await store.listMessages(session.id, tenant.id)).toHaveLength(1);
      expect(await store.listMessages(session.id, tenant.id, 1)).toHaveLength(1);
      const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'lead.capture', idempotencyKey: 'action-1', state: 'awaiting_confirmation', opaqueReference: 'lead-1', payload: {}, createdAt: new Date().toISOString(), result: null });
      const approved = await store.approveAction({ ...action, state: 'approved' });
      expect(approved.state).toBe('approved');
      const outbox = await pool.query('SELECT event_type,action_id,payload_ref FROM event_outbox WHERE tenant_id=$1', [tenant.id]);
      expect(outbox.rows).toMatchObject([{ event_type: 'intent.action.requested.v1', action_id: action.id, payload_ref: 'lead-1' }]);
      await store.updateAction({ ...action, state: 'completed', result: { externalReference: 'run-1' } });
      expect((await store.getAction(action.id))?.result).toEqual({ externalReference: 'run-1' });
      expect((await store.getTenantStats(tenant.id)).sourceCounts.active).toBe(1);
      expect((await store.getTenantStats(tenant.id)).ingestionJobs.completed).toBe(1);
      const currentChunks = await store.listSourceChunks(source.id, tenant.id);
      const nextVersion = randomUUID();
      const reindexed = await store.replaceSourceVersion({ sourceId: source.id, tenantId: tenant.id, versionId: nextVersion, contentHash: source.contentHash, chunks: [{ ...currentChunks[0]!, id: randomUUID(), versionId: nextVersion }] });
      expect(reindexed).toMatchObject({ id: source.id, versionId: nextVersion, status: 'awaiting_review' });
      expect(await store.listSourceVersions(source.id, tenant.id)).toHaveLength(2);
      expect(await store.purgeExpiredSessions(tenant.id, new Date(Date.now() + 1_000).toISOString())).toBe(1);
    } finally {
      await pool.query('DELETE FROM users WHERE tenant_id=$1', [tenant.id]);
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);

  it('claims an inbox row safely under concurrent delivery and reconciles an overdue accepted execution', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Execution Recovery Test', slug: `execution-recovery-${randomUUID()}` });
    const eventId = randomUUID();
    try {
      const session = await store.createSession(tenant.id);
      const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', idempotencyKey: 'execution-recovery', state: 'processing', opaqueReference: 'execution-recovery', payload: {}, createdAt: new Date().toISOString(), result: null });
      const claims = await Promise.all([store.claimInboxEvent('integration-workers', eventId), store.claimInboxEvent('integration-workers', eventId)]);
      expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
      const dispatchAction = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', idempotencyKey: 'dispatch-claim', state: 'processing', opaqueReference: 'dispatch-claim', payload: {}, createdAt: new Date().toISOString(), result: null });
      const execution = { id: randomUUID(), actionId: dispatchAction.id, tenantId: tenant.id, workflowKey: dispatchAction.workflowKey, catalogVersionId: null, providerStatus: 'dispatching', n8nExecutionRef: null, eventId: randomUUID(), correlationId: randomUUID(), idempotencyKey: dispatchAction.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() + 60_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      const executionClaims = await Promise.all([store.claimActionExecution(execution), store.claimActionExecution({ ...execution, id: randomUUID() })]);
      expect(executionClaims.filter((claim) => claim.claimed)).toHaveLength(1);
      await store.updateActionExecution({ actionId: dispatchAction.id, tenantId: tenant.id, providerStatus: 'accepted' });
      await store.updateActionExecution({ actionId: dispatchAction.id, tenantId: tenant.id, providerStatus: 'completed', n8nExecutionRef: 'execution-complete', outcome: { externalReference: 'remote-1' } });
      const staleAccepted = await store.recordActionExecution({ ...execution, id: randomUUID(), providerStatus: 'accepted' });
      expect(staleAccepted.providerStatus).toBe('completed');
      await store.recordActionExecution({ id: randomUUID(), actionId: action.id, tenantId: tenant.id, workflowKey: action.workflowKey, catalogVersionId: null, providerStatus: 'accepted', n8nExecutionRef: null, idempotencyKey: action.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() - 1_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      const reconciled = await store.reconcileExpiredActionExecutions(new Date().toISOString());
      expect(reconciled).toMatchObject([{ actionId: action.id, providerStatus: 'reconcile_required' }]);
      expect((await store.getAction(action.id))?.state).toBe('reconcile_required');
      expect((await store.getSession(session.id))?.conversationState).toMatchObject({ workflowStatus: 'reconcile_required', phase: 'RECONCILE_REQUIRED' });
      expect((await store.listAudit(tenant.id)).some((event) => event.eventName === 'workflow.reconcile_required')).toBe(true);
      const dlqEvent = createOutboxEvent({ eventId: randomUUID(), eventType: 'conversation.notification.requested.v1', tenantId: tenant.id, sessionId: session.id, aggregateId: session.id, payloadRef: 'dlq-ref', idempotencyKey: 'dlq-projection' });
      await store.claimInboxEvent('dlq-workers', dlqEvent.eventId);
      await store.markInboxDeadLettered('dlq-workers', dlqEvent.eventId, 'terminal failure', dlqEvent);
      expect(await store.claimInboxDeadLetterProjections(1, 60_000)).toMatchObject([{ consumer: 'dlq-workers', eventId: dlqEvent.eventId, reason: 'terminal failure' }]);
      await store.releaseInboxDeadLetterProjection('dlq-workers', dlqEvent.eventId);
      expect(await store.claimInboxDeadLetterProjections(1, 60_000)).toHaveLength(1);
      await store.markInboxDeadLetterPublished('dlq-workers', dlqEvent.eventId);
      expect(await store.claimInboxDeadLetterProjections(1, 60_000)).toHaveLength(0);
      const completedAction = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', idempotencyKey: 'completed-before-watchdog', state: 'completed', opaqueReference: 'completed-before-watchdog', payload: {}, createdAt: new Date().toISOString(), result: { externalReference: 'already-complete' } });
      const completedSession = await store.getSession(session.id);
      completedSession!.conversationState = { ...(completedSession!.conversationState!), workflowStatus: 'succeeded', phase: 'SUCCEEDED' };
      await store.updateSession(completedSession!);
      await store.recordActionExecution({ id: randomUUID(), actionId: completedAction.id, tenantId: tenant.id, workflowKey: completedAction.workflowKey, catalogVersionId: null, providerStatus: 'accepted', n8nExecutionRef: 'accepted-late', idempotencyKey: completedAction.idempotencyKey, attempt: 1, deadlineAt: new Date(Date.now() - 1_000).toISOString(), outcome: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      await store.reconcileExpiredActionExecutions(new Date().toISOString());
      expect((await store.getAction(completedAction.id))?.state).toBe('completed');
      expect((await store.getActionExecution(completedAction.id, tenant.id))?.providerStatus).toBe('accepted');
      expect((await store.getSession(session.id))?.conversationState).toMatchObject({ workflowStatus: 'succeeded', phase: 'SUCCEEDED' });
      expect((await store.listAudit(tenant.id)).filter((event) => event.metadata.actionId === completedAction.id)).toHaveLength(0);
    } finally {
      await pool.query('DELETE FROM event_inbox WHERE (consumer=$1 AND event_id=$2) OR consumer=$3', ['integration-workers', eventId, 'dlq-workers']);
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);

  it('closes PostgreSQL execution state on terminal transient and permanent dispatch failures', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Execution Failure Test', slug: `execution-failure-${randomUUID()}` });
    let statusCode = 500;
    const server = createServer((_request, response) => { response.writeHead(statusCode).end('workflow failure'); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    const eventIds: string[] = [];
    try {
      const session = await store.createSession(tenant.id);
      const run = async (status: number, key: string) => {
        statusCode = status;
        const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', idempotencyKey: key, state: 'approved', opaqueReference: key, payload: {}, createdAt: new Date().toISOString(), result: null });
        const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId: tenant.id, sessionId: session.id, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id } });
        eventIds.push(event.eventId);
        const bus = new PostgresTestBus({ id: `${eventIds.length}-0`, event });
        const consumer = new EventConsumer(store, bus, new N8nEventBridge(store, `http://127.0.0.1:${address.port}`, 'secret'), `pg-failure-${key}`, 1);
        await consumer.runOnce('rag:v2:actions', 'intent-workers', 0);
        expect((await store.getAction(action.id))?.state).toBe('failed');
        expect(await store.getActionExecution(action.id, tenant.id)).toMatchObject({ providerStatus: 'failed', attempt: 1 });
        const inbox = await pool.query('SELECT state FROM event_inbox WHERE consumer=$1 AND event_id=$2', ['intent-workers', event.eventId]);
        expect(inbox.rows[0]?.state).toBe('dead_lettered');
      };
      await run(500, 'pg-transient-terminal');
      await run(400, 'pg-permanent-terminal');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (eventIds.length) await pool.query('DELETE FROM event_inbox WHERE consumer=$1 AND event_id = ANY($2::uuid[])', ['intent-workers', eventIds]);
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);

  it('reclaims a dispatching execution at a higher attempt and commits the eventual terminal pair', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Execution Retry Test', slug: `execution-retry-${randomUUID()}` });
    let requests = 0;
    const server = createServer((_request, response) => response.writeHead(requests++ === 0 ? 500 : 202).end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
    const eventIds: string[] = [];
    try {
      const session = await store.createSession(tenant.id);
      const action = await store.createAction({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', idempotencyKey: 'execution-retry', state: 'approved', opaqueReference: 'execution-retry', payload: {}, createdAt: new Date().toISOString(), result: null });
      const event = createOutboxEvent({ eventId: randomUUID(), eventType: 'intent.action.requested.v1', tenantId: tenant.id, sessionId: session.id, actionId: action.id, aggregateId: action.id, workflowKey: action.workflowKey, payloadRef: action.opaqueReference, idempotencyKey: action.idempotencyKey, payload: { actionId: action.id } });
      eventIds.push(event.eventId);
      const bus = new PostgresTestBus({ id: 'retry-1', event });
      const consumer = new EventConsumer(store, bus, new N8nEventBridge(store, `http://127.0.0.1:${address.port}`, 'secret'), 'pg-retry', 2);
      await consumer.runOnce('rag:v2:actions', 'intent-workers', 0);
      expect(await store.getActionExecution(action.id, tenant.id)).toMatchObject({ providerStatus: 'dispatching', attempt: 1 });
      bus.enqueue({ id: 'retry-2', event });
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await consumer.runOnce('rag:v2:actions', 'intent-workers', 0);
      const accepted = await store.getActionExecution(action.id, tenant.id);
      expect(accepted).toMatchObject({ providerStatus: 'accepted', attempt: 2, eventId: event.eventId, correlationId: event.correlationId });
      const completed = await store.transitionActionWithExecution({ actionId: action.id, tenantId: tenant.id, fromState: 'approved', toState: 'completed', result: { externalReference: 'remote-retry' }, providerStatus: 'completed', n8nExecutionRef: 'execution-retry', eventId: event.eventId, correlationId: event.correlationId, expectedAttempt: 2, outcome: { externalReference: 'remote-retry' } });
      expect(completed).toMatchObject({ action: { state: 'completed' }, execution: { providerStatus: 'completed', attempt: 2, n8nExecutionRef: 'execution-retry' } });
      const inbox = await pool.query('SELECT state FROM event_inbox WHERE consumer=$1 AND event_id=$2', ['intent-workers', event.eventId]);
      expect(inbox.rows[0]?.state).toBe('completed');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (eventIds.length) await pool.query('DELETE FROM event_inbox WHERE consumer=$1 AND event_id = ANY($2::uuid[])', ['intent-workers', eventIds]);
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);
});

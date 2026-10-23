import { createClient } from 'redis';
import { randomUUID } from 'node:crypto';
import type { Store, OutboxEvent } from './types.js';
import { eventFields, eventFromFields } from './events.js';

export interface StreamMessage {
  id: string;
  event: OutboxEvent;
}

type RedisStreamMessage = { id: string; message: Record<string, string> };

export interface StreamBus {
  connect(): Promise<void>;
  close(): Promise<void>;
  ensureGroup(stream: string, group: string): Promise<void>;
  append(event: OutboxEvent): Promise<string>;
  read(stream: string, group: string, consumer: string, count: number, blockMs: number): Promise<StreamMessage[]>;
  reclaim(stream: string, group: string, consumer: string, idleMs: number, count: number): Promise<StreamMessage[]>;
  acknowledge(stream: string, group: string, messageId: string): Promise<void>;
  deadLetter(event: OutboxEvent, reason: string): Promise<void>;
}

export class RedisStreamBus implements StreamBus {
  private readonly client: ReturnType<typeof createClient>;
  private connection: Promise<void> | null = null;

  constructor(url: string) {
    this.client = createClient({ url });
    this.client.on('error', () => undefined);
  }

  async connect(): Promise<void> {
    if (this.client.isReady) return;
    if (!this.connection) this.connection = this.client.connect().then(() => undefined).finally(() => { this.connection = null; });
    await this.connection;
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }

  async ensureGroup(stream: string, group: string): Promise<void> {
    await this.connect();
    // New groups must replay the retained backlog. Existing groups keep their Redis offset.
    try { await this.client.xGroupCreate(stream, group, '0-0', { MKSTREAM: true }); } catch (error) { if (!String(error).includes('BUSYGROUP')) throw error; }
  }

  async append(event: OutboxEvent): Promise<string> { await this.connect(); return this.client.xAdd(event.stream, '*', eventFields(event)); }

  async read(stream: string, group: string, consumer: string, count: number, blockMs: number): Promise<StreamMessage[]> {
    await this.connect();
    const result = await this.client.xReadGroup(group, consumer, [{ key: stream, id: '>' }], { COUNT: count, BLOCK: blockMs });
    return (result ?? []).flatMap((entry) => (entry.messages as RedisStreamMessage[]).map((message) => ({ id: message.id, event: eventFromFields(message.message) })));
  }

  async reclaim(stream: string, group: string, consumer: string, idleMs: number, count: number): Promise<StreamMessage[]> {
    await this.connect();
    const result = await this.client.xAutoClaim(stream, group, consumer, idleMs, '0-0', { COUNT: count });
    return (result.messages ?? []).filter((message): message is RedisStreamMessage => message !== null).map((message) => ({ id: message.id, event: eventFromFields(message.message) }));
  }

  async acknowledge(stream: string, group: string, messageId: string): Promise<void> { await this.connect(); await this.client.xAck(stream, group, messageId); }

  async deadLetter(event: OutboxEvent, reason: string): Promise<void> { await this.connect(); await this.client.xAdd('rag:v2:dead-letter', '*', { ...eventFields(event), reason: reason.slice(0, 500) }); }
}

export class OutboxRelay {
  constructor(private readonly store: Store, private readonly bus: StreamBus, private readonly leaseMs = 30_000, private readonly maxAttempts = 10) {}

  async runOnce(limit = 25): Promise<number> {
    const events = await this.store.claimOutboxEvents(limit, this.leaseMs);
    let published = 0;
    for (const event of events) {
      try {
        await this.bus.append(event);
        await this.store.markOutboxPublished(event.eventId);
        published += 1;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (event.attempts >= this.maxAttempts) {
          await this.bus.deadLetter(event, reason);
          await this.store.deadLetterOutboxEvent(event.eventId, reason);
        } else {
          const retryAt = new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(event.attempts, 6))).toISOString();
          await this.store.releaseOutboxEvent(event.eventId, reason, retryAt);
        }
      }
    }
    return published;
  }
}

export class AmbiguousEventDispatchError extends Error {}
export class ReconcileRequiredDispatchError extends Error {}
export class TransientEventDispatchError extends Error {}
export class PermanentEventDispatchError extends Error {}

export class N8nEventBridge {
  constructor(private readonly store: Store, private readonly baseUrl: string, private readonly secret: string, private readonly timeoutMs = 5_000) {}

  async dispatch(event: OutboxEvent): Promise<void> {
    const route = event.eventType === 'intent.action.requested.v1' ? await this.actionRoute(event) : event.eventType === 'document.extraction.requested.v1' ? await this.documentRoute(event) : null;
    if (!route) {
      if (event.eventType === 'crm.contact.upsert.requested.v1' || event.eventType === 'crm.summary.update.requested.v1' || event.eventType === 'crm.reconcile.requested.v1' || event.eventType === 'conversation.notification.requested.v1') {
        await this.store.addAudit({ id: randomUUID(), tenantId: event.tenantId, actorId: null, eventName: 'event.intentional_noop', metadata: { eventId: event.eventId, eventType: event.eventType, correlationId: event.correlationId }, createdAt: new Date().toISOString() });
        return;
      }
      throw new PermanentEventDispatchError(`No authorized route exists for event type ${event.eventType}.`);
    }
    const body = JSON.stringify({ ...event.payload, eventId: event.eventId, eventType: event.eventType, tenantId: event.tenantId, sessionId: event.sessionId, actionId: event.actionId, aggregateId: event.aggregateId, payloadRef: event.payloadRef, webhookPath: route.webhookPath, workflowKey: route.workflowKey, n8nWorkflowId: route.n8nWorkflowId ?? null, contract: route.payloadContract ?? (event.eventType === 'document.extraction.requested.v1' ? 'anc-document-ocr-v1' : 'crm-lead-capture-v1'), correlationId: event.correlationId });
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/webhook/${route.webhookPath.replace(/^\/+/, '')}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentic-internal-secret': this.secret, 'x-agentic-event-id': event.eventId }, body, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) throw new ReconcileRequiredDispatchError(`n8n route is not authorized or available (${response.status}); reconciliation is required.`);
        if ([408, 425, 429, 500, 502, 503, 504].includes(response.status)) throw new TransientEventDispatchError(`n8n dispatch returned transient status ${response.status}.`);
        throw new PermanentEventDispatchError(`n8n dispatch returned permanent status ${response.status}.`);
      }
      if (event.actionId) {
        const action = await this.store.getAction(event.actionId);
        if (action && action.tenantId === event.tenantId) await this.store.recordActionExecution({ id: randomUUID(), actionId: action.id, tenantId: action.tenantId, workflowKey: action.workflowKey, catalogVersionId: action.catalogVersionId ?? null, providerStatus: 'accepted', n8nExecutionRef: null, idempotencyKey: action.idempotencyKey, attempt: event.attempts, deadlineAt: null, outcome: { eventId: event.eventId, correlationId: event.correlationId }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      }
      await this.store.addAudit({ id: randomUUID(), tenantId: event.tenantId, actorId: null, eventName: 'workflow.dispatch_accepted', metadata: { eventId: event.eventId, actionId: event.actionId, workflowKey: route.workflowKey, correlationId: event.correlationId, attempt: event.attempts }, createdAt: new Date().toISOString() });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        if (event.actionId) {
          const action = await this.store.getAction(event.actionId);
          if (action && action.tenantId === event.tenantId && !['completed', 'failed', 'reconcile_required', 'awaiting_customer', 'human_review'].includes(action.state)) {
            const updated = await this.store.transitionAction(action.id, action.tenantId, action.state, 'reconcile_required', action.result);
            if (updated) await this.store.addAudit({ id: randomUUID(), tenantId: event.tenantId, actorId: null, eventName: 'workflow.reconcile_required', metadata: { actionId: action.id, eventId: event.eventId }, createdAt: new Date().toISOString() });
          }
        }
        throw new AmbiguousEventDispatchError('n8n dispatch timed out; reconciliation is required.');
      }
      if (error instanceof TransientEventDispatchError || error instanceof PermanentEventDispatchError || error instanceof ReconcileRequiredDispatchError) throw error;
      if (error instanceof TypeError) throw new TransientEventDispatchError('n8n dispatch could not connect to the workflow endpoint.');
      throw error;
    }
  }

  private async actionRoute(event: OutboxEvent): Promise<{ workflowKey: string; webhookPath: string; n8nWorkflowId?: string; payloadContract?: string } | null> {
    if (!event.actionId) return null;
    const action = await this.store.getAction(event.actionId);
    if (!action || action.tenantId !== event.tenantId || !['approved', 'processing'].includes(action.state)) return null;
    if (!action.catalogVersionId) return { workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? 'lead-capture' };
    const version = await this.store.getIntentCatalogVersion(action.tenantId, action.catalogVersionId);
    const binding = version?.catalog.workflowBindings.find((candidate) => candidate.workflowKey === action.workflowKey && candidate.active);
    return binding ? { workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, n8nWorkflowId: binding.n8nWorkflowId, payloadContract: binding.payloadContract } : null;
  }

  private async documentRoute(event: OutboxEvent): Promise<{ workflowKey: string; webhookPath: string; n8nWorkflowId?: string; payloadContract?: string } | null> {
    const job = await this.store.getDocumentProcessingJob(event.payloadRef, event.tenantId);
    if (!job || job.tenantId !== event.tenantId || job.status !== 'queued') return null;
    const version = await this.store.getPublishedIntentCatalog(job.tenantId);
    const binding = version?.catalog.workflowBindings.find((candidate) => candidate.workflowKey === job.workflowKey && candidate.active);
    return binding ? { workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, n8nWorkflowId: binding.n8nWorkflowId, payloadContract: binding.payloadContract } : null;
  }
}

export class EventConsumer {
  constructor(private readonly store: Store, private readonly bus: StreamBus, private readonly bridge: N8nEventBridge, private readonly consumer = `worker-${process.pid}`, private readonly maxAttempts = 3) {}

  async runOnce(stream: string, group: string, blockMs = 250): Promise<number> {
    await this.bus.ensureGroup(stream, group);
    const messages = [...await this.bus.reclaim(stream, group, this.consumer, 30_000, 10), ...await this.bus.read(stream, group, this.consumer, 10, blockMs)];
    let handled = 0;
    for (const message of messages) {
      const claim = await this.store.claimInboxEvent(group, message.event.eventId);
      if (!claim.claimed) { await this.bus.acknowledge(stream, group, message.id); continue; }
      try {
        await this.bridge.dispatch(message.event);
        await this.store.completeInboxEvent(group, message.event.eventId);
        handled += 1;
        await this.bus.acknowledge(stream, group, message.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (error instanceof TransientEventDispatchError && claim.attempts < this.maxAttempts) {
          const delay = Math.min(60_000, 1_000 * 2 ** Math.min(claim.attempts - 1, 6)) + Math.floor(Math.random() * 250);
          await this.store.scheduleInboxRetry(group, message.event.eventId, reason, new Date(Date.now() + delay).toISOString());
          continue;
        }
        if (error instanceof AmbiguousEventDispatchError || error instanceof ReconcileRequiredDispatchError) {
          await this.store.markInboxReconcileRequired(group, message.event.eventId, reason);
          await this.markReconciliationRequired(message.event, reason);
          await this.bus.deadLetter(message.event, reason);
          await this.bus.acknowledge(stream, group, message.id);
          continue;
        }
        await this.markFailed(message.event, reason);
        await this.store.markInboxDeadLettered(group, message.event.eventId, reason);
        await this.bus.deadLetter(message.event, reason);
        await this.bus.acknowledge(stream, group, message.id);
      }
    }
    return handled;
  }

  private async markReconciliationRequired(event: OutboxEvent, reason: string): Promise<void> {
    if (event.actionId) {
      const action = await this.store.getAction(event.actionId);
      if (action && action.tenantId === event.tenantId && !['completed', 'failed', 'reconcile_required', 'awaiting_customer', 'human_review'].includes(action.state)) {
        const updated = await this.store.transitionAction(action.id, action.tenantId, action.state, 'reconcile_required', action.result);
        if (updated) await this.store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: 'workflow.reconcile_required', metadata: { actionId: action.id, eventId: event.eventId, correlationId: event.correlationId, reason }, createdAt: new Date().toISOString() });
      }
    }
    const documentJob = event.eventType === 'document.extraction.requested.v1' ? await this.store.getDocumentProcessingJob(event.payloadRef, event.tenantId) : null;
    if (documentJob && documentJob.status !== 'completed' && documentJob.status !== 'failed') await this.store.updateDocumentProcessingJob({ ...documentJob, status: 'reconciliation', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
  }

  private async markFailed(event: OutboxEvent, reason: string): Promise<void> {
    if (event.actionId) {
      const action = await this.store.getAction(event.actionId);
      if (action && action.tenantId === event.tenantId && !['completed', 'failed', 'reconcile_required', 'awaiting_customer', 'human_review'].includes(action.state)) {
        const updated = await this.store.transitionAction(action.id, action.tenantId, action.state, 'failed', action.result);
        if (updated) await this.store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: 'workflow.failed', metadata: { actionId: action.id, eventId: event.eventId, correlationId: event.correlationId, reason: reason.slice(0, 500) }, createdAt: new Date().toISOString() });
      }
    }
    const documentJob = event.eventType === 'document.extraction.requested.v1' ? await this.store.getDocumentProcessingJob(event.payloadRef, event.tenantId) : null;
    if (documentJob && !['completed', 'failed', 'reconciliation'].includes(documentJob.status)) await this.store.updateDocumentProcessingJob({ ...documentJob, status: 'failed', leaseExpiresAt: null, updatedAt: new Date().toISOString() });
  }
}

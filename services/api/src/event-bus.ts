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
    try { await this.client.xGroupCreate(stream, group, '$', { MKSTREAM: true }); } catch (error) { if (!String(error).includes('BUSYGROUP')) throw error; }
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
  constructor(private readonly store: Store, private readonly bus: StreamBus, private readonly leaseMs = 30_000) {}

  async runOnce(limit = 25): Promise<number> {
    const events = await this.store.claimOutboxEvents(limit, this.leaseMs);
    let published = 0;
    for (const event of events) {
      try {
        await this.bus.append(event);
        await this.store.markOutboxPublished(event.eventId);
        published += 1;
      } catch (error) {
        const retryAt = new Date(Date.now() + Math.min(60_000, 1_000 * 2 ** Math.min(event.attempts, 6))).toISOString();
        await this.store.releaseOutboxEvent(event.eventId, error instanceof Error ? error.message : String(error), retryAt);
      }
    }
    return published;
  }
}

export class AmbiguousEventDispatchError extends Error {}
export class ReconcileRequiredDispatchError extends Error {}

export class N8nEventBridge {
  constructor(private readonly store: Store, private readonly baseUrl: string, private readonly secret: string, private readonly timeoutMs = 5_000) {}

  async dispatch(event: OutboxEvent): Promise<void> {
    const route = event.eventType === 'intent.action.requested.v1' ? await this.actionRoute(event) : event.eventType === 'document.extraction.requested.v1' ? await this.documentRoute(event) : null;
    if (!route) return;
    const body = JSON.stringify({ ...event.payload, eventId: event.eventId, eventType: event.eventType, tenantId: event.tenantId, sessionId: event.sessionId, actionId: event.actionId, aggregateId: event.aggregateId, payloadRef: event.payloadRef, workflowKey: route.workflowKey, contract: event.eventType === 'document.extraction.requested.v1' ? 'anc-document-ocr-v1' : 'crm-lead-capture-v1', correlationId: event.correlationId });
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/webhook/${route.webhookPath.replace(/^\/+/, '')}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentic-internal-secret': this.secret, 'x-agentic-event-id': event.eventId }, body, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          await this.store.addAudit({ id: randomUUID(), tenantId: event.tenantId, actorId: null, eventName: 'workflow.event_fallback_to_polling', metadata: { eventId: event.eventId, workflowKey: route.workflowKey, status: response.status }, createdAt: new Date().toISOString() });
          return;
        }
        throw new ReconcileRequiredDispatchError(`n8n dispatch failed with status ${response.status}; reconciliation is required.`);
      }
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        if (event.actionId) {
          const action = await this.store.getAction(event.actionId);
          if (action && action.tenantId === event.tenantId && !['completed', 'failed'].includes(action.state)) {
            await this.store.updateAction({ ...action, state: 'reconcile_required' });
            await this.store.addAudit({ id: randomUUID(), tenantId: event.tenantId, actorId: null, eventName: 'workflow.reconcile_required', metadata: { actionId: action.id, eventId: event.eventId }, createdAt: new Date().toISOString() });
          }
        }
        throw new AmbiguousEventDispatchError('n8n dispatch timed out; reconciliation is required.');
      }
      throw error;
    }
  }

  private async actionRoute(event: OutboxEvent): Promise<{ workflowKey: string; webhookPath: string } | null> {
    if (!event.actionId) return null;
    const action = await this.store.getAction(event.actionId);
    if (!action || action.tenantId !== event.tenantId || !['approved', 'processing'].includes(action.state)) return null;
    return { workflowKey: action.workflowKey, webhookPath: action.webhookPath ?? 'lead-capture' };
  }

  private async documentRoute(event: OutboxEvent): Promise<{ workflowKey: string; webhookPath: string } | null> {
    const job = await this.store.getDocumentProcessingJob(event.payloadRef, event.tenantId);
    if (!job || job.tenantId !== event.tenantId || job.status !== 'queued') return null;
    return { workflowKey: job.workflowKey, webhookPath: job.webhookPath };
  }
}

export class EventConsumer {
  constructor(private readonly store: Store, private readonly bus: StreamBus, private readonly bridge: N8nEventBridge, private readonly consumer = `worker-${process.pid}`) {}

  async runOnce(stream: string, group: string, blockMs = 250): Promise<number> {
    await this.bus.ensureGroup(stream, group);
    const messages = [...await this.bus.reclaim(stream, group, this.consumer, 30_000, 10), ...await this.bus.read(stream, group, this.consumer, 10, blockMs)];
    let handled = 0;
    for (const message of messages) {
      try {
        await this.bridge.dispatch(message.event);
        if (await this.store.claimInboxEvent(group, message.event.eventId)) handled += 1;
        await this.bus.acknowledge(stream, group, message.id);
      } catch (error) {
        if (error instanceof AmbiguousEventDispatchError || error instanceof ReconcileRequiredDispatchError) {
          if (message.event.actionId) {
            const action = await this.store.getAction(message.event.actionId);
            if (action && action.tenantId === message.event.tenantId && !['completed', 'failed', 'reconcile_required'].includes(action.state)) {
              await this.store.updateAction({ ...action, state: 'reconcile_required' });
              await this.store.addAudit({ id: randomUUID(), tenantId: action.tenantId, actorId: null, eventName: 'workflow.reconcile_required', metadata: { actionId: action.id, eventId: message.event.eventId, reason: error.message }, createdAt: new Date().toISOString() });
            }
          }
          await this.bus.deadLetter(message.event, error.message);
          await this.bus.acknowledge(stream, group, message.id);
        }
      }
    }
    return handled;
  }
}

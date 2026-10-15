import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ActionRequest, Store } from './types.js';
import { opaqueReference } from './privacy.js';

export interface WorkflowResult { externalReference: string; }
export interface WorkflowAdapter { execute(input: { workflowKey: string; tenantId: string; opaqueReference: string; idempotencyKey: string }): Promise<WorkflowResult>; }

export class HttpN8nWorkflowAdapter implements WorkflowAdapter {
  constructor(private readonly baseUrl: string, private readonly secret: string, private readonly timeoutMs = 5000) {}

  async execute(input: { workflowKey: string; tenantId: string; opaqueReference: string; idempotencyKey: string }): Promise<WorkflowResult> {
    if (!this.baseUrl || !this.secret) throw new Error('Private n8n adapter is not configured.');
    const payload = { ...input, timestamp: Date.now(), nonce: randomUUID() };
    const body = JSON.stringify(payload);
    const signature = signN8nPayload(this.secret, payload.timestamp, payload.nonce, body);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/lead-capture`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentic-timestamp': String(payload.timestamp), 'x-agentic-nonce': payload.nonce, 'x-agentic-signature': signature, 'x-agentic-idempotency-key': input.idempotencyKey }, body, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`Private n8n request failed with status ${response.status}.`);
    const result = await response.json() as { externalReference?: unknown };
    if (typeof result.externalReference !== 'string' || !result.externalReference) throw new Error('Private n8n response was invalid.');
    return { externalReference: result.externalReference };
  }
}

export const signN8nPayload = (secret: string, timestamp: number, nonce: string, body: string): string => createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');

export const verifyN8nPayload = (secret: string, timestamp: string, nonce: string, body: string, signature: string, now = Date.now(), maxAgeMs = 300_000): boolean => {
  const parsedTimestamp = Number(timestamp);
  if (!Number.isFinite(parsedTimestamp) || Math.abs(now - parsedTimestamp) > maxAgeMs || !nonce || !signature) return false;
  const expected = signN8nPayload(secret, parsedTimestamp, nonce, body);
  const provided = Buffer.from(signature, 'utf8');
  const calculated = Buffer.from(expected, 'utf8');
  return provided.length === calculated.length && timingSafeEqual(provided, calculated);
};

export class MockWorkflowAdapter implements WorkflowAdapter {
  public readonly calls: Array<{ workflowKey: string; tenantId: string; opaqueReference: string; idempotencyKey: string }> = [];
  async execute(input: { workflowKey: string; tenantId: string; opaqueReference: string; idempotencyKey: string }): Promise<WorkflowResult> {
    this.calls.push(input);
    return { externalReference: `mock-run-${this.calls.length}` };
  }
}

export class ActionGateway {
  // shortcut: the local API runs one process; replace with a database claim/transaction before multi-instance deployment.
  private readonly confirmations = new Map<string, Promise<ActionRequest>>();

  constructor(private readonly store: Store, private readonly adapter: WorkflowAdapter) {}

  async propose(tenantId: string, sessionId: string, idempotencyKey: string): Promise<ActionRequest> {
    const existing = await this.store.getActionByIdempotency(tenantId, idempotencyKey);
    if (existing) return existing;
    const action: ActionRequest = { id: randomUUID(), tenantId, sessionId, workflowKey: 'lead.capture', idempotencyKey, state: 'awaiting_confirmation', opaqueReference: opaqueReference(), createdAt: new Date().toISOString(), result: null };
    return this.store.createAction(action);
  }

  async confirm(actionId: string, tenantId: string): Promise<ActionRequest> {
    const key = `${tenantId}:${actionId}`;
    const pending = this.confirmations.get(key);
    if (pending) return pending;
    const confirmation = this.confirmInternal(actionId, tenantId);
    this.confirmations.set(key, confirmation);
    try { return await confirmation; } finally { this.confirmations.delete(key); }
  }

  private async confirmInternal(actionId: string, tenantId: string): Promise<ActionRequest> {
    const action = await this.store.getAction(actionId);
    if (!action || action.tenantId !== tenantId) throw new Error('Action not found.');
    if (action.state === 'completed') return action;
    if (action.state !== 'awaiting_confirmation') throw new Error('Action is not confirmable.');
    if (!Number.isFinite(Date.parse(action.createdAt)) || Date.now() - Date.parse(action.createdAt) > 15 * 60_000) {
      const expired = { ...action, state: 'failed' as const };
      await this.store.updateAction(expired);
      await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'workflow.expired', metadata: { actionId }, createdAt: new Date().toISOString() });
      return expired;
    }
    try {
      const result = await this.adapter.execute({ workflowKey: action.workflowKey, tenantId, opaqueReference: action.opaqueReference, idempotencyKey: action.idempotencyKey });
      const updated = { ...action, state: 'completed' as const, result };
      await this.store.updateAction(updated);
      await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'workflow.completed', metadata: { actionId, workflowKey: action.workflowKey }, createdAt: new Date().toISOString() });
      return updated;
    } catch (error) {
      const unknown = { ...action, state: 'unknown' as const };
      await this.store.updateAction(unknown);
      await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'workflow.unknown', metadata: { actionId, workflowKey: action.workflowKey, reason: error instanceof Error ? error.message.slice(0, 160) : 'adapter_error' }, createdAt: new Date().toISOString() });
      return unknown;
    }
  }
}

import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ActionRequest, LeadConversationMessage, LeadData, Store } from './types.js';
import { opaqueReference } from './privacy.js';
import { assertExternalEndpoint } from './runtime-security.js';

export interface WorkflowResult { externalReference: string; }
export type LeadQuality = 'new' | 'nurture' | 'warm' | 'hot';
export interface LeadWorkflowContext { actionId: string; intent: string; score: number; quality: LeadQuality; validationPass: boolean; conversation: LeadConversationMessage[]; }
export interface WorkflowAdapter { execute(input: { workflowKey: string; tenantId: string; sessionId: string; opaqueReference: string; idempotencyKey: string; leadData?: LeadData; leadContext?: LeadWorkflowContext }): Promise<WorkflowResult>; }

export const leadValidationPass = (leadData: LeadData): boolean => Boolean(leadData.name && (leadData.email || leadData.phone));
export const leadScore = (leadData: LeadData): number => (leadData.name ? 30 : 0) + (leadData.email ? 40 : 0) + (leadData.phone ? 30 : 0);
export const leadQuality = (score: number): LeadQuality => score >= 90 ? 'hot' : score >= 70 ? 'warm' : score >= 40 ? 'nurture' : 'new';

export const isSafeExternalReference = (value: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value);

export class HttpN8nWorkflowAdapter implements WorkflowAdapter {
  constructor(private readonly baseUrl: string, private readonly secret: string, private readonly timeoutMs = 5000) { assertExternalEndpoint(baseUrl, 'n8n'); }

  async execute(input: { workflowKey: string; tenantId: string; sessionId: string; opaqueReference: string; idempotencyKey: string; leadData?: LeadData; leadContext?: LeadWorkflowContext }): Promise<WorkflowResult> {
    if (!this.baseUrl || !this.secret) throw new Error('Private n8n adapter is not configured.');
    const payload = { ...input, ...input.leadContext, leadData: input.leadData ?? {}, timestamp: Date.now(), nonce: randomUUID() };
    const body = JSON.stringify(payload);
    const signature = signN8nPayload(this.secret, payload.timestamp, payload.nonce, body);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/webhook/lead-capture`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentic-timestamp': String(payload.timestamp), 'x-agentic-nonce': payload.nonce, 'x-agentic-signature': signature, 'x-agentic-idempotency-key': input.idempotencyKey }, body, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`Private n8n request failed with status ${response.status}.`);
    const result = await response.json() as { externalReference?: unknown };
    if (typeof result.externalReference !== 'string' || !isSafeExternalReference(result.externalReference)) throw new Error('Private n8n response was invalid.');
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

const isUniqueViolation = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';

export class MockWorkflowAdapter implements WorkflowAdapter {
  public readonly calls: Array<{ workflowKey: string; tenantId: string; sessionId: string; opaqueReference: string; idempotencyKey: string; leadData?: LeadData; leadContext?: LeadWorkflowContext }> = [];
  async execute(input: { workflowKey: string; tenantId: string; sessionId: string; opaqueReference: string; idempotencyKey: string; leadData?: LeadData; leadContext?: LeadWorkflowContext }): Promise<WorkflowResult> {
    this.calls.push(input);
    return { externalReference: `mock-run-${this.calls.length}` };
  }
}

export class ActionGateway {
  // shortcut: the local API runs one process; replace with a database claim/transaction before multi-instance deployment.
  private readonly confirmations = new Map<string, Promise<ActionRequest>>();
  private readonly proposals = new Map<string, Promise<ActionRequest>>();

  constructor(private readonly store: Store, private readonly adapter: WorkflowAdapter) {}

  async propose(tenantId: string, sessionId: string, idempotencyKey: string, leadData: LeadData = {}): Promise<ActionRequest> {
    const key = `${tenantId}:${idempotencyKey}`;
    const pending = this.proposals.get(key);
    if (pending) return pending;
    const proposal = this.proposeInternal(tenantId, sessionId, idempotencyKey, leadData);
    this.proposals.set(key, proposal);
    try { return await proposal; } finally { this.proposals.delete(key); }
  }

  private async proposeInternal(tenantId: string, sessionId: string, idempotencyKey: string, leadData: LeadData): Promise<ActionRequest> {
    const existing = await this.store.getActionByIdempotency(tenantId, idempotencyKey);
    if (existing) return existing;
    const action: ActionRequest = { id: randomUUID(), tenantId, sessionId, workflowKey: 'lead.capture', idempotencyKey, state: 'awaiting_confirmation', opaqueReference: opaqueReference(), payload: leadData, createdAt: new Date().toISOString(), result: null };
    try { return await this.store.createAction(action); } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.store.getActionByIdempotency(tenantId, idempotencyKey);
      if (raced) return raced;
      throw error;
    }
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
    if (action.state !== 'awaiting_confirmation' && action.state !== 'unknown') throw new Error('Action is not confirmable.');
    if (!Number.isFinite(Date.parse(action.createdAt)) || Date.now() - Date.parse(action.createdAt) > 15 * 60_000) {
      const expired = { ...action, state: 'failed' as const };
      await this.store.updateAction(expired);
      await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'workflow.expired', metadata: { actionId }, createdAt: new Date().toISOString() });
      return expired;
    }
    try {
      const messages = await this.store.listMessages(action.sessionId, tenantId);
      const score = leadScore(action.payload);
      const leadContext: LeadWorkflowContext = { actionId: action.id, intent: action.workflowKey, score, quality: leadQuality(score), validationPass: leadValidationPass(action.payload), conversation: messages.map((message) => ({ role: message.role, content: message.maskedContent, createdAt: message.createdAt })) };
      const result = await this.adapter.execute({ workflowKey: action.workflowKey, tenantId, sessionId: action.sessionId, opaqueReference: action.opaqueReference, idempotencyKey: action.idempotencyKey, leadData: action.payload, leadContext });
      const updated = { ...action, state: 'completed' as const, result };
      await this.store.updateAction(updated);
      await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'workflow.completed', metadata: { actionId, workflowKey: action.workflowKey }, createdAt: new Date().toISOString() });
      return updated;
    } catch {
      const unknown = { ...action, state: 'unknown' as const };
      await this.store.updateAction(unknown);
      await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'workflow.unknown', metadata: { actionId, workflowKey: action.workflowKey, reason: 'adapter_error' }, createdAt: new Date().toISOString() });
      return unknown;
    }
  }
}

import { randomUUID } from 'node:crypto';
import type { ActionRequest, Store } from './types.js';
import { opaqueReference } from './privacy.js';

export interface WorkflowResult { externalReference: string; }
export interface WorkflowAdapter { execute(input: { workflowKey: string; tenantId: string; opaqueReference: string; idempotencyKey: string }): Promise<WorkflowResult>; }

export class MockWorkflowAdapter implements WorkflowAdapter {
  public readonly calls: Array<{ workflowKey: string; tenantId: string; opaqueReference: string; idempotencyKey: string }> = [];
  async execute(input: { workflowKey: string; tenantId: string; opaqueReference: string; idempotencyKey: string }): Promise<WorkflowResult> {
    this.calls.push(input);
    return { externalReference: `mock-run-${this.calls.length}` };
  }
}

export class ActionGateway {
  constructor(private readonly store: Store, private readonly adapter: WorkflowAdapter) {}

  async propose(tenantId: string, sessionId: string, idempotencyKey: string): Promise<ActionRequest> {
    const existing = await this.store.getActionByIdempotency(tenantId, idempotencyKey);
    if (existing) return existing;
    const action: ActionRequest = { id: randomUUID(), tenantId, sessionId, workflowKey: 'lead.capture', idempotencyKey, state: 'awaiting_confirmation', opaqueReference: opaqueReference(), createdAt: new Date().toISOString(), result: null };
    return this.store.createAction(action);
  }

  async confirm(actionId: string, tenantId: string): Promise<ActionRequest> {
    const action = await this.store.getAction(actionId);
    if (!action || action.tenantId !== tenantId) throw new Error('Action not found.');
    if (action.state === 'completed') return action;
    if (action.state !== 'awaiting_confirmation') throw new Error('Action is not confirmable.');
    const result = await this.adapter.execute({ workflowKey: action.workflowKey, tenantId, opaqueReference: action.opaqueReference, idempotencyKey: action.idempotencyKey });
    const updated = { ...action, state: 'completed' as const, result };
    await this.store.updateAction(updated);
    await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'workflow.completed', metadata: { actionId, workflowKey: action.workflowKey }, createdAt: new Date().toISOString() });
    return updated;
  }
}

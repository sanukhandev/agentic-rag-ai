import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ActionGateway } from './actions.js';
import type { ActionRequest, Store } from './types.js';
import type { CatalogV2Document } from './catalog-v2.js';

const key = z.string().trim().regex(/^[a-z][a-z0-9._-]{1,79}$/u);
const scalar = z.union([z.string().trim().min(1).max(500), z.number().finite(), z.boolean()]);
const actionArguments = z.record(key, scalar).superRefine((value, ctx) => {
  if (Object.keys(value).length > 32) ctx.addIssue({ code: 'custom', message: 'Too many action arguments.' });
});

/** Model output for a proposal. Identity, revision and consent scope stay Node-owned. */
export const v2ActionProposalSchema = z.object({
  schemaVersion: z.literal(2),
  toolKey: key,
  goalKey: key,
  stageKey: key,
  actionRevision: z.number().int().positive(),
  arguments: actionArguments,
}).strict();

export type V2ActionProposal = z.infer<typeof v2ActionProposalSchema>;

export interface V2ActionGateContext {
  tenantId: string;
  sessionId: string;
  opportunityId: string;
  catalogVersionId: string;
  currentStageKey: string;
  confirmedGoalKey: string | null;
  goalConfirmed: boolean;
  verifiedRequirementKeys: string[];
  expectedActionRevision: number;
  purposeConsentScope: string | null;
  purposeConsentGranted: boolean;
}

export interface V2ActionConfirmationContext extends V2ActionGateContext {
  pendingActionId: string | null;
  expectedActionKey: string;
  customerConfirmed: boolean;
}

export interface V2ActionGateDecision {
  accepted: boolean;
  status: 'eligible' | 'created' | 'existing' | 'confirmed' | 'denied';
  reasons: string[];
  action: ActionRequest | null;
  toolKey: string | null;
  actionKey: string | null;
  actionRevision: number | null;
}

export interface V2ActionProposalDependencies {
  gateway: Pick<ActionGateway, 'propose'>;
  store: Pick<Store, 'getActionByIdentity'>;
}

const denied = (reasons: string[], action: ActionRequest | null = null): V2ActionGateDecision => ({
  accepted: false,
  status: 'denied',
  reasons,
  action,
  toolKey: null,
  actionKey: null,
  actionRevision: null,
});

const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');
const consentScope = (catalogVersionId: string, toolKey: string): string => `${catalogVersionId}:${toolKey}`;

export const v2ActionConsentScope = (context: Pick<V2ActionGateContext, 'catalogVersionId'>, toolKey: string): string => consentScope(context.catalogVersionId, toolKey);

const bindingFor = (catalog: CatalogV2Document, proposal: V2ActionProposal) => catalog.sheets.ToolBindings.find((binding) => binding.toolKey === proposal.toolKey);

const validateProposal = (proposalInput: unknown, catalog: CatalogV2Document, context: V2ActionGateContext): { proposal: V2ActionProposal; binding: NonNullable<ReturnType<typeof bindingFor>> } | V2ActionGateDecision => {
  const parsed = v2ActionProposalSchema.safeParse(proposalInput);
  if (!parsed.success) return denied(['invalid_proposal']);
  const proposal = parsed.data;
  const binding = bindingFor(catalog, proposal);
  if (!binding) return denied(['tool_not_declared']);
  if (!binding.enabled) return denied(['tool_inactive']);
  if (binding.sideEffectClass === 'read_only') return denied(['tool_not_side_effectful']);
  if (!binding.registryKey || binding.consent !== 'purpose_specific' || binding.confirmation !== 'explicit_customer') return denied(['action_policy_incomplete']);
  if (!catalog.sheets.WorkflowBindings.some((workflow) => workflow.registryKey === binding.registryKey && workflow.enabled)) return denied(['workflow_unavailable']);
  if (!context.opportunityId) return denied(['opportunity_required']);
  if (!context.goalConfirmed) return denied(['goal_not_confirmed']);
  if (context.confirmedGoalKey !== proposal.goalKey || binding.goalKey !== proposal.goalKey) return denied(['goal_mismatch']);
  if (context.currentStageKey !== proposal.stageKey || binding.stageKey !== proposal.stageKey) return denied(['stage_mismatch']);
  if (proposal.actionRevision !== context.expectedActionRevision) return denied(['action_revision_stale']);
  const missing = binding.requiredKeys.filter((requiredKey) => !context.verifiedRequirementKeys.includes(requiredKey));
  if (missing.length) return denied(['requirements_missing']);
  if (!context.purposeConsentGranted || context.purposeConsentScope !== consentScope(context.catalogVersionId, proposal.toolKey)) return denied(['purpose_consent_required']);
  if (Object.keys(proposal.arguments).some((argumentKey) => !binding.requiredKeys.includes(argumentKey))) return denied(['arguments_not_catalog_scoped']);
  return { proposal, binding };
};

const baseDecision = (proposal: V2ActionProposal, status: V2ActionGateDecision['status'], action: ActionRequest | null = null): V2ActionGateDecision => ({
  accepted: true,
  status,
  reasons: [],
  action,
  toolKey: proposal.toolKey,
  actionKey: proposal.toolKey,
  actionRevision: proposal.actionRevision,
});

export const validateV2ActionProposal = (proposalInput: unknown, catalog: CatalogV2Document, context: V2ActionGateContext): V2ActionGateDecision => {
  const result = validateProposal(proposalInput, catalog, context);
  if ('accepted' in result) return result;
  return baseDecision(result.proposal, 'eligible');
};

export const proposeV2CatalogAction = async (proposalInput: unknown, catalog: CatalogV2Document, context: V2ActionGateContext, dependencies: V2ActionProposalDependencies): Promise<V2ActionGateDecision> => {
  const result = validateProposal(proposalInput, catalog, context);
  if ('accepted' in result) return result;
  const { proposal, binding } = result;
  const idempotencyKey = `v2-${digest(`${context.tenantId}:${context.sessionId}:${context.opportunityId}:${proposal.toolKey}:${proposal.actionRevision}`).slice(0, 48)}`;
  const existing = await dependencies.store.getActionByIdentity({ tenantId: context.tenantId, opportunityId: context.opportunityId, actionKey: proposal.toolKey, actionRevision: proposal.actionRevision });
  if (existing) return baseDecision(proposal, 'existing', existing);
  const action = await dependencies.gateway.propose(context.tenantId, context.sessionId, idempotencyKey, {
    interest: proposal.goalKey,
    slotValues: Object.fromEntries(Object.entries(proposal.arguments).map(([name, value]) => [name, String(value)])),
    contactConsent: true,
  }, {
    workflowKey: binding.registryKey!,
    intentKey: proposal.goalKey,
    catalogVersionId: context.catalogVersionId,
    opportunityId: context.opportunityId,
    actionKey: proposal.toolKey,
    actionRevision: proposal.actionRevision,
  });
  const status = action.state === 'awaiting_confirmation' ? 'created' : 'existing';
  return baseDecision(proposal, status, action);
};

export const validateV2ActionConfirmation = (action: ActionRequest, context: V2ActionConfirmationContext): V2ActionGateDecision => {
  if (!context.customerConfirmed) return denied(['customer_confirmation_required'], action);
  if (!context.pendingActionId || context.pendingActionId !== action.id) return denied(['confirmation_not_pending'], action);
  if (action.tenantId !== context.tenantId) return denied(['tenant_mismatch'], action);
  if (action.sessionId !== context.sessionId) return denied(['session_mismatch'], action);
  if (action.opportunityId !== context.opportunityId) return denied(['opportunity_mismatch'], action);
  if (action.catalogVersionId !== context.catalogVersionId) return denied(['catalog_revision_mismatch'], action);
  if (action.actionKey !== context.expectedActionKey) return denied(['action_identity_mismatch'], action);
  if (action.actionRevision !== context.expectedActionRevision) return denied(['action_revision_stale'], action);
  if (!['awaiting_confirmation', 'unknown'].includes(action.state)) return denied(['action_not_confirmable'], action);
  if (!context.purposeConsentGranted || action.payload.contactConsent !== true) return denied(['purpose_consent_required'], action);
  return { ...baseDecision({ schemaVersion: 2, toolKey: action.actionKey ?? action.intentKey ?? action.workflowKey, goalKey: action.intentKey ?? action.workflowKey, stageKey: context.currentStageKey, actionRevision: action.actionRevision ?? context.expectedActionRevision, arguments: {} }, 'confirmed', action), accepted: true };
};

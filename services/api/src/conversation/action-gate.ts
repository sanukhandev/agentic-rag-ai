import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ActionGateway } from '../actions.js';
import type { ActionRequest, Store, IntentCatalogV2Version, LifecycleState, UserIntentDocument } from '../types.js';
import { catalogV2VersionRef, type CatalogV2Document } from './catalog.js';

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
  /** Persisted, server-loaded state; never populate from model output. */
  intentDocument?: UserIntentDocument;
  pinnedCatalogVersion?: IntentCatalogV2Version;
  lifecycle?: LifecycleState;
  expectedStageRevision?: number;
  expectedLifecycleRevision?: number;
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
  const boundary = evaluateV2StageBoundary(context);
  if (!boundary.accepted) return denied(boundary.reasons);
  if (context.pinnedCatalogVersion?.catalogVersionRef !== catalogV2VersionRef(catalog)) return denied(['catalog_content_mismatch']);
  if (!context.goalConfirmed) return denied(['goal_not_confirmed']);
  if (context.confirmedGoalKey !== proposal.goalKey || binding.goalKey !== proposal.goalKey) return denied(['goal_mismatch']);
  if (context.currentStageKey !== proposal.stageKey || binding.stageKey !== proposal.stageKey) return denied(['stage_mismatch']);
  if (proposal.actionRevision !== context.expectedActionRevision) return denied(['action_revision_stale']);
  const requiredPolicies = context.pinnedCatalogVersion?.catalog.sheets.RequirementPolicies ?? [];
  const missing = binding.requiredKeys.filter((requiredKey) => {
    const policy = requiredPolicies.find(row => row.goalKey === proposal.goalKey && row.stageKey === proposal.stageKey && row.requirementKey === requiredKey);
    // Confirmation is a separate customer step. A proposal must be allowed to
    // exist before that confirmation is recorded.
    if (policy?.type === 'confirmation') return false;
    if (!context.verifiedRequirementKeys.includes(requiredKey)) return true;
    if (!policy) return true;
    if (policy.type !== 'fact') return false;
    const fact = context.intentDocument?.verifiedFacts?.[requiredKey];
    return !fact || !fact.maskedValue.trim() || fact.evidenceRefs.length === 0
      || fact.evidenceRefs.some(ref => !ref.trim()) || !['visitor', 'node', 'provider'].includes(fact.source);
  });
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
  const slots = Object.fromEntries(Object.entries(proposal.arguments).sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => [name, String(value)]));
  if (existing) {
    const priorSlots = Object.fromEntries(Object.entries(existing.payload.slotValues ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    const same = existing.tenantId === context.tenantId && existing.sessionId === context.sessionId
      && existing.opportunityId === context.opportunityId && existing.catalogVersionId === context.catalogVersionId
      && existing.workflowKey === binding.registryKey && existing.actionKey === proposal.toolKey
      && existing.actionRevision === proposal.actionRevision && existing.idempotencyKey === idempotencyKey
      && existing.payload.interest === proposal.goalKey && existing.payload.contactConsent === true
      && JSON.stringify(priorSlots) === JSON.stringify(slots);
    if (!same) return denied(['action_payload_conflict'], existing);
    if (existing.state === 'reconcile_required' || existing.state === 'failed') return denied(['action_reconciliation_required'], existing);
    return baseDecision(proposal, 'existing', existing);
  }
  const action = await dependencies.gateway.propose(context.tenantId, context.sessionId, idempotencyKey, {
    interest: proposal.goalKey,
    slotValues: slots,
    contactConsent: true,
  }, {
    workflowKey: binding.registryKey!,
    intentKey: proposal.goalKey,
    catalogVersionId: context.catalogVersionId,
    opportunityId: context.opportunityId,
    actionKey: proposal.toolKey,
    actionRevision: proposal.actionRevision,
  });
  const returnedSlots = Object.fromEntries(Object.entries(action.payload.slotValues ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  if (action.tenantId !== context.tenantId || action.sessionId !== context.sessionId
    || action.opportunityId !== context.opportunityId || action.catalogVersionId !== context.catalogVersionId
    || action.actionKey !== proposal.toolKey || action.actionRevision !== proposal.actionRevision
    || action.workflowKey !== binding.registryKey || action.idempotencyKey !== idempotencyKey
    || action.payload.interest !== proposal.goalKey || action.payload.contactConsent !== true
    || JSON.stringify(returnedSlots) !== JSON.stringify(slots)) return denied(['action_payload_conflict'], action);
  if (['failed', 'reconcile_required'].includes(action.state)) return denied(['action_reconciliation_required'], action);
  const status = action.state === 'awaiting_confirmation' ? 'created' : 'existing';
  return baseDecision(proposal, status, action);
};

export const validateV2ActionConfirmation = (action: ActionRequest, context: V2ActionConfirmationContext): V2ActionGateDecision => {
  const boundary = evaluateV2StageBoundary(context);
  if (!boundary.accepted) return denied(boundary.reasons, action);
  if (!context.customerConfirmed) return denied(['customer_confirmation_required'], action);
  if (!context.pendingActionId || context.pendingActionId !== action.id) return denied(['confirmation_not_pending'], action);
  if (action.tenantId !== context.tenantId) return denied(['tenant_mismatch'], action);
  if (action.sessionId !== context.sessionId) return denied(['session_mismatch'], action);
  if (action.opportunityId !== context.opportunityId) return denied(['opportunity_mismatch'], action);
  if (action.catalogVersionId !== context.catalogVersionId) return denied(['catalog_revision_mismatch'], action);
  if (action.actionKey !== context.expectedActionKey) return denied(['action_identity_mismatch'], action);
  if (action.actionRevision !== context.expectedActionRevision) return denied(['action_revision_stale'], action);
  if (action.state !== 'awaiting_confirmation') return denied(['action_not_confirmable'], action);
  if (!context.purposeConsentGranted || context.purposeConsentScope !== consentScope(context.catalogVersionId, context.expectedActionKey) || action.payload.contactConsent !== true) return denied(['purpose_consent_required'], action);
  if (action.intentKey !== context.confirmedGoalKey) return denied(['goal_mismatch'], action);
  return { ...baseDecision({ schemaVersion: 2, toolKey: action.actionKey ?? action.intentKey ?? action.workflowKey, goalKey: action.intentKey ?? action.workflowKey, stageKey: context.currentStageKey, actionRevision: action.actionRevision ?? context.expectedActionRevision, arguments: {} }, 'confirmed', action), accepted: true };
};


/**
 * Seven-stage ANCFZ policy boundary. All input records must be loaded from
 * authenticated, tenant-scoped Node repositories. This function does not
 * persist state, dispatch actions, or trust model-generated assessments.
 */
export const V2_SEVEN_STAGE_KEYS = [
  'lead_generation', 'lead_qualification', 'account_creation', 'package_selection',
  'document_upload', 'payment_invoice', 'contract',
] as const;
export type V2SevenStageKey = typeof V2_SEVEN_STAGE_KEYS[number];

const lifecycleKey = (stageKey: string): keyof LifecycleState['stages'] | null =>
  stageKey === 'payment_invoice' ? 'billing_invoice'
    : V2_SEVEN_STAGE_KEYS.includes(stageKey as V2SevenStageKey) ? stageKey as keyof LifecycleState['stages'] : null;

export type V2StageBoundaryDecision = {
  accepted: boolean;
  reasons: string[];
  currentStageKey: V2SevenStageKey | null;
};

const boundaryDenied = (...reasons: string[]): V2StageBoundaryDecision =>
  ({ accepted: false, reasons, currentStageKey: null });

export const evaluateV2StageBoundary = (context: V2ActionGateContext): V2StageBoundaryDecision => {
  const { intentDocument: doc, pinnedCatalogVersion: version, lifecycle } = context;
  if (!context.tenantId || !context.sessionId || !context.opportunityId) return boundaryDenied('unauthenticated_scope');
  if (!doc || !version || !lifecycle) return boundaryDenied('authoritative_state_required');
  if (doc.tenantId !== context.tenantId || doc.sessionId !== context.sessionId || doc.opportunityId !== context.opportunityId
    || version.tenantId !== context.tenantId) return boundaryDenied('persisted_identity_mismatch');
  if (doc.catalogSource !== 'v2' || version.status !== 'published' || version.catalogVersionRef !== doc.catalogVersionRef
    || version.catalogVersionRef !== context.catalogVersionId || catalogV2VersionRef(version.catalog) !== version.catalogVersionRef) return boundaryDenied('catalog_not_published_or_pinned');
  if (!doc.goalConfirmed || !context.goalConfirmed) return boundaryDenied('goal_not_confirmed');
  if (!doc.businessGoalKey || doc.businessGoalKey !== context.confirmedGoalKey) return boundaryDenied('goal_mismatch');
  const goal = version.catalog.sheets.BusinessGoals.find(candidate => candidate.businessGoalKey === doc.businessGoalKey && candidate.active);
  if (!goal || (goal.confirmationRequired && !doc.goalConfirmed)) return boundaryDenied('business_goal_inactive_or_unconfirmed');
  const stages = version.catalog.sheets.BusinessStages.filter(stage => stage.businessGoalKey === doc.businessGoalKey && stage.active)
    .sort((a, b) => a.stageOrder - b.stageOrder);
  if (stages.length !== V2_SEVEN_STAGE_KEYS.length || stages.some((stage, index) => stage.stageOrder !== index + 1 || stage.stageKey !== V2_SEVEN_STAGE_KEYS[index]))
    return boundaryDenied('seven_stage_catalog_invalid');
  const stageIndex = stages.findIndex(stage => stage.stageKey === doc.currentStageKey);
  if (stageIndex < 0 || doc.currentStageKey !== context.currentStageKey) return boundaryDenied('stage_mismatch');
  const stageKey = stages[stageIndex]!.stageKey as V2SevenStageKey;
  const lifeKey = lifecycleKey(stageKey);
  if (!lifeKey || lifeKey !== lifecycle.currentStage) return boundaryDenied('lifecycle_stage_mismatch');
  if (!Number.isInteger(context.expectedStageRevision) || doc.stageRevision !== context.expectedStageRevision
    || !Number.isInteger(context.expectedLifecycleRevision) || lifecycle.revision !== context.expectedLifecycleRevision
    || lifecycle.stages[lifeKey].revision !== context.expectedStageRevision) return boundaryDenied('stage_revision_stale');
  for (const previous of stages.slice(0, stageIndex)) {
    const key = lifecycleKey(previous.stageKey);
    const item = key && lifecycle.stages[key];
    if (!item || item.status !== 'completed' || !item.completedAt || !Number.isFinite(Date.parse(item.completedAt)))
      return boundaryDenied('prior_stage_incomplete');
    const reason = validateV2StoredStageEvidence(context, previous.stageKey as V2SevenStageKey, item.revision, item.evidence);
    if (reason) return boundaryDenied(reason);
  }
  return { accepted: true, reasons: [], currentStageKey: stageKey };
};

export interface V2StageCompletionEvidence {
  tenantId: string;
  sessionId: string;
  opportunityId: string;
  catalogVersionRef: string;
  stageKey: V2SevenStageKey;
  stageRevision: number;
  evidenceRef: string;
  evidenceTier: 'node_verified' | 'provider_record_verified' | 'mock_verified';
  operationStatus: 'completed';
  leadId?: string;
  qualificationStatus?: 'qualified';
  accountLinkedLeadId?: string;
  accountConfirmation?: boolean;
  packagePublished?: boolean;
  packageEligible?: boolean;
  sf02Verified?: boolean;
  leadAttachmentVerified?: boolean;
  accountAttachmentVerified?: boolean;
  invoiceIssued?: boolean;
  paymentCompleted?: boolean;
  contractSigned?: boolean;
  contractAttachmentRequired?: boolean;
  contractAttachmentVerified?: boolean;
  signedArtifactSha256?: string;
}

const validateV2StoredStageEvidence = (
  context: Pick<V2ActionGateContext, 'tenantId' | 'sessionId' | 'opportunityId' | 'catalogVersionId'>,
  stageKey: V2SevenStageKey,
  stageRevision: number,
  evidence: Record<string, string | number | boolean>,
): string | null => {
  if (!evidence || evidence.tenantId !== context.tenantId || evidence.sessionId !== context.sessionId
    || evidence.opportunityId !== context.opportunityId || evidence.catalogVersionRef !== context.catalogVersionId
    || evidence.stageKey !== stageKey || evidence.stageRevision !== stageRevision) return 'stage_evidence_scope_mismatch';
  if (typeof evidence.evidenceRef !== 'string' || !evidence.evidenceRef.trim() || evidence.operationStatus !== 'completed')
    return 'stage_completion_unverified';
  // Mock readbacks are test/sandbox-only. The production lifecycle must never
  // transition on a deterministic mock attestation even if it was persisted.
  if (process.env.NODE_ENV === 'production' && evidence.evidenceTier === 'mock_verified') {
    return 'mock_evidence_forbidden_in_production';
  }
  if (stageKey === 'lead_qualification') {
    if (evidence.evidenceTier !== 'node_verified' || evidence.qualificationStatus !== 'qualified'
      || typeof evidence.leadId !== 'string' || !evidence.leadId) return 'qualification_not_verified';
  } else if (!['provider_record_verified', 'mock_verified'].includes(String(evidence.evidenceTier))) {
    return 'provider_completion_unverified';
  }
  if (stageKey === 'lead_generation' && (typeof evidence.leadId !== 'string' || !evidence.leadId)) return 'lead_record_unverified';
  if (stageKey === 'account_creation' && (evidence.accountConfirmation !== true || !evidence.leadId
    || evidence.accountLinkedLeadId !== evidence.leadId)) return 'account_lead_link_unverified';
  if (stageKey === 'package_selection' && (evidence.packagePublished !== true || evidence.packageEligible !== true))
    return 'package_eligibility_unverified';
  if (stageKey === 'document_upload' && (evidence.sf02Verified !== true || evidence.leadAttachmentVerified !== true
    || evidence.accountAttachmentVerified !== true)) return 'sf02_attachments_unverified';
  if (stageKey === 'payment_invoice' && (evidence.invoiceIssued !== true || evidence.paymentCompleted !== true))
    return 'invoice_or_payment_incomplete';
  if (stageKey === 'contract' && evidence.contractAttachmentRequired === true && evidence.contractAttachmentVerified !== true) return 'contract_attachment_unverified';
  if (stageKey === 'contract' && (evidence.contractSigned !== true
    || typeof evidence.signedArtifactSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(evidence.signedArtifactSha256)))
    return 'contract_signature_unverified';
  return null;
};

export interface V2StageTransitionInput {
  context: V2ActionGateContext;
  completion: V2StageCompletionEvidence;
  nextStageKey: V2SevenStageKey | null;
}

export type V2StageTransitionDecision = {
  accepted: boolean;
  status: 'completed' | 'denied';
  reasons: string[];
  nextStageKey: V2SevenStageKey | null;
  expectedLifecycleRevision: number | null;
};

/**
 * Produces a CAS-ready transition decision; the integration owner must commit
 * the lifecycle transition and its evidence atomically at the expected revision.
 * Does not confuse dispatch, transport receipt, HTTP 200, or model scores with
 * verified completion. Company legal registration is a separate process.
 */
export const evaluateV2StageTransition = (input: V2StageTransitionInput): V2StageTransitionDecision => {
  const boundary = evaluateV2StageBoundary(input.context);
  const failure = (reason: string): V2StageTransitionDecision =>
    ({ accepted: false, status: 'denied', reasons: [reason], nextStageKey: null, expectedLifecycleRevision: null });
  if (!boundary.accepted || !boundary.currentStageKey) return failure(boundary.reasons[0] ?? 'stage_not_eligible');
  const index = V2_SEVEN_STAGE_KEYS.indexOf(boundary.currentStageKey);
  const expectedNext = V2_SEVEN_STAGE_KEYS[index + 1] ?? null;
  if (input.nextStageKey !== expectedNext) return failure('stage_transition_out_of_order');
  const proof = input.completion;
  if (!proof || proof.stageKey !== boundary.currentStageKey) return failure('completion_stage_mismatch');
  const reason = validateV2StoredStageEvidence(input.context, proof.stageKey, input.context.expectedStageRevision!, proof as unknown as Record<string, string | number | boolean>);
  if (reason) return failure(reason);
  if (proof.stageKey === 'account_creation') {
    const qualification = input.context.lifecycle?.stages.lead_qualification.evidence;
    if (!qualification || proof.leadId !== qualification.leadId) return failure('qualified_lead_mismatch');
  }
  return { accepted: true, status: 'completed', reasons: [], nextStageKey: expectedNext, expectedLifecycleRevision: input.context.expectedLifecycleRevision! };
};


/** Readiness is a projection of canonical action and provider state, not another state machine. */
export type V2ActionReadiness =
  | 'eligible' | 'proposed' | 'awaiting_confirmation' | 'approved' | 'dispatched'
  | 'pending_provider' | 'completed' | 'failed' | 'reconcile_required';

export const deriveV2ActionReadiness = (input: {
  action: ActionRequest | null;
  proposalPresent?: boolean;
  providerStatus?: string | null;
  providerCompletionVerified?: boolean;
}): V2ActionReadiness => {
  if (!input.action) return input.proposalPresent ? 'proposed' : 'eligible';
  const { action } = input;
  if (action.state === 'reconcile_required' || action.state === 'unknown' || action.state === 'human_review') return 'reconcile_required';
  if (action.state === 'failed') return 'failed';
  if (action.state === 'awaiting_confirmation' || action.state === 'awaiting_customer') return 'awaiting_confirmation';
  if (action.state === 'approved') return 'approved';
  if (action.state === 'processing') return ['accepted', 'processing', 'pending'].includes(input.providerStatus ?? '') ? 'pending_provider' : 'dispatched';
  if (action.state === 'completed') return input.providerCompletionVerified === true ? 'completed' : 'reconcile_required';
  return 'reconcile_required';
};

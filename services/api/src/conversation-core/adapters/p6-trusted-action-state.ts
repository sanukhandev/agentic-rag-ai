import { catalogV2VersionRef } from '../../conversation/catalog.js';
import { contextForConfirmedV2Action, evaluateConfirmedV2ActionStage } from '../../conversation/journey-bootstrap.js';
import type { Store, ActionRequest } from '../../types.js';
import type { SessionSnapshot, TrustedActor } from '../contracts.js';
import type { SessionAuthorizer } from './session-authorizer.js';
import type { P5ActionStateReader, P5TrustedActionState } from './p5-proposal-validator.js';

type ActionStateStore = Pick<Store, 'getSession' | 'getUserIntentDocument' | 'getIntentCatalogV2Version'
  | 'getTenant' | 'listActionsBySession'>;
const CONFIRMED_STATES = new Set<ActionRequest['state']>(['approved', 'processing', 'completed']);

/**
 * P6 reuses the canonical V2 intent/journey gate. No simulated consent,
 * keyword-derived confirmation, model-provided identity or external writes.
 *
 * Without an already authorized action matching the pinned goal/stage/tenant,
 * customerAuthorized is false. The model may still discuss next steps.
 */
export class P6TrustedActionStateReader implements P5ActionStateReader {
  constructor(private readonly store: ActionStateStore, private readonly authorizer: SessionAuthorizer) {}

  async load(actor: TrustedActor, snapshot: SessionSnapshot): Promise<P5TrustedActionState | null> {
    if (actor.role !== 'customer' || actor.tenantId !== snapshot.tenantId
      || actor.sessionId !== snapshot.sessionId || actor.principalId !== snapshot.ownerPrincipalId) return null;
    const [tenant, session, doc, catalog, actions] = await Promise.all([
      this.store.getTenant(actor.tenantId),
      this.store.getSession(actor.sessionId),
      this.store.getUserIntentDocument(actor.tenantId, actor.sessionId),
      this.store.getIntentCatalogV2Version(actor.tenantId, snapshot.catalogVersionId),
      this.store.listActionsBySession(actor.sessionId, actor.tenantId),
    ]);
    if (!tenant || !session || !doc || !catalog || session.tenantId !== actor.tenantId
      || tenant.status !== 'active' || session.closedAt !== null
      || session.stateVersion !== snapshot.revision
      || doc.tenantId !== actor.tenantId || doc.sessionId !== actor.sessionId
      || catalog.id !== snapshot.catalogVersionId || catalog.tenantId !== actor.tenantId
      || catalog.status !== 'published' || catalog.catalogVersionRef !== catalogV2VersionRef(catalog.catalog)
      || doc.catalogVersionRef !== catalog.catalogVersionRef
      || !doc.businessGoalKey || !doc.currentStageKey || !doc.opportunityId) return null;
    await this.authorizer.assertAuthorized(actor, {
      tenantId: session.tenantId, sessionId: session.id, closedAt: session.closedAt,
      tenantStatus: tenant.status,
    });
    const approved = actions.filter(item => item.tenantId === actor.tenantId
      && item.sessionId === actor.sessionId && item.opportunityId === doc.opportunityId
      && item.catalogVersionId === catalog.catalogVersionRef && CONFIRMED_STATES.has(item.state)
      && typeof item.actionKey === 'string'
      && catalog.catalog.sheets.ToolBindings.some(binding => binding.toolKey === item.actionKey
        && binding.goalKey === doc.businessGoalKey && binding.stageKey === doc.currentStageKey
        && binding.enabled && binding.sideEffectClass !== 'read_only'));
    const matching = approved[0];
    const consentScope = matching?.actionKey
      ? `${catalog.catalogVersionRef}:${matching.actionKey}` : null;
    const consentGranted = Boolean(consentScope
      && session.conversationState?.contactConsent === 'granted'
      && session.conversationState?.consentVersion === consentScope);
    const context = contextForConfirmedV2Action({
      session, document: doc, catalog, expectedActionRevision: matching?.actionRevision ?? 1,
      purposeConsentGranted: consentGranted, purposeConsentScope: consentScope,
    });
    if (!context) return null;
    const stage = evaluateConfirmedV2ActionStage({
      session, document: doc, catalog, expectedActionRevision: matching?.actionRevision ?? 1,
      purposeConsentGranted: consentGranted, purposeConsentScope: consentScope,
    });
    if (!stage.accepted) return null;
    // Verify against authoritative state again after async reads before it is used.
    const current = await this.store.getSession(actor.sessionId);
    if (!current || current.tenantId !== actor.tenantId
      || current.stateVersion !== snapshot.revision || current.closedAt !== null) return null;
    const verifiedRequirementKeys = new Set(context.verifiedRequirementKeys);
    for (const policy of catalog.catalog.sheets.RequirementPolicies) {
      if (policy.goalKey !== doc.businessGoalKey || policy.stageKey !== doc.currentStageKey) continue;
      if (policy.type === 'consent' && consentGranted) verifiedRequirementKeys.add(policy.requirementKey);
      if (policy.type === 'confirmation' && matching && consentGranted) verifiedRequirementKeys.add(policy.requirementKey);
    }
    return {
      sessionRevision: snapshot.revision,
      tenantId: actor.tenantId,
      sessionId: actor.sessionId,
      catalogVersionId: snapshot.catalogVersionId,
      goalKey: doc.businessGoalKey,
      stageKey: doc.currentStageKey,
      confirmedGoal: doc.goalConfirmed && doc.goalConfirmation?.status === 'confirmed',
      customerAuthorized: Boolean(matching && consentGranted),
      consentGranted,
      consentScope,
      verifiedRequirementKeys: [...verifiedRequirementKeys],
      verifiedArguments: Object.fromEntries(Object.entries(doc.verifiedFacts)
        .filter(([,fact]) => fact.maskedValue.length > 0 && fact.evidenceRefs.length > 0)
        .map(([key,fact]) => [key, fact.maskedValue])),
    };
  }
}

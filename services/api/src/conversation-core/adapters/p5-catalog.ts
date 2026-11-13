import { businessCatalogVersionRef, validateBusinessCatalog, type BusinessCatalogDocument } from '../catalog/catalog.js';
import type { Store } from '../../types.js';
import { sanitizeKnowledgeText } from '../../privacy.js';
import type { ModelEnvelopeEnricher } from '../turn-engine.js';
import type { ModelTurnEnvelope, P5CatalogProjection, SessionSnapshot, TrustedActor } from '../contracts.js';
import type { P5ActionStateReader } from './p5-proposal-validator.js';

type CatalogStore = Pick<Store, 'getBusinessCatalogVersion'>;

export class P5CatalogAuthorizationError extends Error {
  constructor() {
    super('Tenant-pinned published catalog is unavailable');
    this.name = 'P5CatalogAuthorizationError';
  }
}

export class P5PinnedCatalogReader {
  constructor(private readonly store: CatalogStore) {}

  async load(actor: TrustedActor, snapshot: SessionSnapshot): Promise<BusinessCatalogDocument> {
    if (actor.role !== 'customer' || actor.tenantId !== snapshot.tenantId
      || actor.sessionId !== snapshot.sessionId || actor.principalId !== snapshot.ownerPrincipalId
      || !snapshot.catalogVersionId || snapshot.catalogVersionId === 'unconfigured') {
      throw new P5CatalogAuthorizationError();
    }
    const row = await this.store.getBusinessCatalogVersion(actor.tenantId, snapshot.catalogVersionId);
    if (!row || row.tenantId !== actor.tenantId || row.id !== snapshot.catalogVersionId
      || row.status !== 'published' || row.catalogVersionRef !== businessCatalogVersionRef(row.catalog)) {
      throw new P5CatalogAuthorizationError();
    }
    const checked = validateBusinessCatalog(row.catalog);
    if (!checked.ok || !checked.document) throw new P5CatalogAuthorizationError();
    const active = checked.document.sheets.BusinessGoals.filter(goal => goal.active).map(goal => goal.businessGoalKey).sort();
    if (JSON.stringify(active) !== JSON.stringify([...snapshot.publishedGoalKeys].sort())) {
      throw new P5CatalogAuthorizationError();
    }
    return checked.document;
  }

  project(catalog: BusinessCatalogDocument, versionId: string, provisional: readonly string[] = [], includeActions = true): P5CatalogProjection {
    const safeText = (value: string, max: number): string => sanitizeKnowledgeText(value).slice(0, max);
    return {
      versionId,
      previousGoalCandidateKeys: provisional.filter(key =>
        catalog.sheets.BusinessGoals.some(goal => goal.active && goal.businessGoalKey === key)).slice(0, 8),
      goals: catalog.sheets.BusinessGoals.filter(goal => goal.active).slice(0, 100).map(goal => ({
        key: goal.businessGoalKey,
        name: safeText(goal.name, 160),
        description: safeText(goal.description, 2000),
        keywords: goal.keywords.slice(0, 32).map(value => safeText(value, 160)),
        customerExpressions: goal.customerExpressions.slice(0, 12).map(value => safeText(value, 300)),
        requiredInformation: goal.requiredInformation.slice(0, 32).map(value => safeText(value, 300)),
        factRequirementKeys: catalog.sheets.RequirementPolicies.filter(row =>
          row.goalKey === goal.businessGoalKey && row.type === 'fact' && row.sourceOfTruth === 'customer')
          .map(row => row.requirementKey).slice(0, 64),
        requiredDocuments: goal.requiredDocuments.slice(0, 32).map(value => safeText(value, 300)),
        packageReferences: goal.packageReferences.slice(0, 32).map(value => safeText(value, 200)),
        productReferences: goal.productReferences.slice(0, 32).map(value => safeText(value, 200)),
        orderedSteps: goal.orderedSteps.slice(0, 16).map(value => safeText(value, 300)),
        availableActionKeys: includeActions ? catalog.sheets.ToolBindings.filter(binding =>
          binding.enabled && binding.goalKey === goal.businessGoalKey && binding.sideEffectClass !== 'read_only'
          && catalog.sheets.WorkflowBindings.some(workflow =>
            workflow.registryKey === binding.registryKey && workflow.enabled))
          .map(binding => binding.toolKey).slice(0, 32) : [],
      })),
    };
  }
}

/** The only authority here is the published tenant catalog; GPT still interprets its prose. */
export class P5CatalogEnvelopeEnricher implements ModelEnvelopeEnricher {
  constructor(private readonly catalogReader: P5PinnedCatalogReader,
    private readonly actionState?: P5ActionStateReader) {}
  async enrich(actor: TrustedActor, pinned: SessionSnapshot, envelope: ModelTurnEnvelope): Promise<ModelTurnEnvelope> {
    const catalog = await this.catalogReader.load(actor, pinned);
    const trustedState = this.actionState ? await this.actionState.load(actor, pinned) : null;
    const permitted = trustedState?.confirmedGoal && trustedState.customerAuthorized
      && trustedState.consentGranted && trustedState.sessionRevision === pinned.revision
      ? catalog.sheets.ToolBindings.filter(row => row.enabled
        && row.goalKey === trustedState.goalKey && row.stageKey === trustedState.stageKey
        && row.sideEffectClass !== 'read_only'
        && trustedState.consentScope === `${businessCatalogVersionRef(catalog)}:${row.toolKey}`)
        .map(row => row.toolKey) : [];
    const projection = this.catalogReader.project(catalog, pinned.catalogVersionId,
      pinned.provisionalGoalKeys ?? [], permitted.length > 0);
    return {
      ...envelope,
      p5Catalog: { ...projection, goals: projection.goals.map(goal => ({
        ...goal, availableActionKeys: goal.availableActionKeys.filter(key => permitted.includes(key)),
      })) },
    };
  }
}

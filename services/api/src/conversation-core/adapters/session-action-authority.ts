import { businessCatalogVersionRef } from '../catalog/catalog.js';
import type { Store } from '../../types.js';
import type { SessionSnapshot, TrustedActor } from '../contracts.js';
import type { SqlPool } from './postgres-repository.js';
import type { SessionAuthorizer } from './session-authorizer.js';
import type { P5ActionStateReader, P5TrustedActionState } from './p5-proposal-validator.js';

type AuthorityStore = Pick<Store, 'getSession' | 'getTenant' | 'getBusinessCatalogVersion'>;

interface GrantRow {
  tenant_id: string;
  session_id: string;
  catalog_version_ref: string;
  goal_key: string;
  stage_key: string;
  action_key: string;
  session_revision: number;
  consent_scope: string;
  granted_by_principal_hash: string;
  goal_confirmed_at: string;
  purpose_consented_at: string;
  customer_authorized_at: string;
}

/**
 * Only a dedicated, explicitly authenticated customer authorization workflow
 * may INSERT the grant. The model and the conversation engine cannot issue it.
 *
 * This reader is deliberately READ ONLY. Missing grants mean no action authority.
 * It never infers consent from a keyword, a model response or a prior assistant prompt.
 */
export class SessionActionAuthorityReader implements P5ActionStateReader {
  constructor(
    private readonly store: AuthorityStore,
    private readonly pool: SqlPool,
    private readonly authorizer: SessionAuthorizer,
  ) {}

  async load(actor: TrustedActor, snapshot: SessionSnapshot): Promise<P5TrustedActionState | null> {
    if (actor.role !== 'customer' || actor.principalId !== snapshot.ownerPrincipalId
      || actor.tenantId !== snapshot.tenantId || actor.sessionId !== snapshot.sessionId) return null;
    const [tenant, session, catalog] = await Promise.all([
      this.store.getTenant(actor.tenantId),
      this.store.getSession(actor.sessionId),
      this.store.getBusinessCatalogVersion(actor.tenantId, snapshot.catalogVersionId),
    ]);
    if (!tenant || !session || !catalog
      || tenant.status !== 'active' || session.closedAt !== null
      || session.tenantId !== actor.tenantId || session.stateVersion !== snapshot.revision
      || catalog.id !== snapshot.catalogVersionId || catalog.tenantId !== actor.tenantId
      || catalog.status !== 'published' || catalog.catalogVersionRef !== businessCatalogVersionRef(catalog.catalog)) {
      return null;
    }
    await this.authorizer.assertAuthorized(actor, {
      tenantId: session.tenantId, sessionId: session.id,
      tenantStatus: tenant.status, closedAt: session.closedAt,
    });
    const client = await this.pool.connect();
    let grant: GrantRow | undefined;
    try {
      const result = await client.query(`
        SELECT tenant_id, session_id, catalog_version_ref, goal_key, stage_key,
               action_key, session_revision, consent_scope, granted_by_principal_hash,
               goal_confirmed_at, purpose_consented_at, customer_authorized_at
          FROM conversation_action_grants
         WHERE tenant_id = $1 AND session_id = $2 AND session_revision = $3
           AND catalog_version_ref = $4 AND granted_by_principal_hash = $5
           AND revoked_at IS NULL AND expires_at > now()
         ORDER BY customer_authorized_at DESC LIMIT 1
      `, [actor.tenantId, actor.sessionId, snapshot.revision,
        catalog.catalogVersionRef, actor.principalId]);
      grant = result.rows[0] as GrantRow | undefined;
    } catch {
      // A database without the new authority migration may not authorize any action.
      return null;
    } finally { client.release(); }
    if (!grant || grant.tenant_id !== actor.tenantId || grant.session_id !== actor.sessionId
      || grant.session_revision !== snapshot.revision
      || grant.catalog_version_ref !== catalog.catalogVersionRef
      || grant.granted_by_principal_hash !== actor.principalId
      || grant.consent_scope !== `${catalog.catalogVersionRef}:${grant.action_key}`
      || !grant.customer_authorized_at || !grant.purpose_consented_at || !grant.goal_confirmed_at) {
      return null;
    }
    const goal = catalog.catalog.sheets.BusinessGoals.find(row =>
      row.active && row.businessGoalKey === grant.goal_key);
    const stage = catalog.catalog.sheets.BusinessStages.find(row =>
      row.active && row.businessGoalKey === grant.goal_key && row.stageKey === grant.stage_key);
    const binding = catalog.catalog.sheets.ToolBindings.find(row =>
      row.enabled && row.goalKey === grant.goal_key && row.stageKey === grant.stage_key
      && row.toolKey === grant.action_key && row.sideEffectClass !== 'read_only'
      && row.consent === 'purpose_specific' && row.confirmation === 'explicit_customer'
      && row.registryKey !== null);
    if (!goal || !stage || !binding) return null;
    const checked = await this.store.getSession(actor.sessionId);
    if (!checked || checked.tenantId !== actor.tenantId || checked.closedAt !== null
      || checked.stateVersion !== snapshot.revision) return null;
    const customerFacts = snapshot.verifiedFacts.filter(fact =>
      fact.sourceReference.startsWith('customer-turn:') && fact.revision <= snapshot.revision);
    const verifiedRequirementKeys = new Set(customerFacts.map(fact => fact.key));
    for (const policy of catalog.catalog.sheets.RequirementPolicies) {
      if (policy.goalKey !== grant.goal_key || policy.stageKey !== grant.stage_key) continue;
      if (policy.type === 'confirmation' || policy.type === 'consent') verifiedRequirementKeys.add(policy.requirementKey);
    }
    return {
      sessionRevision: snapshot.revision,
      tenantId: actor.tenantId,
      sessionId: actor.sessionId,
      catalogVersionId: snapshot.catalogVersionId,
      goalKey: grant.goal_key,
      stageKey: grant.stage_key,
      confirmedGoal: true,
      customerAuthorized: true,
      consentGranted: true,
      consentScope: grant.consent_scope,
      verifiedRequirementKeys: [...verifiedRequirementKeys],
      verifiedArguments: Object.fromEntries(snapshot.verifiedFacts
        .filter(fact => fact.revision <= snapshot.revision).map(fact => [fact.key, fact.value])),
    };
  }
}

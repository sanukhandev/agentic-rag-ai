import { describe, expect, it } from 'vitest';
import type { Store } from '../../types.js';
import type { SessionSnapshot, TrustedActor } from '../contracts.js';
import type { SqlClient, SqlPool } from '../adapters/postgres-repository.js';
import type { SessionAuthorizer } from '../adapters/session-authorizer.js';
import { SessionActionAuthorityReader } from '../adapters/session-action-authority.js';

const actor: TrustedActor = {
  tenantId: 'tenant-one', sessionId: 'session-one', principalId: 'a'.repeat(64), role: 'customer',
};
const snapshot: SessionSnapshot = {
  tenantId: actor.tenantId, sessionId: actor.sessionId, ownerPrincipalId: actor.principalId,
  personaVersionId: 'persona', catalogVersionId: 'catalog',
  revision: 5, personaInstructions: '', conversationSummary: '', recentTurns: [],
  verifiedFacts: [], publishedGoalKeys: ['create_company'], pendingActionStatus: [],
};
function setup(grant: Record<string, unknown> | null, sessionRevision = 5) {
  let queries = 0;
  const session = { id: actor.sessionId, tenantId: actor.tenantId, stateVersion: sessionRevision, closedAt: null };
  const catalog = {
    id: 'catalog', tenantId: actor.tenantId, status: 'published',
    catalogVersionRef: 'hash', catalog: { sheets: {
      BusinessGoals: [{ businessGoalKey: 'create_company', active: true }],
      BusinessStages: [{ businessGoalKey: 'create_company', stageKey: 'lead_generation', active: true }],
      ToolBindings: [{
        goalKey: 'create_company', stageKey: 'lead_generation', toolKey: 'lead.create',
        enabled: true, sideEffectClass: 'write', consent: 'purpose_specific',
        confirmation: 'explicit_customer', registryKey: 'lead-provider',
      }],
      RequirementPolicies: [],
    }},
  };
  const store = {
    async getTenant() { return { status: 'active' }; },
    async getSession() { return session; },
    async getIntentCatalogV2Version() { return catalog; },
  } as unknown as Pick<Store, 'getSession' | 'getTenant' | 'getIntentCatalogV2Version'>;
  const pool = {
    async connect(): Promise<SqlClient> {
      return {
        async query(_sql: string) { queries++; return { rows: grant ? [grant] : [] }; },
        release() {},
      };
    },
  } as SqlPool;
  const authorizer: SessionAuthorizer = { async assertAuthorized() {} };
  return { reader: new SessionActionAuthorityReader(store, pool, authorizer), get queries() { return queries; } };
}
const standard = {
  tenant_id: actor.tenantId, session_id: actor.sessionId,
  catalog_version_ref: 'hash', goal_key: 'create_company', stage_key: 'lead_generation',
  action_key: 'lead.create', session_revision: 5, consent_scope: 'hash:lead.create',
  granted_by_principal_hash: actor.principalId,
  goal_confirmed_at: '2026-01-01', purpose_consented_at: '2026-01-01',
  customer_authorized_at: '2026-01-01',
};

describe('New action authority — no V2 inferred confirmation', () => {
  it('requires an explicit persisted grant before suggesting any action', async () => {
    const f = setup(null);
    expect(await f.reader.load(actor, snapshot)).toBeNull();
    expect(f.queries).toBe(1);
  });
  it('denies grants from another principal, tenant or revision', async () => {
    for (const grant of [
      { ...standard, granted_by_principal_hash: 'b'.repeat(64) },
      { ...standard, tenant_id: 'another-tenant' },
      { ...standard, session_revision: 4 },
      { ...standard, consent_scope: 'unrelated-action' },
    ]) expect(await setup(grant).reader.load(actor, snapshot)).toBeNull();
    const f = setup(standard, 6);
    expect(await f.reader.load(actor, snapshot)).toBeNull();
    expect(f.queries).toBe(0);
  });
  it('does not treat a proposal without explicit customer consent as authority', async () => {
    expect(await setup({ ...standard, purpose_consented_at: null }).reader.load(actor, snapshot)).toBeNull();
    expect(await setup({ ...standard, customer_authorized_at: null }).reader.load(actor, snapshot)).toBeNull();
  });
  it('rejects forged actor identity before querying authority', async () => {
    const f = setup(standard);
    expect(await f.reader.load({ ...actor, tenantId: 'other-tenant' }, snapshot)).toBeNull();
    expect(f.queries).toBe(0);
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogV2VersionRef, validateCatalogV2 } from '../../conversation/catalog.js';
import { newLifecycleState } from '../../lifecycle-state.js';
import type { Store, Session, UserIntentDocument, ActionRequest, IntentCatalogV2Version } from '../../types.js';
import type { SessionSnapshot, TrustedActor } from '../contracts.js';
import type { SessionAuthorizer } from '../adapters/session-authorizer.js';
import { P6TrustedActionStateReader } from '../adapters/p6-trusted-action-state.js';

const input = JSON.parse(readFileSync(new URL('../../fixtures/ancfz-catalog-v2-seven-stage.json', import.meta.url), 'utf8')) as unknown;
const checked = validateCatalogV2(input);
if (!checked.ok || !checked.document) throw new Error('Missing test catalog');
const catalog = checked.document;
const catalogRef = catalogV2VersionRef(catalog);
const tenantId = 'tenant-1';
const sessionId = 'session-1';
const goal = 'anc.company_formation';
const actor: TrustedActor = {
  tenantId, sessionId, principalId: 'a'.repeat(64), role: 'customer',
};
const snapshot: SessionSnapshot = {
  tenantId, sessionId, ownerPrincipalId: actor.principalId, revision: 4,
  personaVersionId: 'persona-1', catalogVersionId: 'catalog-uuid',
  personaInstructions: '', conversationSummary: '', recentTurns: [], verifiedFacts: [],
  publishedGoalKeys: [goal], pendingActionStatus: [],
};

function fixture(overrides: {
  consent?: boolean; confirmed?: boolean; actionApproved?: boolean;
  otherTenant?: boolean; stale?: boolean; wrongStage?: boolean;
} = {}) {
  const life = newLifecycleState();
  const entry = { journeyId: 'opp-1', lifecycle: life };
  const session = {
    id: sessionId, tenantId, closedAt: null,
    lastActivityAt: new Date().toISOString(), stateVersion: overrides.stale ? 5 : 4,
    conversationState: {
      contactConsent: overrides.consent === false ? 'denied' : 'granted',
      consentVersion: catalogRef + ':lead.create',
      intentProgress: { entries: { [goal]: entry } },
    },
  } as unknown as Session;
  const doc = {
    tenantId, sessionId, opportunityId: 'opp-1', catalogSource: 'v2',
    catalogVersionRef: catalogRef, businessGoalKey: goal,
    currentStageKey: overrides.wrongStage ? 'account_creation' : 'lead_generation',
    stageRevision: life.stages.lead_generation.revision,
    goalConfirmed: overrides.confirmed !== false,
    goalConfirmation: { status: 'confirmed' },
    verifiedFacts: { lead_contact_name: {
      maskedValue: 'Mina', source: 'visitor', evidenceRefs: ['turn-1'], messageSequence: 1, corrected: false,
    } },
  } as unknown as UserIntentDocument;
  const version = {
    id: snapshot.catalogVersionId, tenantId, status: 'published',
    catalogVersionRef: catalogRef, catalog,
  } as IntentCatalogV2Version;
  const action = {
    tenantId, sessionId, opportunityId: 'opp-1', catalogVersionId: catalogRef,
    state: overrides.actionApproved === false ? 'awaiting_confirmation' : 'approved',
    actionKey: 'lead.create', actionRevision: 1,
  } as ActionRequest;
  const store = {
    async getTenant() { return { id: tenantId, status: 'active' }; },
    async getSession() { return session; },
    async getUserIntentDocument() { return doc; },
    async getIntentCatalogV2Version() { return version; },
    async listActionsBySession() { return [action]; },
  } as unknown as Pick<Store, 'getSession' | 'getUserIntentDocument'
    | 'getIntentCatalogV2Version' | 'getTenant' | 'listActionsBySession'>;
  const authorizer: SessionAuthorizer = {
    async assertAuthorized(requested) {
      if (overrides.otherTenant || requested.tenantId !== tenantId
        || requested.principalId !== actor.principalId) throw new Error('denied');
    },
  };
  return new P6TrustedActionStateReader(store, authorizer);
}

describe('P6 authoritative state reader', () => {
  it('reads only approved matching actions, exact version and purpose-scoped consent', async () => {
    const state = await fixture().load(actor, snapshot);
    expect(state).toMatchObject({
      tenantId, sessionId, sessionRevision: snapshot.revision,
      goalKey: goal, stageKey: 'lead_generation',
      confirmedGoal: true, customerAuthorized: true, consentGranted: true,
      consentScope: catalogRef + ':lead.create',
    });
    expect(state?.verifiedArguments.lead_contact_name).toBe('Mina');
  });

  it('cannot infer customer authorization from a model goal or an unapproved action', async () => {
    const state = await fixture({ actionApproved: false }).load(actor, snapshot);
    expect(state?.customerAuthorized).toBe(false);
    expect(state?.consentGranted).toBe(false);
  });

  it('rejects stale session, incorrect journey stage and tenant mismatch', async () => {
    expect(await fixture({ stale: true }).load(actor, snapshot)).toBeNull();
    expect(await fixture({ wrongStage: true }).load(actor, snapshot)).toBeNull();
    await expect(fixture().load({ ...actor, tenantId: 'other' }, snapshot)).resolves.toBeNull();
  });

  it('will not treat withheld consent as granted', async () => {
    const state = await fixture({ consent: false }).load(actor, snapshot);
    expect(state?.customerAuthorized).toBe(false);
    expect(state?.consentGranted).toBe(false);
  });
});

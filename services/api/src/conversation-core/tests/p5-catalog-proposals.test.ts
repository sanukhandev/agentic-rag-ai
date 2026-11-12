import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogV2VersionRef, validateCatalogV2, type CatalogV2Document } from '../../conversation/catalog.js';
import type { Store } from '../../types.js';
import type { ModelCandidate, SessionSnapshot, TrustedActor } from '../contracts.js';
import { P5CatalogAuthorizationError, P5CatalogEnvelopeEnricher, P5PinnedCatalogReader } from '../adapters/p5-catalog.js';
import { P5ProposalError, P5ProposalValidator, type P5TrustedActionState } from '../adapters/p5-proposal-validator.js';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/ancfz-catalog-v2-seven-stage.json', import.meta.url), 'utf8')) as unknown;
const parsed = validateCatalogV2(fixture);
if (!parsed.ok || !parsed.document) throw new Error('Reference catalog is invalid');
const catalog: CatalogV2Document = parsed.document;
const tenantId = 'tenant-alpha';
const actor: TrustedActor = { tenantId, sessionId: 'session-one', principalId: 'a'.repeat(64), role: 'customer' };
const goal = 'anc.company_formation';
const snapshot: SessionSnapshot = {
  tenantId, sessionId: actor.sessionId, ownerPrincipalId: actor.principalId, revision: 3,
  personaVersionId: 'persona-1', catalogVersionId: 'catalog-1', personaInstructions: '',
  conversationSummary: '', recentTurns: [], verifiedFacts: [], publishedGoalKeys: [goal],
  pendingActionStatus: [],
};
const base: ModelCandidate = {
  message: 'I can help with your request.', evidenceRefs: [], goalCandidateKeys: [goal],
  proposedFacts: [], actionProposal: null,
};
function reader(overrides: Partial<{ tenantId: string; id: string; status: 'draft' | 'published'; catalogVersionRef: string }> = {}): P5PinnedCatalogReader {
  const item = {
    id: snapshot.catalogVersionId, tenantId, status: 'published' as const,
    catalogVersionRef: catalogV2VersionRef(catalog), catalog,
    ...overrides,
  };
  return new P5PinnedCatalogReader({
    async getIntentCatalogV2Version() { return item; },
  } as unknown as Pick<Store, 'getIntentCatalogV2Version'>);
}
function candidateFact(key: string, value: string, supportingTurnId = 'customer-turn-1'): ModelCandidate {
  return { ...base, proposedFacts: [{ key, value, supportingTurnId }] };
}
function actionState(overrides: Partial<P5TrustedActionState> = {}): P5TrustedActionState {
  return {
    sessionRevision: snapshot.revision,
    tenantId, sessionId: actor.sessionId, catalogVersionId: snapshot.catalogVersionId,
    goalKey: goal, stageKey: 'lead_generation', confirmedGoal: true,
    customerAuthorized: true, consentGranted: true,
    consentScope: snapshot.catalogVersionId + ':lead.create',
    verifiedRequirementKeys: ['lead_contact_name', 'lead_contact_channel', 'lead_crm_consent', 'lead_action_confirmation'],
    verifiedArguments: { lead_contact_name: 'Mina', lead_contact_channel: '[EMAIL_1]' },
    ...overrides,
  };
}

describe('P5 tenant-pinned catalog projection', () => {
  it('loads only an exact published tenant catalog and exposes plain-text requirements, not providers', async () => {
    const r = reader();
    const loaded = await r.load(actor, snapshot);
    const projection = r.project(loaded, snapshot.catalogVersionId);
    expect(projection.versionId).toBe(snapshot.catalogVersionId);
    expect(projection.goals[0]?.key).toBe(goal);
    expect(projection.goals[0]?.description).toContain('company');
    expect(projection.goals[0]?.factRequirementKeys).toContain('business_activity');
    expect(projection.goals[0]?.availableActionKeys).toContain('lead.create');
    expect(JSON.stringify(projection)).not.toContain('n8nWorkflowId');
  });

  it('rejects forged identity, draft catalog, mismatched source hash and foreign tenant', async () => {
    await expect(reader().load({ ...actor, tenantId: 'other' }, snapshot)).rejects.toBeInstanceOf(P5CatalogAuthorizationError);
    await expect(reader({ tenantId: 'other' }).load(actor, snapshot)).rejects.toBeInstanceOf(P5CatalogAuthorizationError);
    await expect(reader({ status: 'draft' }).load(actor, snapshot)).rejects.toBeInstanceOf(P5CatalogAuthorizationError);
    await expect(reader({ catalogVersionRef: 'tampered' }).load(actor, snapshot)).rejects.toBeInstanceOf(P5CatalogAuthorizationError);
    await expect(reader().load(actor, { ...snapshot, publishedGoalKeys: ['made_up'] }))
      .rejects.toBeInstanceOf(P5CatalogAuthorizationError);
  });

  it('enriches only the pinned model context without mutating conversation scope', async () => {
    const model = {
      tenantId, sessionId: actor.sessionId, requestId: 'customer-turn-1', catalogVersionId: snapshot.catalogVersionId,
      readToolScopeRef: 'signed-capability', publishedGoalKeys: [goal],
    } as unknown as Parameters<P5CatalogEnvelopeEnricher['enrich']>[2];
    const result = await new P5CatalogEnvelopeEnricher(reader()).enrich(actor, snapshot, model);
    expect(result).toMatchObject(model);
    expect(result.p5Catalog?.goals[0]?.key).toBe(goal);
  });
});

describe('P5 customer-sourced facts', () => {
  it('accepts only a customer-uttered fact with a published requirement key and current turn ID', async () => {
    const validator = new P5ProposalValidator(reader());
    const result = await validator.validateFacts(actor, candidateFact('business_activity', 'IT consulting'), snapshot,
      'We are interested in IT consulting.', 'customer-turn-1');
    expect(result).toEqual([{
      key: 'business_activity', value: 'IT consulting', source: 'customer',
      sourceReference: 'customer-turn:customer-turn-1', revision: 4,
    }]);
  });

  it('rejects invented, assistant-derived, unapproved, ambiguous and raw contact facts', async () => {
    const validator = new P5ProposalValidator(reader());
    for (const input of [
      [candidateFact('business_activity', 'banking'), 'IT consulting only.', 'customer-turn-1'],
      [candidateFact('business_activity', 'IT consulting', 'assistant-turn'), 'IT consulting.', 'customer-turn-1'],
      [candidateFact('admin_secret', 'IT consulting'), 'IT consulting.', 'customer-turn-1'],
      [{ ...candidateFact('business_activity', 'IT consulting'), goalCandidateKeys: [goal, 'other'] }, 'IT consulting.', 'customer-turn-1'],
      [candidateFact('lead_contact_channel', 'mina@example.com'), 'Contact mina@example.com.', 'customer-turn-1'],
    ] as const) {
      await expect(validator.validateFacts(actor, input[0], snapshot, input[1], input[2])).rejects.toBeInstanceOf(P5ProposalError);
    }
  });

  it('does not require confirmation for knowledge-only turns with no fact/action proposals', async () => {
    const validator = new P5ProposalValidator(reader());
    const reply = { ...base, goalCandidateKeys: [], proposedFacts: [], actionProposal: null };
    expect(await validator.validateFacts(actor, reply, snapshot)).toEqual([]);
    expect(await validator.validateActionProposal(actor, reply, snapshot)).toBeNull();
  });
});

describe('P5 provider-independent business action authorization', () => {
  const withAction: ModelCandidate = { ...base, actionProposal: {
    actionKey: 'lead.create', reason: 'The customer requested a consented lead.', input: {},
  } };
  const persistedFacts: SessionSnapshot = {
    ...snapshot, verifiedFacts: [
      { key: 'lead_contact_name', value: 'Mina', source: 'customer', sourceReference: 'customer-turn:1', revision: 2 },
      { key: 'lead_contact_channel', value: '[EMAIL_1]', source: 'customer', sourceReference: 'customer-turn:1', revision: 2 },
    ],
  };
  function authorized(overrides: Partial<P5TrustedActionState> = {}): P5ProposalValidator {
    return new P5ProposalValidator(reader(), { async load() { return actionState(overrides); } });
  }

  it('can persist a proposal only after authoritative, stage, requirement, consent and authorization checks', async () => {
    const valid = await authorized().validateActionProposal(actor, withAction, persistedFacts);
    expect(valid).toEqual(withAction.actionProposal);
  });

  it('denies missing consent, authorization, completed facts, disabled stage and tenant mismatch', async () => {
    for (const changes of [
      { consentGranted: false }, { customerAuthorized: false }, { confirmedGoal: false },
      { stageKey: 'lead_qualification' }, { tenantId: 'tenant-foreign' },
      { verifiedRequirementKeys: [] }, { catalogVersionId: 'stale' },
      { sessionRevision: 2 },
      { consentScope: 'other:lead.create' },
    ] as const) {
      expect(await authorized(changes).validateActionProposal(actor, withAction, persistedFacts)).toBeNull();
    }
    expect(await authorized().validateActionProposal(actor, withAction, snapshot)).toBeNull();
    const noActionReader = new P5ProposalValidator(reader());
    expect(await noActionReader.validateActionProposal(actor, withAction, persistedFacts)).toBeNull();
  });

  it('rejects invented provider arguments and side-effect bypasses', async () => {
    const validator = authorized();
    expect(await validator.validateActionProposal(actor, {
      ...withAction, actionProposal: { ...withAction.actionProposal!, input: { lead_contact_channel: 'invented' } },
    }, persistedFacts)).toBeNull();
    expect(await validator.validateActionProposal(actor, {
      ...withAction, actionProposal: { actionKey: 'knowledge.search', reason: 'write', input: {} },
    }, persistedFacts)).toBeNull();
    expect(await validator.validateActionProposal(actor, {
      ...withAction, actionProposal: { actionKey: 'delete_source', reason: 'write', input: {} },
    }, persistedFacts)).toBeNull();
  });
});

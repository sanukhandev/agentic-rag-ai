import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../store-memory.js';
import { catalogV2Sha256, catalogV2VersionRef, validateCatalogV2 } from './catalog.js';
import { newConversationState } from '../conversation-state.js';
import { evaluateConfirmedV2ActionStage, evaluatePersistedV2ActionConfirmation, evaluateV2CallbackStageCompletion, initializeConfirmedV2Journey } from './journey-bootstrap.js';
import type { ActionRequest, Session, UserIntentDocument } from '../types.js';

const makeFixture = async () => {
  const store = new MemoryStore();
  const tenant = await store.createTenant({ name: 'Journey Guard Tenant', slug: 'journey-guard-tenant' });
  const session = await store.createSession(tenant.id);
  const parsed = validateCatalogV2(JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')));
  if (!parsed.ok || !parsed.document) throw new Error('V2_UNIT_CATALOG_INVALID');
  const catalog = parsed.document;
  catalog.manifest.tenantScope = tenant.slug;
  catalog.sheets.CatalogManifest[0]!.tenantScope = tenant.slug;
  const version = await store.createIntentCatalogV2Version({
    tenantId: tenant.id, status: 'draft', sourceFileName: 'unit.json', sourceHash: catalogV2Sha256(catalog),
    parserVersion: 'unit', catalogVersionRef: catalogV2VersionRef(catalog), catalog,
  });
  const pinned = await store.publishIntentCatalogV2Version(tenant.id, version.id);
  if (!pinned) throw new Error('V2_UNIT_PUBLICATION_UNAVAILABLE');
  const timestamp = new Date().toISOString();
  const doc: UserIntentDocument = {
    id: randomUUID(), tenantId: tenant.id, sessionId: session.id,
    catalogSource: 'v2', catalogVersionRef: pinned.catalogVersionRef, personaVersionId: null,
    opportunityId: null, businessGoalKey: 'anc.company_formation', turnIntentKey: 'goal.company_formation',
    currentStageKey: null, stageRevision: 0, goalConfirmed: true,
    goalConfirmation: {
      status: 'confirmed', goalKey: 'anc.company_formation', proposalMessageId: randomUUID(),
      promptId: randomUUID(), catalogVersionRef: pinned.catalogVersionRef,
      personaVersionId: 'persona-12345678', sessionRevision: 1,
      intentRevision: 0, issuedAt: timestamp, customerMessageId: randomUUID(),
      customerClientMessageId: randomUUID(), decidedAt: timestamp,
    },
    verifiedFacts: {}, pendingRequirementKey: null, lastQuestion: null, approvedResponse: null,
    toolRefs: [], sourceRefs: [], summary: '', summaryRevision: 0, revision: 1,
    createdAt: timestamp, updatedAt: timestamp,
  };
  return { store, tenant, session, pinned, doc };
};

describe('authoritative confirmed V2 journey bootstrap', () => {
  it('does not initialize a journey from an unconfirmed model proposal', async () => {
    const { doc } = await makeFixture();
    const state = newConversationState();
    const result = initializeConfirmedV2Journey(state, { ...doc, goalConfirmed: false, goalConfirmation: null });
    expect(result.created).toBe(false);
    expect(result.document.opportunityId).toBeNull();
    expect(result.state.intentProgress?.entries['anc.company_formation']).toBeUndefined();
  });

  it('creates exactly one tenant-scoped opportunity with stage one pending, and no provider completion', async () => {
    const { store, tenant, session, pinned, doc } = await makeFixture();
    const result = initializeConfirmedV2Journey(newConversationState(), doc, () => 'opportunity-confirmed-123');
    expect(result.created).toBe(true);
    expect(result.document).toMatchObject({
      opportunityId: 'opportunity-confirmed-123', currentStageKey: 'lead_generation', stageRevision: 0,
    });
    expect(result.state.intentProgress?.entries['anc.company_formation']?.lifecycle?.stages.lead_generation)
      .toMatchObject({ status: 'awaiting_customer', revision: 0, evidence: {} });
    const scopedSession: Session = { ...session, conversationState: result.state };
    expect(evaluateConfirmedV2ActionStage({ session: scopedSession, document: result.document,
      catalog: pinned, expectedActionRevision: 1,
      purposeConsentGranted: false, purposeConsentScope: null })).toMatchObject({
        accepted: true, currentStageKey: 'lead_generation',
      });
    expect(await store.listActionsBySession(session.id, tenant.id)).toEqual([]);
    const replay = initializeConfirmedV2Journey(result.state, result.document);
    expect(replay.created).toBe(false);
    expect(replay.document.opportunityId).toBe(result.document.opportunityId);
  });

  it('rejects an inconsistent durable journey rather than recreating an opportunity', async () => {
    const { doc } = await makeFixture();
    expect(() => initializeConfirmedV2Journey(newConversationState(),
      { ...doc, opportunityId: 'opportunity-original', currentStageKey: 'lead_generation' }))
      .toThrow('V2_JOURNEY_AUTHORITY_MISMATCH');
  });

  it('rejects missing goal evidence or a stage that has not been initialized', async () => {
    const { session, pinned, doc } = await makeFixture();
    const incomplete = evaluateConfirmedV2ActionStage({ session, document: doc, catalog: pinned,
      expectedActionRevision: 1, purposeConsentGranted: false, purposeConsentScope: null });
    expect(incomplete.accepted).toBe(false);
    expect(incomplete.reasons).toContain('v2_authoritative_journey_missing');
  });

  it('prevents an action from using legacy consent even after goal confirmation', async () => {
    const { store, session, pinned, doc } = await makeFixture();
    const bootstrap = initializeConfirmedV2Journey(newConversationState(), doc, () => 'opportunity-12345678');
    await store.updateSession({ ...session, conversationState: bootstrap.state });
    await store.createUserIntentDocument(bootstrap.document);
    const action: ActionRequest = {
      id: randomUUID(), tenantId: session.tenantId, sessionId: session.id,
      opportunityId: bootstrap.document.opportunityId,
      catalogVersionId: pinned.catalogVersionRef,
      workflowKey: 'crm.account.create', actionKey: 'account.propose_creation', actionRevision: 1,
      idempotencyKey: 'unit-action-123', state: 'awaiting_confirmation',
      opaqueReference: 'opaque-123', payload: { contactConsent: true },
      createdAt: new Date().toISOString(), result: null,
    };
    const decision = await evaluatePersistedV2ActionConfirmation(store, await store.getSession(session.id) as Session, action);
    expect(decision.applies).toBe(true);
    expect(decision.accepted).toBe(false);
    expect(decision.reasons).toContain('action_not_authorized_by_pinned_catalog');
    const missingDocSession = await store.createSession(session.tenantId);
    const forged = { ...action, sessionId: missingDocSession.id, opportunityId: 'prior-opportunity' };
    expect(await evaluatePersistedV2ActionConfirmation(store, missingDocSession, forged))
      .toMatchObject({ applies: true, accepted: false, reasons: ['v2_intent_document_missing'] });
    expect(await store.listActionsBySession(session.id, session.tenantId)).toEqual([]);
  });

  it('allows pending provider transport but blocks unverified V2 terminal completion', async () => {
    const { doc, session, pinned } = await makeFixture();
    const scoped = initializeConfirmedV2Journey(newConversationState(), doc, () => 'new-opportunity');
    const action: ActionRequest = {
      id: randomUUID(), tenantId: session.tenantId, sessionId: session.id,
      opportunityId: scoped.document.opportunityId, catalogVersionId: pinned.catalogVersionRef,
      workflowKey: 'crm.lead.create', actionKey: 'lead.propose_creation',
      actionRevision: 1, idempotencyKey: 'one-action',
      state: 'processing', opaqueReference: 'opaque-123',
      payload: { contactConsent: true }, result: null,
      createdAt: new Date().toISOString(),
    };
    expect(evaluateV2CallbackStageCompletion(action, 'processing', scoped.document, true))
      .toMatchObject({ applies: true, accepted: true, reason: null });
    expect(evaluateV2CallbackStageCompletion(action, 'completed', scoped.document, true))
      .toMatchObject({ applies: true, accepted: false, reason: 'v2_trusted_provider_readback_required' });
    expect(evaluateV2CallbackStageCompletion(action, 'completed', null, true))
      .toMatchObject({ applies: true, accepted: false, reason: 'v2_callback_scope_mismatch' });
    expect(evaluateV2CallbackStageCompletion(action, 'completed', {
      ...scoped.document, opportunityId: 'another-opportunity',
    }, true)).toMatchObject({ accepted: false, reason: 'v2_callback_scope_mismatch' });
    expect(evaluateV2CallbackStageCompletion(action, 'completed', null, false))
      .toMatchObject({ applies: false, accepted: true });
  });
});

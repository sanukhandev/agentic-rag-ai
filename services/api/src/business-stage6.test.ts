import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createApprovedQuote, createContractDraft, createInvoiceDraft, confirmPackageSelection, hasVerifiedLivePayment, proposePackageSelection } from './business-lifecycle.js';
import { newConversationState, newIntentProgress } from './conversation-state.js';
import { MemoryStore } from './store-memory.js';

const setup = async () => {
  const store = new MemoryStore();
  const tenant = await store.createTenant({ name: 'Billing-stage test', slug: 'stage6-' + randomUUID().slice(0, 8) });
  const session = await store.createSession(tenant.id);
  const opportunityId = randomUUID();
  const goal = 'anc.company_formation';
  session.conversationState = {
    ...newConversationState(),
    selectedIntentKey: goal,
    intentProgress: {
      ...newIntentProgress(), activeIntentKey: goal,
      entries: { [goal]: {
        intentKey: goal, journeyId: opportunityId, status: 'active', completedRequirementKeys: [],
        currentRequirementKey: null, slotValues: {}, slotProvenance: {}, revision: 1,
      } },
    },
  };
  const now = new Date().toISOString();
  const offering = await store.createPackageOffering({
    id: randomUUID(), tenantId: tenant.id, catalogVersionId: null, packageKey: 'test-package',
    name: 'Test Package', eligibleEntityTypes: [], eligibleActivities: [],
    includedVisaQuantity: 1, officeRequirement: 'shared', inclusions: ['formation'],
    priceMinor: 100000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null,
    additionalFees: [], processingTime: 'test', requiredDocuments: [], exclusions: [],
    availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['test-pricebook'], createdAt: now,
  });
  await store.createCrmAccount({
    id: randomUUID(), tenantId: tenant.id, opportunityId, leadId: randomUUID(),
    remoteAccountId: 'account-verified', remoteContactId: 'contact-verified',
    remoteOpportunityId: 'opportunity-verified', status: 'verified',
    conversionRule: 'qualification_verified', verifiedAt: now, createdAt: now, updatedAt: now,
  });
  const selection = await proposePackageSelection(store, session, opportunityId, offering.id);
  const quote = await createApprovedQuote(store, session, opportunityId, offering.id);
  await confirmPackageSelection(store, session, selection.id, quote.id);
  const draft = await createInvoiceDraft(store, session, opportunityId, quote.id);
  const invoice = await store.updateInvoice({
    ...draft, status: 'paid', provider: 'billing_live',
    paymentUrl: 'https://billing.example.com/pay/confirmed',
    externalInvoiceId: 'invoice-verified-1', updatedAt: now,
  });
  return { store, tenant, session, opportunityId, selection, quote, invoice, now };
};

describe('Stage 6 → Stage 7 authoritative payment gate', () => {
  it('rejects paid status without independent settlement evidence', async () => {
    const { store, session, opportunityId, selection, invoice } = await setup();
    await expect(hasVerifiedLivePayment(store, session, invoice)).resolves.toBe(false);
    await expect(createContractDraft(store, session, opportunityId, selection.id, invoice.id))
      .rejects.toMatchObject({ code: 'PAYMENT_PROOF_REQUIRED' });
  });

  it('rejects mock payment even if invoice was incorrectly persisted as paid', async () => {
    const { store, session, opportunityId, selection, invoice } = await setup();
    const simulated = await store.updateInvoice({ ...invoice, provider: 'deterministic_mock' });
    await expect(createContractDraft(store, session, opportunityId, selection.id, simulated.id))
      .rejects.toMatchObject({ code: 'PAYMENT_PROOF_REQUIRED' });
  });

  it('permits contract preparation only after a completed payment action and matching readback audit', async () => {
    const { store, tenant, session, opportunityId, selection, invoice, quote, now } = await setup();
    const actionId = randomUUID();
    await store.createAction({
      id: actionId, tenantId: tenant.id, sessionId: session.id, opportunityId,
      workflowKey: 'payment.authorize', actionKey: 'payment.authorize', actionRevision: 1,
      intentKey: 'anc.company_formation', state: 'completed', idempotencyKey: 'payment-test-key',
      opaqueReference: 'payment-test-ref',
      payload: { contactConsent: true, slotValues: { invoiceId: invoice.id } },
      createdAt: now, result: { externalReference: 'payment-verified-123' },
    });
    const proof = {
      actionId, invoiceId: invoice.id, quoteId: quote.id, opportunityId,
      externalInvoiceId: invoice.externalInvoiceId, paymentId: 'payment-verified-123',
      amountMinor: invoice.amountMinor, currency: invoice.currency,
      evidenceTier: 'provider_record_verified',
    };
    await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: null,
      eventName: 'payment.live_settlement_verified',
      metadata: { ...proof, amountMinor: 1 }, createdAt: now });
    await expect(hasVerifiedLivePayment(store, session, invoice)).resolves.toBe(false);
    await store.addAudit({ id: randomUUID(), tenantId: tenant.id, actorId: null,
      eventName: 'payment.live_settlement_verified', metadata: proof, createdAt: now });
    await expect(hasVerifiedLivePayment(store, session, invoice)).resolves.toBe(true);
    const contract = await createContractDraft(store, session, opportunityId, selection.id, invoice.id);
    expect(contract).toMatchObject({ invoiceId: invoice.id, packageSelectionId: selection.id, status: 'draft' });
  });
});

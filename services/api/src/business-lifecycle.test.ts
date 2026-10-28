import { describe, expect, it } from 'vitest';
import { createApprovedQuote, createContractDraft, createInvoiceDraft, confirmPackageSelection, listEligiblePackages, proposePackageSelection } from './business-lifecycle.js';
import { newConversationState, newIntentProgress } from './conversation-state.js';
import { MemoryStore } from './store-memory.js';

describe('verified business lifecycle gates', () => {
  it('does not create an invoice or contract before package confirmation and verified payment', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANCFZ', slug: 'anc' });
    const session = await store.createSession(tenant.id);
    const opportunityId = '00000000-0000-4000-8000-000000000001';
    const initialState = newConversationState();
    const progress = newIntentProgress();
    session.conversationState = { ...initialState, selectedIntentKey: 'anc.setup.new_company', intentProgress: { ...progress, activeIntentKey: 'anc.setup.new_company', entries: { 'anc.setup.new_company': { intentKey: 'anc.setup.new_company', journeyId: opportunityId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: { business_activity: 'digital marketing' }, slotProvenance: {}, revision: 1 } } } };
    const offering = await store.createPackageOffering({ id: '00000000-0000-4000-8000-000000000002', tenantId: tenant.id, catalogVersionId: null, packageKey: 'sandbox-standard', name: 'Sandbox Standard', eligibleEntityTypes: [], eligibleActivities: ['digital marketing'], includedVisaQuantity: 2, officeRequirement: 'shared', inclusions: ['registration'], priceMinor: 125000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'sandbox', requiredDocuments: ['synthetic_passport'], exclusions: [], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['sandbox-pricebook-v1'], createdAt: new Date().toISOString() });
    await expect(listEligiblePackages(store, session)).resolves.toMatchObject([{ id: offering.id }]);
    const selection = await proposePackageSelection(store, session, opportunityId, offering.id);
    const quote = await createApprovedQuote(store, session, opportunityId, offering.id);
    await expect(createInvoiceDraft(store, session, opportunityId, quote.id)).rejects.toMatchObject({ code: 'PACKAGE_NOT_CONFIRMED' });
    const confirmed = await confirmPackageSelection(store, session, selection.id, quote.id);
    expect(confirmed.status).toBe('confirmed');
    const invoice = await createInvoiceDraft(store, session, opportunityId, quote.id);
    expect(invoice.status).toBe('draft');
    await expect(createContractDraft(store, session, opportunityId, selection.id, invoice.id)).rejects.toMatchObject({ code: 'PAYMENT_NOT_VERIFIED' });
  });
});

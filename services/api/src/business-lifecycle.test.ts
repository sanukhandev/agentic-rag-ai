import { describe, expect, it } from 'vitest';
import { createApprovedQuote, createContractDraft, createInvoiceDraft, confirmPackageSelection, listEligiblePackages, proposeAccountConversion, proposePackageSelection } from './business-lifecycle.js';
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
    expect(invoice.status).toBe('pending');
    await expect(createContractDraft(store, session, opportunityId, selection.id, invoice.id)).rejects.toMatchObject({ code: 'PAYMENT_NOT_VERIFIED' });
  });

  it('proposes Account conversion after qualification and verified Lead, before package selection', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANCFZ', slug: 'anc-account' });
    const session = await store.createSession(tenant.id);
    const catalog = await store.createIntentCatalogVersion({ tenantId: tenant.id, status: 'published', sourceFileName: 'account-test.json', sourceHash: 'account-test', parserVersion: 'test', catalog: { tenantScope: 'anc-account', intents: [{ intentKey: 'account.registration', displayName: 'Account registration', description: 'Convert a verified Lead when configured.', category: 'sales', workflowKey: 'crm.account.convert', minimumScore: 0, confidenceThreshold: 0, confirmationRequired: false, active: true, priority: 1, versionNote: 'test' }], signals: [], slots: [], relations: [], workflowBindings: [{ workflowKey: 'crm.account.convert', n8nWorkflowId: 'ANCAccountConversionWF1', webhookPath: 'anc-account-conversion-wf-1', payloadContract: 'anc-account-conversion-v1', sideEffectClass: 'crm_write', active: true }], crmAccountConversionPolicies: [{ intentKey: 'account.registration', workflowKey: 'crm.account.convert', conversionRule: 'qualification_verified', active: true, notes: 'test' }] } });
    const opportunityId = '00000000-0000-4000-8000-000000000011';
    session.conversationState = { ...newConversationState(), catalogVersionId: catalog.id, selectedIntentKey: 'anc.setup.new_company', intentProgress: { ...newIntentProgress(), activeIntentKey: 'anc.setup.new_company', entries: { 'anc.setup.new_company': { intentKey: 'anc.setup.new_company', journeyId: opportunityId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: {}, slotProvenance: {}, revision: 1 } } } };
    const actionId = '00000000-0000-4000-8000-000000000012';
    await store.createAction({ id: actionId, tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'anc.setup.new_company', opportunityId, actionKey: 'anc.setup.new_company', actionRevision: 1, state: 'completed', idempotencyKey: 'account-lead', opaqueReference: 'account-lead-ref', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: { externalReference: 'lead' } });
    const leadId = '00000000-0000-4000-8000-000000000013';
    await store.createCrmLead({ id: leadId, tenantId: tenant.id, actionId, sessionId: session.id, intent: 'anc.setup.new_company', secondaryIntentKeys: [], intentScore: 90, intentConfidence: 0.9, catalogVersionId: null, score: 90, contactCompletenessScore: 100, validationPass: true, qualificationStatus: 'qualified', qualificationEvidence: { source: 'test-catalog' }, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, conversation: [], summary: null, summaryStatus: 'pending', leadId: '00Q-SANDBOX-LEAD', remoteCrm: 'salesforce-sandbox', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await store.createCrmLeadAssociation({ id: '00000000-0000-4000-8000-000000000014', tenantId: tenant.id, crmLeadId: leadId, actionId, sessionId: session.id, opportunityId, associationType: 'canonical', createdAt: new Date().toISOString() });
    const account = await proposeAccountConversion(store, session, opportunityId, 'qualification_verified');
    expect(account).toMatchObject({ leadId, opportunityId, status: 'pending', remoteAccountId: null });
    await expect(proposeAccountConversion(store, session, opportunityId, 'qualification_verified')).resolves.toMatchObject({ id: account.id });
  });
});

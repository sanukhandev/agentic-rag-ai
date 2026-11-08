import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createApprovedQuote, createContractDraft, createDevelopmentQuoteAfterLead, createInvoiceDraft, confirmPackageSelection, listEligiblePackages, proposeAccountConversion, proposePackageSelection, proposePackageSelectionAfterLead } from './business-lifecycle.js';
import type { CatalogV2Document } from './catalog-v2.js';
import { newConversationState, newIntentProgress } from './conversation-state.js';
import { MemoryStore } from './store-memory.js';

const v2Catalog = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as CatalogV2Document;

describe('verified business lifecycle gates', () => {
  it('lists and prices offerings pinned to a V2 catalog reference', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANCFZ', slug: 'anc' });
    const catalogVersionRef = 'anc:r2:' + 'a'.repeat(64);
    const catalog = await store.createIntentCatalogV2Version({ tenantId: tenant.id, status: 'published', sourceFileName: 'v2-test.json', sourceHash: 'v2-test', parserVersion: 'test', catalog: v2Catalog, catalogVersionRef });
    const session = await store.createSession(tenant.id);
    const opportunityId = '00000000-0000-4000-8000-000000000021';
    session.conversationState = { ...newConversationState(), catalogVersionId: catalog.id, selectedIntentKey: 'anc.company_formation', intentProgress: { ...newIntentProgress(), activeIntentKey: 'anc.company_formation', entries: { 'anc.company_formation': { intentKey: 'anc.company_formation', journeyId: opportunityId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: { business_activity: 'technology consulting' }, slotProvenance: {}, revision: 1 } } } };
    const offering = await store.createPackageOffering({ id: '00000000-0000-4000-8000-000000000022', tenantId: tenant.id, catalogVersionId: null, catalogVersionRef, packageKey: 'anc-v2-development', name: 'ANCFZ Development Package', eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 1, officeRequirement: 'shared', inclusions: ['development-only company formation fixture'], priceMinor: 250000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development fixture', requiredDocuments: [], exclusions: ['not an official ANCFZ price'], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['sandbox-pricebook-v1'], createdAt: new Date().toISOString() });
    await expect(listEligiblePackages(store, session)).resolves.toMatchObject([{ id: offering.id, catalogVersionRef }]);
    await store.createCrmAccount({ id: '00000000-0000-4000-8000-000000000023', tenantId: tenant.id, opportunityId, leadId: '00000000-0000-4000-8000-000000000024', remoteAccountId: '001-DEV', remoteContactId: '003-DEV', remoteOpportunityId: '006-DEV', status: 'verified', conversionRule: 'qualification_verified', verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const selection = await proposePackageSelection(store, session, opportunityId, offering.id);
    const quote = await createApprovedQuote(store, session, opportunityId, offering.id);
    expect(selection.packageOfferingId).toBe(offering.id);
    expect(quote).toMatchObject({ packageOfferingId: offering.id, amountMinor: 250000, currency: 'AED', sourceRefs: ['sandbox-pricebook-v1'] });
  });

  it('allows the local Lead-to-quote slice only after a verified CRM Lead and consent', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANCFZ', slug: 'anc-lead-quote' });
    const catalogVersionRef = 'anc:r2:' + 'c'.repeat(64);
    const catalog = await store.createIntentCatalogV2Version({ tenantId: tenant.id, status: 'published', sourceFileName: 'v2-test.json', sourceHash: 'v2-test', parserVersion: 'test', catalog: v2Catalog, catalogVersionRef });
    const opportunityId = '00000000-0000-4000-8000-000000000041';
    const session = await store.createSession(tenant.id);
    session.conversationState = { ...newConversationState(), catalogVersionId: catalog.id, selectedIntentKey: 'anc.company_formation', contactConsent: 'granted', intentProgress: { ...newIntentProgress(), activeIntentKey: 'anc.company_formation', entries: { 'anc.company_formation': { intentKey: 'anc.company_formation', journeyId: opportunityId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: {}, slotProvenance: {}, revision: 1 } } } };
    const offering = await store.createPackageOffering({ id: '00000000-0000-4000-8000-000000000042', tenantId: tenant.id, catalogVersionId: null, catalogVersionRef, packageKey: 'lead-quote-package', name: 'Lead Quote Package', eligibleEntityTypes: [], eligibleActivities: [], includedVisaQuantity: 1, officeRequirement: 'shared', inclusions: ['registration'], priceMinor: 100000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'development', requiredDocuments: [], exclusions: [], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['sandbox-pricebook-v1'], createdAt: new Date().toISOString() });
    await store.createCrmLead({ id: '00000000-0000-4000-8000-000000000043', tenantId: tenant.id, actionId: '00000000-0000-4000-8000-000000000044', sessionId: session.id, intent: 'anc.company_formation', secondaryIntentKeys: [], intentScore: 90, intentConfidence: 0.9, catalogVersionId: catalog.id, score: 90, contactCompletenessScore: 100, validationPass: true, qualificationStatus: 'qualified', qualificationEvidence: { source: 'test' }, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, conversation: [], summary: null, summaryStatus: 'pending', leadId: '00Q-LEAD-QUOTE', remoteCrm: 'salesforce-sandbox', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const selection = await proposePackageSelectionAfterLead(store, session, offering.id);
    const quote = await createDevelopmentQuoteAfterLead(store, session, offering.id);
    expect(selection.packageOfferingId).toBe(offering.id);
    expect(quote).toMatchObject({ opportunityId, packageOfferingId: offering.id, amountMinor: 100000, sourceRefs: ['sandbox-pricebook-v1', 'development-mock-quote'] });
  });

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
    await expect(proposePackageSelection(store, session, opportunityId, offering.id)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_VERIFIED' });
    await store.createCrmAccount({ id: '00000000-0000-4000-8000-000000000003', tenantId: tenant.id, opportunityId, leadId: '00000000-0000-4000-8000-000000000004', remoteAccountId: '001-TEST', remoteContactId: '003-TEST', remoteOpportunityId: '006-TEST', status: 'verified', conversionRule: 'qualification_verified', verifiedAt: new Date().toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
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

  it('uses the enabled V2 Account binding instead of the legacy conversion policy', async () => {
    const store = new MemoryStore();
    const tenant = await store.createTenant({ name: 'ANCFZ', slug: 'anc-account-v2' });
    const catalogDocument = structuredClone(v2Catalog);
    catalogDocument.sheets.ToolBindings = catalogDocument.sheets.ToolBindings.map((binding) => binding.toolKey === 'account.propose_creation' ? { ...binding, enabled: true } : binding);
    catalogDocument.sheets.WorkflowBindings = catalogDocument.sheets.WorkflowBindings.map((binding) => binding.workflowKey === 'crm.account.create' ? { ...binding, enabled: true, n8nWorkflowId: 'ANCAccountConversionWF1', webhookPath: 'anc-account-conversion-wf-1', payloadContract: 'anc-account-conversion-v1' } : binding);
    const catalog = await store.createIntentCatalogV2Version({ tenantId: tenant.id, status: 'published', sourceFileName: 'account-v2-test.json', sourceHash: 'account-v2-test', parserVersion: 'test', catalog: catalogDocument, catalogVersionRef: 'anc:r2:' + 'b'.repeat(64) });
    const session = await store.createSession(tenant.id);
    const opportunityId = '00000000-0000-4000-8000-000000000031';
    session.conversationState = { ...newConversationState(), catalogVersionId: catalog.id, selectedIntentKey: 'anc.company_formation', intentProgress: { ...newIntentProgress(), activeIntentKey: 'anc.company_formation', entries: { 'anc.company_formation': { intentKey: 'anc.company_formation', journeyId: opportunityId, status: 'active', completedRequirementKeys: [], currentRequirementKey: null, slotValues: {}, slotProvenance: {}, revision: 1 } } } };
    const actionId = '00000000-0000-4000-8000-000000000032';
    await store.createAction({ id: actionId, tenantId: tenant.id, sessionId: session.id, workflowKey: 'crm.lead.create', intentKey: 'anc.company_formation', opportunityId, actionKey: 'lead.create', actionRevision: 1, state: 'completed', idempotencyKey: 'account-v2-lead', opaqueReference: 'account-v2-lead-ref', payload: { contactConsent: true }, createdAt: new Date().toISOString(), result: { externalReference: 'lead' } });
    const leadId = '00000000-0000-4000-8000-000000000033';
    await store.createCrmLead({ id: leadId, tenantId: tenant.id, actionId, sessionId: session.id, intent: 'anc.company_formation', secondaryIntentKeys: [], intentScore: 90, intentConfidence: 0.9, catalogVersionId: null, score: 90, contactCompletenessScore: 100, validationPass: true, qualificationStatus: 'qualified', qualificationEvidence: { source: 'test-catalog-v2' }, leadData: { name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, conversation: [], summary: null, summaryStatus: 'pending', leadId: '00Q-SANDBOX-LEAD-V2', remoteCrm: 'salesforce-sandbox', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await store.createCrmLeadAssociation({ id: '00000000-0000-4000-8000-000000000034', tenantId: tenant.id, crmLeadId: leadId, actionId, sessionId: session.id, opportunityId, associationType: 'canonical', createdAt: new Date().toISOString() });
    await expect(proposeAccountConversion(store, session, opportunityId, 'qualification_verified')).resolves.toMatchObject({ leadId, opportunityId, status: 'pending', conversionRule: 'qualification_verified' });
  });
});

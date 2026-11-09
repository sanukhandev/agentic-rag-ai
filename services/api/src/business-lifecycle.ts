import { randomUUID } from 'node:crypto';
import type { Contract, CrmAccount, CrmAccountConversionRule, Invoice, PackageOffering, PackageSelection, Quote, Session, Store } from './types.js';
import { HttpError } from './http/errors.js';

const now = (): string => new Date().toISOString();

export const activeOpportunityId = (session: Session): string | null => {
  const state = session.conversationState;
  const intentKey = state?.activeFollowUpIntentKey ?? state?.intentProgress?.activeIntentKey ?? state?.selectedIntentKey;
  return intentKey ? state?.intentProgress?.entries[intentKey]?.journeyId ?? null : null;
};

const requireOpportunity = (session: Session, opportunityId: string): void => {
  if (activeOpportunityId(session) !== opportunityId) throw new HttpError(409, 'OPPORTUNITY_NOT_ACTIVE', 'This request is not the active business opportunity.');
};

const requireVerifiedAccount = async (store: Store, session: Session, opportunityId: string): Promise<CrmAccount> => {
  const account = await store.getCrmAccountByOpportunity(opportunityId, session.tenantId);
  if (!account || account.status !== 'verified' || !account.remoteAccountId || !account.remoteContactId || !account.remoteOpportunityId) throw new HttpError(409, 'ACCOUNT_NOT_VERIFIED', 'A verified Account, Contact and Opportunity are required before package selection.');
  return account;
};

const pinnedPackageScope = async (store: Store, session: Session): Promise<{ catalogVersionId?: string | null; catalogVersionRef?: string }> => {
  const catalogVersionId = session.conversationState?.catalogVersionId ?? null;
  if (catalogVersionId) {
    const v2 = await store.getIntentCatalogV2Version(session.tenantId, catalogVersionId);
    if (v2) return { catalogVersionRef: v2.catalogVersionRef };
  }
  return { catalogVersionId };
};

const requireApprovedPackage = async (store: Store, session: Session, packageOfferingId: string): Promise<PackageOffering> => {
  const offering = await store.getPackageOffering(packageOfferingId, session.tenantId);
  if (!offering || offering.approvalStatus !== 'approved') throw new HttpError(409, 'PACKAGE_NOT_ELIGIBLE', 'That package is not approved for this tenant and opportunity.');
  const scope = await pinnedPackageScope(store, session);
  if (scope.catalogVersionRef && offering.catalogVersionRef !== scope.catalogVersionRef) throw new HttpError(409, 'PACKAGE_CATALOG_MISMATCH', 'That package is not part of the session-pinned catalog.');
  if (!scope.catalogVersionRef && scope.catalogVersionId !== undefined && offering.catalogVersionId !== scope.catalogVersionId) throw new HttpError(409, 'PACKAGE_CATALOG_MISMATCH', 'That package is not part of the session-pinned catalog.');
  return offering;
};

export type AccountConversionBinding = { workflowKey: string; webhookPath: string; intentKey: string; actionKey: string; catalogVersionId: string };

export type V2LifecycleActionBinding = AccountConversionBinding & { stageKey: string; providerType: string };

export const v2LifecycleActionBinding = async (store: Store, session: Session, toolKey: string, stageKey: string): Promise<V2LifecycleActionBinding | null> => {
  const catalogVersionId = session.conversationState?.catalogVersionId;
  if (!catalogVersionId) return null;
  const version = await store.getIntentCatalogV2Version(session.tenantId, catalogVersionId);
  if (!version) return null;
  const goalKey = session.conversationState?.intentProgress?.activeIntentKey ?? session.conversationState?.selectedIntentKey;
  const tool = version.catalog.sheets.ToolBindings.find((candidate) => candidate.toolKey === toolKey
    && candidate.goalKey === goalKey && candidate.stageKey === stageKey && candidate.enabled && candidate.sideEffectClass !== 'read_only' && candidate.registryKey);
  const workflow = tool ? version.catalog.sheets.WorkflowBindings.find((candidate) => candidate.registryKey === tool.registryKey && candidate.enabled && candidate.webhookPath) : null;
  return tool && workflow ? { workflowKey: workflow.registryKey, webhookPath: workflow.webhookPath!, intentKey: tool.goalKey, actionKey: tool.toolKey, catalogVersionId: version.catalogVersionRef, stageKey, providerType: workflow.providerType } : null;
};

export const accountConversionBinding = async (store: Store, session: Session, conversionRule: CrmAccountConversionRule): Promise<AccountConversionBinding | null> => {
  const catalogVersionId = session.conversationState?.catalogVersionId;
  if (!catalogVersionId) return null;
  const v2 = await store.getIntentCatalogV2Version(session.tenantId, catalogVersionId);
  if (v2) {
    if (conversionRule !== 'qualification_verified') return null;
    const goalKey = session.conversationState?.intentProgress?.activeIntentKey ?? session.conversationState?.selectedIntentKey;
    const tool = v2.catalog.sheets.ToolBindings.find((candidate) => candidate.goalKey === goalKey && candidate.stageKey === 'account_creation' && candidate.enabled && candidate.sideEffectClass !== 'read_only' && candidate.registryKey === 'crm.account.create');
    const workflow = tool ? v2.catalog.sheets.WorkflowBindings.find((candidate) => candidate.registryKey === tool.registryKey && candidate.enabled && candidate.webhookPath) : null;
    return tool && workflow ? { workflowKey: workflow.registryKey, webhookPath: workflow.webhookPath!, intentKey: tool.goalKey, actionKey: tool.toolKey, catalogVersionId: v2.catalogVersionRef } : null;
  }
  const catalog = await store.getIntentCatalogVersion(session.tenantId, catalogVersionId);
  const policy = catalog?.catalog.crmAccountConversionPolicies?.find((candidate) => candidate.intentKey === 'account.registration' && candidate.workflowKey === 'crm.account.convert' && candidate.conversionRule === conversionRule && candidate.active);
  return policy ? { workflowKey: policy.workflowKey, webhookPath: 'anc-account-conversion-wf-1', intentKey: policy.intentKey, actionKey: policy.intentKey, catalogVersionId } : null;
};

export const listEligiblePackages = async (store: Store, session: Session): Promise<PackageOffering[]> => {
  const state = session.conversationState;
  const scope = await pinnedPackageScope(store, session);
  const entry = state?.selectedIntentKey ? state.intentProgress?.entries[state.selectedIntentKey] : null;
  const values = { ...(state?.slotValues ?? {}), ...(entry?.slotValues ?? {}) };
  return store.listPackageOfferings(session.tenantId, {
    ...scope,
    ...(values.business_activity ? { activity: values.business_activity } : {}),
    ...(values.entity_type ? { entityType: values.entity_type } : {}),
  });
};

export const createApprovedQuote = async (store: Store, session: Session, opportunityId: string, packageOfferingId: string): Promise<Quote> => {
  requireOpportunity(session, opportunityId);
  await requireVerifiedAccount(store, session, opportunityId);
  const offering = await requireApprovedPackage(store, session, packageOfferingId);
  if (offering.priceMinor === null || !offering.currency) throw new HttpError(409, 'AUTHORITATIVE_PRICE_UNAVAILABLE', 'An approved price is not available for that package yet.');
  const nowMs = Date.now();
  if (offering.pricingEffectiveFrom && Date.parse(offering.pricingEffectiveFrom) > nowMs) throw new HttpError(409, 'PRICE_NOT_ACTIVE', 'The package price is not effective yet.');
  if (offering.pricingEffectiveTo && Date.parse(offering.pricingEffectiveTo) <= nowMs) throw new HttpError(409, 'PRICE_EXPIRED', 'The package price has expired.');
  return store.createQuote({ id: randomUUID(), tenantId: session.tenantId, opportunityId, packageOfferingId, amountMinor: offering.priceMinor, currency: offering.currency, validUntil: new Date(nowMs + 7 * 24 * 60 * 60 * 1_000).toISOString(), status: 'approved', sourceRefs: offering.sourceRefs, createdAt: now() });
};

/** Development-only quote creation after the verified CRM Lead gate. */
export const createDevelopmentQuoteAfterLead = async (store: Store, session: Session, packageOfferingId: string): Promise<Quote> => {
  const opportunityId = activeOpportunityId(session);
  if (!opportunityId) throw new HttpError(409, 'OPPORTUNITY_NOT_ACTIVE', 'This chat has no active company-formation opportunity.');
  const lead = await store.getCrmLeadBySessionId(session.id, session.tenantId);
  if (!lead?.leadId || !lead.remoteCrm) throw new HttpError(409, 'LEAD_NOT_VERIFIED', 'The CRM Lead must be created and verified before quote generation.');
  if (session.conversationState?.contactConsent !== 'granted') throw new HttpError(409, 'LEAD_CONSENT_REQUIRED', 'Contact consent is required before quote generation.');
  const offering = await requireApprovedPackage(store, session, packageOfferingId);
  if (offering.priceMinor === null || !offering.currency) throw new HttpError(409, 'AUTHORITATIVE_PRICE_UNAVAILABLE', 'An approved price is not available for that package yet.');
  const nowMs = Date.now();
  if (offering.pricingEffectiveFrom && Date.parse(offering.pricingEffectiveFrom) > nowMs) throw new HttpError(409, 'PRICE_NOT_ACTIVE', 'The package price is not effective yet.');
  if (offering.pricingEffectiveTo && Date.parse(offering.pricingEffectiveTo) <= nowMs) throw new HttpError(409, 'PRICE_EXPIRED', 'The package price has expired.');
  return store.createQuote({ id: randomUUID(), tenantId: session.tenantId, opportunityId, packageOfferingId: offering.id, amountMinor: offering.priceMinor, currency: offering.currency, validUntil: new Date(nowMs + 7 * 24 * 60 * 60 * 1_000).toISOString(), status: 'approved', sourceRefs: [...offering.sourceRefs, 'development-mock-quote'], createdAt: now() });
};

export const proposePackageSelection = async (store: Store, session: Session, opportunityId: string, packageOfferingId: string): Promise<PackageSelection> => {
  requireOpportunity(session, opportunityId);
  await requireVerifiedAccount(store, session, opportunityId);
  await requireApprovedPackage(store, session, packageOfferingId);
  return store.createPackageSelection({ id: randomUUID(), tenantId: session.tenantId, sessionId: session.id, opportunityId, packageOfferingId, quoteId: null, status: 'proposed', confirmedAt: null, createdAt: now(), updatedAt: now() });
};

/** Development-only package path for the requested Lead → quote slice. */
export const proposePackageSelectionAfterLead = async (store: Store, session: Session, packageOfferingId: string): Promise<PackageSelection> => {
  const opportunityId = activeOpportunityId(session);
  if (!opportunityId) throw new HttpError(409, 'OPPORTUNITY_NOT_ACTIVE', 'This chat has no active company-formation opportunity.');
  const lead = await store.getCrmLeadBySessionId(session.id, session.tenantId);
  if (!lead?.leadId || !lead.remoteCrm) throw new HttpError(409, 'LEAD_NOT_VERIFIED', 'The CRM Lead must be created and verified before package selection.');
  if (session.conversationState?.contactConsent !== 'granted') throw new HttpError(409, 'LEAD_CONSENT_REQUIRED', 'Contact consent is required before package selection.');
  const offering = await requireApprovedPackage(store, session, packageOfferingId);
  const existing = (await store.listPackageSelections(session.tenantId, opportunityId)).find((selection) => selection.packageOfferingId === offering.id && selection.status !== 'rejected');
  if (existing) return existing;
  return store.createPackageSelection({ id: randomUUID(), tenantId: session.tenantId, sessionId: session.id, opportunityId, packageOfferingId: offering.id, quoteId: null, status: 'proposed', confirmedAt: null, createdAt: now(), updatedAt: now() });
};

export const confirmPackageSelection = async (store: Store, session: Session, selectionId: string, quoteId: string): Promise<PackageSelection> => {
  const selection = await store.getPackageSelection(selectionId, session.tenantId);
  if (!selection) throw new HttpError(404, 'PACKAGE_SELECTION_NOT_FOUND', 'Package selection not found.');
  requireOpportunity(session, selection.opportunityId);
  const quote = await store.getQuote(quoteId, session.tenantId);
  if (!quote || quote.opportunityId !== selection.opportunityId || quote.packageOfferingId !== selection.packageOfferingId || quote.status !== 'approved' || Date.parse(quote.validUntil) <= Date.now()) throw new HttpError(409, 'QUOTE_NOT_VALID', 'The approved quote is missing, expired or does not match this package selection.');
  const confirmed = await store.confirmPackageSelection(selection.id, session.tenantId, quote.id);
  if (!confirmed) throw new HttpError(409, 'PACKAGE_SELECTION_NOT_CONFIRMABLE', 'This package selection is no longer confirmable.');
  return confirmed;
};

export const proposeAccountConversion = async (store: Store, session: Session, opportunityId: string, conversionRule: CrmAccountConversionRule): Promise<CrmAccount> => {
  requireOpportunity(session, opportunityId);
  if (!await accountConversionBinding(store, session, conversionRule)) throw new HttpError(409, 'ACCOUNT_CONVERSION_NOT_CONFIGURED', 'Account conversion is not enabled for this catalog and conversion rule.');
  const existing = await store.getCrmAccountByOpportunity(opportunityId, session.tenantId);
  if (existing) return existing;
  const actions = await store.listActionsBySession(session.id, session.tenantId);
  const leadAction = actions.find((action) => action.opportunityId === opportunityId && action.workflowKey !== 'crm.account.convert');
  const association = leadAction ? await store.getCrmLeadAssociationByActionId(leadAction.id, session.tenantId) : null;
  const lead = association ? await store.getCrmLead(association.crmLeadId, session.tenantId) : await store.getCrmLeadBySessionId(session.id, session.tenantId);
  if (!lead?.leadId || !lead.remoteCrm) throw new HttpError(409, 'LEAD_NOT_VERIFIED', 'A verified remote Lead is required before Account conversion.');
  if (lead.qualificationStatus !== 'qualified') throw new HttpError(409, 'QUALIFICATION_NOT_VERIFIED', 'Server-verified qualification is required before Account conversion.');
  const confirmedSelection = (await store.listPackageSelections(session.tenantId, opportunityId)).find((selection) => selection.status === 'confirmed');
  if (conversionRule === 'package_confirmed' && !confirmedSelection) throw new HttpError(409, 'PACKAGE_NOT_CONFIRMED', 'The package must be confirmed before Account conversion can be proposed.');
  if (conversionRule === 'invoice_paid') {
    if (!confirmedSelection) throw new HttpError(409, 'PACKAGE_NOT_CONFIRMED', 'The package must be confirmed before Account conversion can be proposed.');
    const quote = confirmedSelection.quoteId ? await store.getQuote(confirmedSelection.quoteId, session.tenantId) : null;
    const invoice = quote ? await store.getInvoiceByQuote(quote.id, session.tenantId) : null;
    if (!invoice || invoice.status !== 'paid') throw new HttpError(409, 'PAYMENT_NOT_VERIFIED', 'The configured Account conversion rule requires a verified paid invoice.');
  }
  return store.createCrmAccount({ id: randomUUID(), tenantId: session.tenantId, opportunityId, leadId: lead.id, remoteAccountId: null, remoteContactId: null, remoteOpportunityId: null, status: 'pending', conversionRule, verifiedAt: null, createdAt: now(), updatedAt: now() });
};

export const createInvoiceDraft = async (store: Store, session: Session, opportunityId: string, quoteId: string): Promise<Invoice> => {
  requireOpportunity(session, opportunityId);
  await requireVerifiedAccount(store, session, opportunityId);
  const quote = await store.getQuote(quoteId, session.tenantId);
  if (!quote || quote.opportunityId !== opportunityId || quote.status !== 'approved' || Date.parse(quote.validUntil) <= Date.now()) throw new HttpError(409, 'QUOTE_NOT_VALID', 'An active approved quote is required before invoice creation.');
  const selection = (await store.listPackageSelections(session.tenantId, opportunityId)).find((candidate) => candidate.quoteId === quote.id && candidate.status === 'confirmed');
  if (!selection) throw new HttpError(409, 'PACKAGE_NOT_CONFIRMED', 'The package must be explicitly confirmed before invoice creation.');
  return store.createInvoice({ id: randomUUID(), tenantId: session.tenantId, opportunityId, quoteId: quote.id, externalInvoiceId: null, amountMinor: quote.amountMinor, currency: quote.currency, paymentUrl: null, status: 'pending', provider: 'sandbox-pending', createdAt: now(), updatedAt: now() });
};

export const createContractDraft = async (store: Store, session: Session, opportunityId: string, selectionId: string, invoiceId: string): Promise<Contract> => {
  requireOpportunity(session, opportunityId);
  const selection = await store.getPackageSelection(selectionId, session.tenantId);
  if (!selection || selection.opportunityId !== opportunityId || selection.status !== 'confirmed') throw new HttpError(409, 'PACKAGE_NOT_CONFIRMED', 'The package must be confirmed before preparing a contract.');
  const invoice = await store.getInvoice(invoiceId, session.tenantId);
  if (!invoice || invoice.opportunityId !== opportunityId || invoice.status !== 'paid') throw new HttpError(409, 'PAYMENT_NOT_VERIFIED', 'A verified paid invoice is required before contract preparation.');
  const account: CrmAccount | null = await store.getCrmAccountByOpportunity(opportunityId, session.tenantId);
  if (account && account.status !== 'verified') throw new HttpError(409, 'ACCOUNT_NOT_VERIFIED', 'The Salesforce Account conversion has not been verified for this opportunity.');
  return store.createContract({ id: randomUUID(), tenantId: session.tenantId, opportunityId, packageSelectionId: selection.id, invoiceId: invoice?.id ?? null, externalContractId: null, templateKey: 'ancfz-company-formation-v1', signingUrl: null, status: 'draft', provider: 'sandbox-pending', createdAt: now(), updatedAt: now() });
};

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

export const listEligiblePackages = async (store: Store, session: Session): Promise<PackageOffering[]> => {
  const state = session.conversationState;
  return store.listPackageOfferings(session.tenantId, {
    catalogVersionId: state?.catalogVersionId ?? null,
    ...(state?.slotValues.business_activity ? { activity: state.slotValues.business_activity } : {}),
    ...(state?.slotValues.entity_type ? { entityType: state.slotValues.entity_type } : {}),
  });
};

export const createApprovedQuote = async (store: Store, session: Session, opportunityId: string, packageOfferingId: string): Promise<Quote> => {
  requireOpportunity(session, opportunityId);
  const offering = await store.getPackageOffering(packageOfferingId, session.tenantId);
  if (!offering || offering.approvalStatus !== 'approved') throw new HttpError(409, 'PACKAGE_NOT_ELIGIBLE', 'That package is not approved for this tenant and opportunity.');
  if (offering.priceMinor === null || !offering.currency) throw new HttpError(409, 'AUTHORITATIVE_PRICE_UNAVAILABLE', 'An approved price is not available for that package yet.');
  const nowMs = Date.now();
  if (offering.pricingEffectiveFrom && Date.parse(offering.pricingEffectiveFrom) > nowMs) throw new HttpError(409, 'PRICE_NOT_ACTIVE', 'The package price is not effective yet.');
  if (offering.pricingEffectiveTo && Date.parse(offering.pricingEffectiveTo) <= nowMs) throw new HttpError(409, 'PRICE_EXPIRED', 'The package price has expired.');
  return store.createQuote({ id: randomUUID(), tenantId: session.tenantId, opportunityId, packageOfferingId, amountMinor: offering.priceMinor, currency: offering.currency, validUntil: new Date(nowMs + 7 * 24 * 60 * 60 * 1_000).toISOString(), status: 'approved', sourceRefs: offering.sourceRefs, createdAt: now() });
};

export const proposePackageSelection = async (store: Store, session: Session, opportunityId: string, packageOfferingId: string): Promise<PackageSelection> => {
  requireOpportunity(session, opportunityId);
  const offering = await store.getPackageOffering(packageOfferingId, session.tenantId);
  if (!offering || offering.approvalStatus !== 'approved') throw new HttpError(409, 'PACKAGE_NOT_ELIGIBLE', 'That package is not approved for this tenant and opportunity.');
  return store.createPackageSelection({ id: randomUUID(), tenantId: session.tenantId, sessionId: session.id, opportunityId, packageOfferingId, quoteId: null, status: 'proposed', confirmedAt: null, createdAt: now(), updatedAt: now() });
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
  const catalogVersionId = session.conversationState?.catalogVersionId;
  const catalog = catalogVersionId ? await store.getIntentCatalogVersion(session.tenantId, catalogVersionId) : null;
  const conversionPolicy = catalog?.catalog.crmAccountConversionPolicies?.find((policy) => policy.intentKey === 'account.registration' && policy.workflowKey === 'crm.account.convert' && policy.conversionRule === conversionRule && policy.active);
  if (!conversionPolicy) throw new HttpError(409, 'ACCOUNT_CONVERSION_NOT_CONFIGURED', 'Account conversion is not enabled for this catalog and conversion rule.');
  const confirmedSelection = (await store.listPackageSelections(session.tenantId, opportunityId)).find((selection) => selection.status === 'confirmed');
  if (!confirmedSelection) throw new HttpError(409, 'PACKAGE_NOT_CONFIRMED', 'The package must be confirmed before Account conversion can be proposed.');
  if (conversionRule === 'invoice_paid') {
    const quote = confirmedSelection.quoteId ? await store.getQuote(confirmedSelection.quoteId, session.tenantId) : null;
    const invoice = quote ? await store.getInvoiceByQuote(quote.id, session.tenantId) : null;
    if (!invoice || invoice.status !== 'paid') throw new HttpError(409, 'PAYMENT_NOT_VERIFIED', 'The configured Account conversion rule requires a verified paid invoice.');
  }
  const existing = await store.getCrmAccountByOpportunity(opportunityId, session.tenantId);
  if (existing) return existing;
  const actions = await store.listActionsBySession(session.id, session.tenantId);
  const leadAction = actions.find((action) => action.opportunityId === opportunityId && action.workflowKey !== 'crm.account.convert');
  const association = leadAction ? await store.getCrmLeadAssociationByActionId(leadAction.id, session.tenantId) : null;
  const lead = association ? await store.getCrmLead(association.crmLeadId, session.tenantId) : await store.getCrmLeadBySessionId(session.id, session.tenantId);
  if (!lead?.leadId || !lead.remoteCrm) throw new HttpError(409, 'LEAD_NOT_VERIFIED', 'A verified remote Lead is required before Account conversion.');
  return store.createCrmAccount({ id: randomUUID(), tenantId: session.tenantId, opportunityId, leadId: lead.id, remoteAccountId: null, remoteContactId: null, remoteOpportunityId: null, status: 'pending', conversionRule, verifiedAt: null, createdAt: now(), updatedAt: now() });
};

export const createInvoiceDraft = async (store: Store, session: Session, opportunityId: string, quoteId: string): Promise<Invoice> => {
  requireOpportunity(session, opportunityId);
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

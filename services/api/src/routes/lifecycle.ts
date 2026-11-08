import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { LifecycleStage, Session, Store } from '../types.js';
import type { ActionGateway } from '../actions.js';
import { parse, HttpError } from '../http/errors.js';
import { lifecycleAccountProposalSchema, lifecycleContractSchema, lifecycleInvoiceSchema, lifecyclePackageProposalSchema, lifecyclePackageSelectionSchema, lifecyclePaymentSchema, lifecycleQuoteSchema, lifecycleSelectionConfirmationSchema } from '../http/schemas.js';
import { accountConversionBinding, activeOpportunityId, confirmPackageSelection, createApprovedQuote, createContractDraft, createInvoiceDraft, listEligiblePackages, proposeAccountConversion, proposePackageSelection, proposePackageSelectionAfterLead, v2LifecycleActionBinding } from '../business-lifecycle.js';

export interface LifecycleRouteDependencies {
  store: Store;
  gateway: ActionGateway;
  chatApi: RequestHandler;
  routeParam: (req: Request, name: string) => string;
  authorizeSession: (req: Request, session: Session) => Promise<void>;
  advanceLifecycleStage: (session: Session, stage: LifecycleStage, evidence: Record<string, string | number | boolean>) => Promise<void>;
}

export const registerLifecycleRoutes = (app: Pick<Application, 'get' | 'post'>, dependencies: LifecycleRouteDependencies): void => {
  const loadSession = async (req: Request): Promise<Session> => {
    const session = await dependencies.store.getSession(dependencies.routeParam(req, 'id'));
    if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found.');
    await dependencies.authorizeSession(req, session);
    return session;
  };
  app.get('/api/v1/chat/sessions/:id/packages', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try { const session = await loadSession(req); res.json({ opportunityId: activeOpportunityId(session), items: await listEligiblePackages(dependencies.store, session) }); } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/packages/proposals', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try { const session = await loadSession(req); const input = parse(lifecyclePackageProposalSchema, req.body); const selection = await proposePackageSelection(dependencies.store, session, input.opportunityId, input.packageOfferingId); res.status(201).json({ selection }); } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/packages/select', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await loadSession(req);
      const input = parse(lifecyclePackageSelectionSchema, req.body);
      const offering = (await listEligiblePackages(dependencies.store, session)).find((candidate) => candidate.packageKey === input.packageKey);
      if (!offering) throw new HttpError(409, 'PACKAGE_NOT_ELIGIBLE', 'That package is not available in the approved catalog for this conversation.');
      const selection = await proposePackageSelectionAfterLead(dependencies.store, session, offering.id);
      const binding = await v2LifecycleActionBinding(dependencies.store, session, 'package.confirm', 'package_selection');
      if (!binding) throw new HttpError(409, 'PACKAGE_WORKFLOW_NOT_CONFIGURED', 'The approved package quote workflow is not enabled for this tenant.');
      const action = await dependencies.gateway.propose(session.tenantId, session.id, `package-confirm:${selection.id}`, {
        contactConsent: true,
        interest: binding.intentKey,
        slotValues: { packageKey: offering.packageKey, packageOfferingId: offering.id, selectionId: selection.id, packageConfirmation: 'true', packageActionConsent: 'true' },
      }, { workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, intentKey: binding.intentKey, catalogVersionId: binding.catalogVersionId, opportunityId: selection.opportunityId, actionKey: binding.actionKey, actionRevision: 1 });
      const approved = action.state === 'awaiting_confirmation' ? await dependencies.gateway.confirm(action.id, session.tenantId, session) : action;
      res.status(202).json({ selection, package: offering, action: approved });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/packages/quotes', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await loadSession(req);
      const input = parse(lifecycleQuoteSchema, req.body);
      const pinnedV2 = session.conversationState?.catalogVersionId
        ? await dependencies.store.getIntentCatalogV2Version(session.tenantId, session.conversationState.catalogVersionId)
        : null;
      if (pinnedV2) {
        const offering = (await listEligiblePackages(dependencies.store, session)).find((candidate) => candidate.id === input.packageOfferingId);
        if (!offering) throw new HttpError(409, 'PACKAGE_NOT_ELIGIBLE', 'That package is not available in the approved catalog for this conversation.');
        const selection = (await dependencies.store.listPackageSelections(session.tenantId, input.opportunityId)).find((candidate) => candidate.packageOfferingId === offering.id && candidate.status === 'confirmed' && candidate.quoteId);
        if (!selection?.quoteId) throw new HttpError(409, 'QUOTE_WORKFLOW_REQUIRED', 'A V2 quote is created only by the confirmed package workflow.');
        const quote = await dependencies.store.getQuote(selection.quoteId, session.tenantId);
        if (!quote || quote.opportunityId !== input.opportunityId || quote.packageOfferingId !== offering.id || quote.status !== 'approved' || Date.parse(quote.validUntil) <= Date.now()) throw new HttpError(409, 'QUOTE_NOT_VALID', 'The approved quote is missing, expired or does not match this package selection.');
        res.status(200).json({ quote });
        return;
      }
      const quote = await createApprovedQuote(dependencies.store, session, input.opportunityId, input.packageOfferingId);
      res.status(201).json({ quote });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/packages/selections/:selectionId/confirm', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try { const session = await loadSession(req); const input = parse(lifecycleSelectionConfirmationSchema, req.body); const selection = await confirmPackageSelection(dependencies.store, session, dependencies.routeParam(req, 'selectionId'), input.quoteId); await dependencies.advanceLifecycleStage(session, 'package_selection', { selectionId: selection.id, quoteId: input.quoteId, packageConfirmed: true }); res.json({ selection }); } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/accounts/proposals', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await loadSession(req);
      const input = parse(lifecycleAccountProposalSchema, req.body);
      const account = await proposeAccountConversion(dependencies.store, session, input.opportunityId, input.conversionRule);
      if (account.status === 'verified') { res.status(200).json({ account, verified: true }); return; }
      const binding = await accountConversionBinding(dependencies.store, session, input.conversionRule);
      if (!binding) throw new HttpError(409, 'ACCOUNT_CONVERSION_NOT_CONFIGURED', 'Account conversion is not enabled for this catalog and conversion rule.');
      const action = await dependencies.gateway.propose(session.tenantId, session.id, `crm-account:${account.id}`, { contactConsent: true, slotValues: { crmAccountId: account.id } }, { workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, intentKey: binding.intentKey, actionKey: binding.actionKey, catalogVersionId: binding.catalogVersionId, opportunityId: input.opportunityId });
      res.status(202).json({ account, verified: false, actionProposal: { id: action.id, state: action.state } });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/sessions/:id/accounts', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try { const session = await loadSession(req); const opportunityId = activeOpportunityId(session); if (!opportunityId) throw new HttpError(409, 'OPPORTUNITY_NOT_ACTIVE', 'This chat has no active business opportunity.'); const account = await dependencies.store.getCrmAccountByOpportunity(opportunityId, session.tenantId); if (!account) throw new HttpError(404, 'ACCOUNT_NOT_FOUND', 'No Account conversion has been proposed for this opportunity.'); res.json({ account, verified: account.status === 'verified' }); } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/invoices', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await loadSession(req);
      const input = parse(lifecycleInvoiceSchema, req.body);
      const binding = await v2LifecycleActionBinding(dependencies.store, session, 'invoice.issue', 'payment_invoice');
      const invoiceDocument = await dependencies.store.getUserIntentDocument(session.tenantId, session.id);
      if (invoiceDocument?.catalogSource === 'v2' && invoiceDocument.currentStageKey !== 'payment_invoice') throw new HttpError(409, 'V2_STAGE_MISMATCH', 'Invoice issuance is only available during the payment stage.');
      if (session.conversationState?.catalogVersionId && await dependencies.store.getIntentCatalogV2Version(session.tenantId, session.conversationState.catalogVersionId) && !binding) throw new HttpError(409, 'INVOICE_NOT_CONFIGURED', 'Invoice issuance is not enabled for this pinned catalog.');
      const invoice = await createInvoiceDraft(dependencies.store, session, input.opportunityId, input.quoteId);
      const action = binding
        ? await dependencies.gateway.propose(session.tenantId, session.id, `invoice:${invoice.id}`, { contactConsent: true, interest: binding.intentKey, slotValues: { invoiceId: invoice.id, quoteId: input.quoteId } }, { workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, intentKey: binding.intentKey, actionKey: binding.actionKey, catalogVersionId: binding.catalogVersionId, opportunityId: input.opportunityId })
        : await dependencies.gateway.propose(session.tenantId, session.id, `invoice:${invoice.id}`, { slotValues: { invoiceId: invoice.id } }, { workflowKey: 'finance.invoice.create', webhookPath: 'anc-invoice-generation-wf-1', intentKey: 'invoice.request', actionKey: 'invoice.request', catalogVersionId: session.conversationState?.catalogVersionId ?? null, opportunityId: input.opportunityId });
      res.status(202).json({ invoice, verified: invoice.status === 'paid', actionProposal: { id: action.id, state: action.state } });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/payments', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await loadSession(req);
      const input = parse(lifecyclePaymentSchema, req.body);
      const invoice = await dependencies.store.getInvoice(input.invoiceId, session.tenantId);
      if (!invoice || invoice.opportunityId !== input.opportunityId || invoice.status !== 'pending' || !invoice.externalInvoiceId || !invoice.paymentUrl) throw new HttpError(409, 'INVOICE_NOT_READY', 'A verified invoice with a hosted payment link is required before payment.');
      const binding = await v2LifecycleActionBinding(dependencies.store, session, 'payment.authorize', 'payment_invoice');
      if (!binding) throw new HttpError(409, 'PAYMENT_NOT_CONFIGURED', 'Payment authorization is not enabled for this pinned catalog.');
      const paymentDocument = await dependencies.store.getUserIntentDocument(session.tenantId, session.id);
      if (paymentDocument?.catalogSource === 'v2' && paymentDocument.currentStageKey !== 'payment_invoice') throw new HttpError(409, 'V2_STAGE_MISMATCH', 'Payment authorization is only available during the payment stage.');
      const action = await dependencies.gateway.propose(session.tenantId, session.id, `payment:${invoice.id}`, { contactConsent: true, interest: binding.intentKey, slotValues: { invoiceId: invoice.id, paymentConfirmation: 'true' } }, { workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, intentKey: binding.intentKey, actionKey: binding.actionKey, catalogVersionId: binding.catalogVersionId, opportunityId: input.opportunityId });
      res.status(202).json({ invoice, actionProposal: { id: action.id, state: action.state } });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/sessions/:id/invoices/:invoiceId', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try { const session = await loadSession(req); const invoice = await dependencies.store.getInvoice(dependencies.routeParam(req, 'invoiceId'), session.tenantId); if (!invoice || invoice.opportunityId !== activeOpportunityId(session)) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.'); res.json({ invoice, verified: invoice.status === 'paid' }); } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/contracts', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await loadSession(req);
      const input = parse(lifecycleContractSchema, req.body);
      const binding = await v2LifecycleActionBinding(dependencies.store, session, 'contract.send', 'contract');
      const contractDocument = await dependencies.store.getUserIntentDocument(session.tenantId, session.id);
      if (contractDocument?.catalogSource === 'v2' && contractDocument.currentStageKey !== 'contract') throw new HttpError(409, 'V2_STAGE_MISMATCH', 'Contract signing is only available during the contract stage.');
      if (session.conversationState?.catalogVersionId && await dependencies.store.getIntentCatalogV2Version(session.tenantId, session.conversationState.catalogVersionId) && !binding) throw new HttpError(409, 'CONTRACT_NOT_CONFIGURED', 'Contract signing is not enabled for this pinned catalog.');
      const contract = await createContractDraft(dependencies.store, session, input.opportunityId, input.packageSelectionId, input.invoiceId);
      const action = binding
        ? await dependencies.gateway.propose(session.tenantId, session.id, `contract:${contract.id}`, { contactConsent: true, interest: binding.intentKey, slotValues: { contractId: contract.id, packageSelectionId: input.packageSelectionId, invoiceId: input.invoiceId } }, { workflowKey: binding.workflowKey, webhookPath: binding.webhookPath, intentKey: binding.intentKey, actionKey: binding.actionKey, catalogVersionId: binding.catalogVersionId, opportunityId: input.opportunityId })
        : await dependencies.gateway.propose(session.tenantId, session.id, `contract:${contract.id}`, { slotValues: { contractId: contract.id } }, { workflowKey: 'legal.contract.prepare', webhookPath: 'anc-contract-preparation-wf-1', intentKey: 'contract.preparation', actionKey: 'contract.preparation', catalogVersionId: session.conversationState?.catalogVersionId ?? null, opportunityId: input.opportunityId });
      res.status(202).json({ contract, verified: contract.status === 'signed', actionProposal: { id: action.id, state: action.state } });
    } catch (error) { next(error); }
  });
};

import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import type { Session, Store } from '../types.js';
import type { ActionGateway } from '../actions.js';
import { parse, HttpError } from '../http/errors.js';
import { lifecycleAccountProposalSchema, lifecycleContractSchema, lifecycleInvoiceSchema, lifecyclePackageProposalSchema, lifecycleQuoteSchema, lifecycleSelectionConfirmationSchema } from '../http/schemas.js';
import { activeOpportunityId, confirmPackageSelection, createApprovedQuote, createContractDraft, createInvoiceDraft, listEligiblePackages, proposeAccountConversion, proposePackageSelection } from '../business-lifecycle.js';

export interface LifecycleRouteDependencies {
  store: Store;
  gateway: ActionGateway;
  chatApi: RequestHandler;
  routeParam: (req: Request, name: string) => string;
  authorizeSession: (req: Request, session: Session) => Promise<void>;
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
  app.post('/api/v1/chat/sessions/:id/packages/quotes', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try { const session = await loadSession(req); const input = parse(lifecycleQuoteSchema, req.body); const quote = await createApprovedQuote(dependencies.store, session, input.opportunityId, input.packageOfferingId); res.status(201).json({ quote }); } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/packages/selections/:selectionId/confirm', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try { const session = await loadSession(req); const input = parse(lifecycleSelectionConfirmationSchema, req.body); const selection = await confirmPackageSelection(dependencies.store, session, dependencies.routeParam(req, 'selectionId'), input.quoteId); res.json({ selection }); } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/accounts/proposals', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await loadSession(req);
      const input = parse(lifecycleAccountProposalSchema, req.body);
      const account = await proposeAccountConversion(dependencies.store, session, input.opportunityId, input.conversionRule);
      if (account.status === 'verified') { res.status(200).json({ account, verified: true }); return; }
      const action = await dependencies.gateway.propose(session.tenantId, session.id, `crm-account:${account.id}`, { contactConsent: true, slotValues: { crmAccountId: account.id } }, { workflowKey: 'crm.account.convert', webhookPath: 'anc-account-conversion-wf-1', intentKey: 'account.registration', actionKey: 'account.registration', catalogVersionId: session.conversationState?.catalogVersionId ?? null, opportunityId: input.opportunityId });
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
      const invoice = await createInvoiceDraft(dependencies.store, session, input.opportunityId, input.quoteId);
      const action = await dependencies.gateway.propose(session.tenantId, session.id, `invoice:${invoice.id}`, { slotValues: { invoiceId: invoice.id } }, { workflowKey: 'finance.invoice.create', webhookPath: 'anc-invoice-generation-wf-1', intentKey: 'invoice.request', actionKey: 'invoice.request', catalogVersionId: session.conversationState?.catalogVersionId ?? null, opportunityId: input.opportunityId });
      res.status(202).json({ invoice, verified: invoice.status === 'paid', actionProposal: { id: action.id, state: action.state } });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/chat/sessions/:id/invoices/:invoiceId', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try { const session = await loadSession(req); const invoice = await dependencies.store.getInvoice(dependencies.routeParam(req, 'invoiceId'), session.tenantId); if (!invoice || invoice.opportunityId !== activeOpportunityId(session)) throw new HttpError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.'); res.json({ invoice, verified: invoice.status === 'paid' }); } catch (error) { next(error); }
  });
  app.post('/api/v1/chat/sessions/:id/contracts', dependencies.chatApi, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await loadSession(req);
      const input = parse(lifecycleContractSchema, req.body);
      const contract = await createContractDraft(dependencies.store, session, input.opportunityId, input.packageSelectionId, input.invoiceId);
      const action = await dependencies.gateway.propose(session.tenantId, session.id, `contract:${contract.id}`, { slotValues: { contractId: contract.id } }, { workflowKey: 'legal.contract.prepare', webhookPath: 'anc-contract-preparation-wf-1', intentKey: 'contract.preparation', actionKey: 'contract.preparation', catalogVersionId: session.conversationState?.catalogVersionId ?? null, opportunityId: input.opportunityId });
      res.status(202).json({ contract, verified: contract.status === 'signed', actionProposal: { id: action.id, state: action.state } });
    } catch (error) { next(error); }
  });
};

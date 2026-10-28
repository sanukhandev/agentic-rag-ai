import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('invoice and contract provider callbacks', () => {
  it('keeps provider references and payment/signing state behind correlated actions', async () => {
    const runtime = createApp({ nodeEnv: 'test', n8nCallbackSecret: 'provider-secret' });
    const tenant = await runtime.store.createTenant({ name: 'Provider Tenant', slug: 'provider-tenant' });
    const session = await runtime.store.createSession(tenant.id);
    const opportunityId = '00000000-0000-4000-8000-000000000031';
    const invoiceId = '00000000-0000-4000-8000-000000000032';
    const invoiceActionId = '00000000-0000-4000-8000-000000000033';
    const selectionId = '00000000-0000-4000-8000-000000000034';
    const packageId = '00000000-0000-4000-8000-000000000035';
    const quoteId = '00000000-0000-4000-8000-000000000036';
    const accountId = '00000000-0000-4000-8000-000000000037';
    const leadId = '00000000-0000-4000-8000-000000000038';
    const contractId = '00000000-0000-4000-8000-000000000039';
    const contractActionId = '00000000-0000-4000-8000-000000000040';
    const now = new Date().toISOString();
    await runtime.store.createAction({ id: invoiceActionId, tenantId: tenant.id, sessionId: session.id, workflowKey: 'finance.invoice.create', intentKey: 'invoice.request', opportunityId, actionKey: 'invoice.request', actionRevision: 1, state: 'processing', idempotencyKey: 'invoice-provider-action', opaqueReference: 'invoice-provider-ref', payload: { slotValues: { invoiceId } }, createdAt: now, result: null });
    await runtime.store.createInvoice({ id: invoiceId, tenantId: tenant.id, opportunityId, quoteId, externalInvoiceId: null, amountMinor: 250000, currency: 'AED', paymentUrl: null, status: 'pending', provider: 'sandbox', createdAt: now, updatedAt: now });
    const api = request(runtime.app);
    const headers = { 'x-agentic-internal-secret': 'provider-secret' };
    await api.post(`/api/v1/internal/finance/invoices/${invoiceId}/remote-payload`).set(headers).send({ tenantId: tenant.id, actionId: invoiceActionId }).expect(200);
    await api.put(`/api/v1/internal/finance/invoices/${invoiceId}/remote`).set(headers).send({ tenantId: tenant.id, actionId: invoiceActionId, externalInvoiceId: 'INV-SANDBOX-1', paymentUrl: 'https://sandbox.invalid/pay/INV-SANDBOX-1', status: 'pending' }).expect(200);
    await api.put(`/api/v1/internal/finance/invoices/${invoiceId}/payment-status`).set(headers).send({ tenantId: tenant.id, actionId: invoiceActionId, externalInvoiceId: 'INV-WRONG', status: 'paid' }).expect(409);
    await api.put(`/api/v1/internal/finance/invoices/${invoiceId}/payment-status`).set(headers).send({ tenantId: tenant.id, actionId: invoiceActionId, externalInvoiceId: 'INV-SANDBOX-1', status: 'paid' }).expect(200);
    await runtime.store.createCrmLead({ id: leadId, tenantId: tenant.id, actionId: invoiceActionId, sessionId: session.id, intent: 'anc.setup.new_company', intentScore: 90, intentConfidence: 0.9, catalogVersionId: null, score: 90, validationPass: true, leadData: {}, conversation: [], summary: null, summaryStatus: 'pending', leadId: '00Q-SANDBOX-PROVIDER', remoteCrm: 'salesforce-sandbox', createdAt: now, updatedAt: now });
    await runtime.store.createCrmAccount({ id: accountId, tenantId: tenant.id, opportunityId, leadId, remoteAccountId: '001-SANDBOX-PROVIDER', remoteContactId: '003-SANDBOX-PROVIDER', remoteOpportunityId: '006-SANDBOX-PROVIDER', status: 'verified', conversionRule: 'package_confirmed', verifiedAt: now, createdAt: now, updatedAt: now });
    await runtime.store.createPackageSelection({ id: selectionId, tenantId: tenant.id, sessionId: session.id, opportunityId, packageOfferingId: packageId, quoteId, status: 'confirmed', confirmedAt: now, createdAt: now, updatedAt: now });
    await runtime.store.createContract({ id: contractId, tenantId: tenant.id, opportunityId, packageSelectionId: selectionId, invoiceId, externalContractId: null, templateKey: 'ancfz-company-formation-v1', signingUrl: null, status: 'draft', provider: 'sandbox', createdAt: now, updatedAt: now });
    await runtime.store.createAction({ id: contractActionId, tenantId: tenant.id, sessionId: session.id, workflowKey: 'legal.contract.prepare', intentKey: 'contract.preparation', opportunityId, actionKey: 'contract.preparation', actionRevision: 1, state: 'processing', idempotencyKey: 'contract-provider-action', opaqueReference: 'contract-provider-ref', payload: { slotValues: { contractId } }, createdAt: now, result: null });
    await api.post(`/api/v1/internal/contracts/${contractId}/remote-payload`).set(headers).send({ tenantId: tenant.id, actionId: contractActionId }).expect(200);
    await api.put(`/api/v1/internal/contracts/${contractId}/remote`).set(headers).send({ tenantId: tenant.id, actionId: contractActionId, externalContractId: 'CONTRACT-SANDBOX-1', signingUrl: 'https://sandbox.invalid/sign/CONTRACT-SANDBOX-1', status: 'sent' }).expect(200);
    expect((await runtime.store.getContract(contractId, tenant.id))?.status).toBe('sent');
  });
});

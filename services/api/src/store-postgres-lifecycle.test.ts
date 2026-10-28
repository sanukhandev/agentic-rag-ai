import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { PostgresStore } from './store-postgres.js';

describe.skipIf(!process.env.DATABASE_URL)('PostgresStore business lifecycle integration', () => {
  it('persists approved package, quote, confirmed selection, invoice and contract state', async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const store = new PostgresStore(pool);
    const tenant = await store.createTenant({ name: 'Lifecycle Integration', slug: `lifecycle-${randomUUID()}` });
    const session = await store.createSession(tenant.id);
    const opportunityId = randomUUID();
    const offering = await store.createPackageOffering({ id: randomUUID(), tenantId: tenant.id, catalogVersionId: null, packageKey: 'sandbox-standard', name: 'Sandbox Standard', eligibleEntityTypes: [], eligibleActivities: ['digital marketing'], includedVisaQuantity: 2, officeRequirement: 'shared', inclusions: ['registration'], priceMinor: 125000, currency: 'AED', pricingEffectiveFrom: null, pricingEffectiveTo: null, additionalFees: [], processingTime: 'sandbox', requiredDocuments: ['synthetic_passport'], exclusions: [], availability: 'development_only', approvalStatus: 'approved', sourceRefs: ['sandbox-pricebook-v1'], createdAt: new Date().toISOString() });
    try {
      expect(await store.listPackageOfferings(tenant.id)).toMatchObject([{ id: offering.id, priceMinor: 125000 }]);
      const quote = await store.createQuote({ id: randomUUID(), tenantId: tenant.id, opportunityId, packageOfferingId: offering.id, amountMinor: 125000, currency: 'AED', validUntil: new Date(Date.now() + 86_400_000).toISOString(), status: 'approved', sourceRefs: ['sandbox-pricebook-v1'], createdAt: new Date().toISOString() });
      const selection = await store.createPackageSelection({ id: randomUUID(), tenantId: tenant.id, sessionId: session.id, opportunityId, packageOfferingId: offering.id, quoteId: null, status: 'proposed', confirmedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      expect(await store.confirmPackageSelection(selection.id, tenant.id, quote.id)).toMatchObject({ status: 'confirmed', quoteId: quote.id });
      const invoice = await store.createInvoice({ id: randomUUID(), tenantId: tenant.id, opportunityId, quoteId: quote.id, externalInvoiceId: null, amountMinor: quote.amountMinor, currency: quote.currency, paymentUrl: null, status: 'draft', provider: 'sandbox-pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      const paid = await store.updateInvoice({ ...invoice, externalInvoiceId: 'sandbox-invoice', paymentUrl: 'https://sandbox.invalid/pay', status: 'paid', updatedAt: new Date().toISOString() });
      expect(paid.status).toBe('paid');
      expect(await store.createContract({ id: randomUUID(), tenantId: tenant.id, opportunityId, packageSelectionId: selection.id, invoiceId: invoice.id, externalContractId: null, templateKey: 'ancfz-company-formation-v1', signingUrl: null, status: 'draft', provider: 'sandbox-pending', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })).toMatchObject({ status: 'draft', invoiceId: invoice.id });
    } finally {
      await pool.query('DELETE FROM tenants WHERE id=$1', [tenant.id]);
      await pool.end();
    }
  }, 20_000);
});

import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { MockWorkflowAdapter } from './actions.js';

describe('published intent catalog runtime', () => {
  it('routes a scored lead intent to its approved workflow and preserves catalog metadata', async () => {
    const workflow = new MockWorkflowAdapter();
    const runtime = createApp({ nodeEnv: 'test', workflow, n8nCallbackSecret: 'crm-secret' });
    const api = request(runtime.app);
    const platform = await api.post('/api/v1/auth/register-platform').send({ email: 'platform-catalog@example.test', password: 'Platform1Password' }).expect(201);
    const tenant = await api.post('/api/v1/admin/tenants').set('Authorization', `Bearer ${platform.body.token}`).send({ name: 'Catalog Tenant', slug: 'catalog-tenant', adminEmail: 'admin-catalog@example.test', adminPassword: 'TenantA1Password' }).expect(201);
    const admin = await api.post('/api/v1/auth/login').send({ email: 'admin-catalog@example.test', password: 'TenantA1Password' }).expect(200);
    const version = await runtime.store.createIntentCatalogVersion({
      tenantId: tenant.body.tenant.id,
      status: 'draft',
      sourceFileName: 'catalog.xlsx',
      sourceHash: 'a'.repeat(64),
      parserVersion: 'test',
      catalog: {
        tenantScope: 'catalog-tenant',
        intents: [
          { intentKey: 'lead.capture', displayName: 'Request a service', description: 'Capture a qualified lead', category: 'company_formation', workflowKey: 'crm.lead.create', minimumScore: 70, confidenceThreshold: 0.8, confirmationRequired: true, active: true, priority: 100, versionNote: '' },
          { intentKey: 'consulting.request', displayName: 'Request a consultation', description: 'Capture a separate consultation request', category: 'sales', workflowKey: 'crm.consulting.create', minimumScore: 70, confidenceThreshold: 0.7, confirmationRequired: true, active: true, priority: 200, versionNote: '' },
          { intentKey: 'anc.document.supporting_upload', displayName: 'Submit supporting documents', description: 'Submit a supporting document for review', category: 'support', workflowKey: 'anc.document.ocr.extract', minimumScore: 0, confidenceThreshold: 0.78, confirmationRequired: true, active: true, priority: 90, versionNote: '' },
        ],
        signals: [
          { intentKey: 'lead.capture', signalId: 'demo', signalType: 'phrase', value: 'need a demo', language: 'en', matchMode: 'contains', weight: 65, relationGroup: null, notes: '' },
          { intentKey: 'lead.capture', signalId: 'book-demo', signalType: 'phrase', value: 'book a demo', language: 'en', matchMode: 'contains', weight: 65, relationGroup: null, notes: '' },
          { intentKey: 'lead.capture', signalId: 'demo-keyword', signalType: 'keyword', value: 'demo', language: 'en', matchMode: 'contains', weight: 20, relationGroup: null, notes: '' },
          { intentKey: 'lead.capture', signalId: 'connect-sanu', signalType: 'phrase', value: 'connect with sanu', language: 'en', matchMode: 'contains', weight: 70, relationGroup: null, notes: '' },
          { intentKey: 'lead.capture', signalId: 'erp-build', signalType: 'phrase', value: 'build an erp solution', language: 'en', matchMode: 'contains', weight: 35, relationGroup: null, notes: '' },
          { intentKey: 'lead.capture', signalId: 'shared-office', signalType: 'keyword', value: 'shared office', language: 'en', matchMode: 'contains', weight: 25, relationGroup: null, notes: '' },
          { intentKey: 'lead.capture', signalId: 'developer', signalType: 'keyword', value: 'developer', language: 'en', matchMode: 'contains', weight: 15, relationGroup: null, notes: '' },
          { intentKey: 'lead.capture', signalId: 'erp', signalType: 'keyword', value: 'erp', language: 'en', matchMode: 'contains', weight: 15, relationGroup: null, notes: '' },
          { intentKey: 'lead.capture', signalId: 'build', signalType: 'keyword', value: 'build', language: 'en', matchMode: 'contains', weight: 10, relationGroup: null, notes: '' },
          { intentKey: 'consulting.request', signalId: 'consulting-request', signalType: 'phrase', value: 'I need a consultation for a separate project', language: 'en', matchMode: 'contains', weight: 100, relationGroup: null, notes: '' },
          { intentKey: 'consulting.request', signalId: 'separate-project', signalType: 'phrase', value: 'I need a separate project', language: 'en', matchMode: 'contains', weight: 100, relationGroup: null, notes: '' },
          { intentKey: 'anc.document.supporting_upload', signalId: 'document-upload', signalType: 'phrase', value: 'I have supporting documents to share', language: 'en', matchMode: 'contains', weight: 75, relationGroup: null, notes: '' },
        ],
        slots: [{ intentKey: 'lead.capture', slotKey: 'name', dataType: 'person_name', required: true, alternativeGroup: null, collectionOrder: 1, promptKey: 'lead.ask_name', validationRule: 'token:NAME', retentionClass: 'pii', qualityWeight: 50 }, { intentKey: 'lead.capture', slotKey: 'email', dataType: 'email', required: false, alternativeGroup: 'contact', collectionOrder: 2, promptKey: 'lead.ask_contact', validationRule: 'token:EMAIL', retentionClass: 'pii', qualityWeight: 50 }, { intentKey: 'lead.capture', slotKey: 'contact_consent', dataType: 'boolean', required: true, alternativeGroup: null, collectionOrder: 3, promptKey: 'lead.ask_consent', validationRule: 'boolean:explicit_opt_in', retentionClass: 'consent', qualityWeight: 0 }, { intentKey: 'lead.capture', slotKey: 'interest_summary', dataType: 'string', required: true, alternativeGroup: null, collectionOrder: 4, promptKey: 'lead.ask_interest', validationRule: 'text:nonempty', retentionClass: 'business', qualityWeight: 0 }, { intentKey: 'consulting.request', slotKey: 'name', dataType: 'person_name', required: true, alternativeGroup: null, collectionOrder: 1, promptKey: 'lead.ask_name', validationRule: 'token:NAME', retentionClass: 'pii', qualityWeight: 50 }, { intentKey: 'consulting.request', slotKey: 'email', dataType: 'email', required: true, alternativeGroup: null, collectionOrder: 2, promptKey: 'lead.ask_email', validationRule: 'token:EMAIL', retentionClass: 'pii', qualityWeight: 25 }, { intentKey: 'consulting.request', slotKey: 'phone', dataType: 'phone', required: true, alternativeGroup: null, collectionOrder: 3, promptKey: 'lead.ask_phone', validationRule: 'token:PHONE', retentionClass: 'pii', qualityWeight: 25 }, { intentKey: 'consulting.request', slotKey: 'contact_consent', dataType: 'boolean', required: true, alternativeGroup: null, collectionOrder: 4, promptKey: 'lead.ask_consent', validationRule: 'boolean:explicit_opt_in', retentionClass: 'consent', qualityWeight: 0 }, { intentKey: 'consulting.request', slotKey: 'interest_summary', dataType: 'string', required: true, alternativeGroup: null, collectionOrder: 5, promptKey: 'lead.ask_interest', validationRule: 'text:nonempty', retentionClass: 'business', qualityWeight: 0 }],
        relations: [],
        workflowBindings: [{ workflowKey: 'crm.lead.create', n8nWorkflowId: 'demo', webhookPath: 'lead-capture', payloadContract: 'crm-lead-v1', sideEffectClass: 'crm_write', active: true }, { workflowKey: 'crm.consulting.create', n8nWorkflowId: 'consulting-demo', webhookPath: 'consulting-capture', payloadContract: 'crm-lead-v1', sideEffectClass: 'crm_write', active: true }, { workflowKey: 'crm.lead.quality.score', n8nWorkflowId: 'quality-demo', webhookPath: 'lead-quality-score', payloadContract: 'crm-lead-quality-v1', sideEffectClass: 'crm_write', active: true }, { workflowKey: 'anc.document.ocr.extract', n8nWorkflowId: 'ocr-demo', webhookPath: 'document-ocr', payloadContract: 'anc-document-ocr-v1', sideEffectClass: 'document_processing', active: true }],
        qualityRules: [{ intentKey: 'lead.capture', qualityWorkflowKey: 'crm.lead.quality.score', intentWeight: 0.6, confidenceWeight: 0.2, contactWeight: 0.2, hotThreshold: 85, warmThreshold: 70, nurtureThreshold: 40 }]
      }
    });
    await api.post(`/api/v1/admin/intent-catalog/versions/${version.id}/publish`).set('Authorization', `Bearer ${admin.body.token}`).expect(200);
    const multiTurn = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'catalog-tenant' }).expect(201);
    const intentTurn = await api.post('/api/v1/chat/messages').send({ sessionId: multiTurn.body.sessionId, message: 'I need a demo', clientMessageId: 'catalog-multi-1' }).expect(200);
    expect(intentTurn.body.actionProposal).toBeNull();
    expect(intentTurn.body.answer).toContain('What name');
    const repeatedIntentTurn = await api.post('/api/v1/chat/messages').send({ sessionId: multiTurn.body.sessionId, message: 'connect with sanu', clientMessageId: 'catalog-multi-2' }).expect(200);
    expect(repeatedIntentTurn.body.actionProposal).toBeNull();
    expect(repeatedIntentTurn.body.answer).toContain('What name');
    const clarificationReplySession = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'catalog-tenant' }).expect(201);
    const clarificationPrompt = await api.post('/api/v1/chat/messages').send({ sessionId: clarificationReplySession.body.sessionId, message: 'shared office', clientMessageId: 'catalog-clarification-reply-1' }).expect(200);
    expect(clarificationPrompt.body.answer).toContain('To make sure I route this correctly');
    const acceptedClarification = await api.post('/api/v1/chat/messages').send({ sessionId: clarificationReplySession.body.sessionId, message: 'shared office', clientMessageId: 'catalog-clarification-reply-2' }).expect(200);
    expect(acceptedClarification.body.answer).toContain('What name');
    const nameAfterClarification = await api.post('/api/v1/chat/messages').send({ sessionId: clarificationReplySession.body.sessionId, message: 'Clarification Visitor', clientMessageId: 'catalog-clarification-reply-3' }).expect(200);
    expect(nameAfterClarification.body.answer).toContain('email address');
    const synonymClarificationSession = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'catalog-tenant' }).expect(201);
    await api.post('/api/v1/chat/messages').send({ sessionId: synonymClarificationSession.body.sessionId, message: 'shared office', clientMessageId: 'catalog-synonym-reply-1' }).expect(200);
    const acceptedSynonym = await api.post('/api/v1/chat/messages').send({ sessionId: synonymClarificationSession.body.sessionId, message: 'I want a shared desk please', clientMessageId: 'catalog-synonym-reply-2' }).expect(200);
    expect(acceptedSynonym.body.answer).toContain('What name');
    const nameTurn = await api.post('/api/v1/chat/messages').send({ sessionId: multiTurn.body.sessionId, message: 'Demo Visitor', clientMessageId: 'catalog-multi-3' }).expect(200);
    expect(nameTurn.body.actionProposal).toBeNull();
    expect(nameTurn.body.answer).toContain('email address');
    expect((await runtime.store.listMessages(multiTurn.body.sessionId, tenant.body.tenant.id)).find((message) => message.clientMessageId === 'catalog-multi-3')?.maskedContent).toBe('[NAME_1]');
    const contactTurn = await api.post('/api/v1/chat/messages').send({ sessionId: multiTurn.body.sessionId, message: 'alice@example.com +971500000000', clientMessageId: 'catalog-multi-4' }).expect(200);
    expect(contactTurn.body.actionProposal).toBeNull();
    expect(contactTurn.body.answer).toContain('interest summary');
    const interestTurn = await api.post('/api/v1/chat/messages').send({ sessionId: multiTurn.body.sessionId, message: 'I need help setting up the requested service.', clientMessageId: 'catalog-multi-5' }).expect(200);
    expect(interestTurn.body.actionProposal).toMatchObject({ intent: 'crm.lead.create', consentRequired: true });
    expect(interestTurn.body.answer).toContain('consent action');
    const declined = await api.post('/api/v1/chat/messages').send({ sessionId: multiTurn.body.sessionId, message: 'no', clientMessageId: 'catalog-multi-refuse' }).expect(200);
    expect(declined.body.actionProposal).toBeNull();
    expect(declined.body.answer).toContain('will not register');
    await api.post(`/api/v1/chat/actions/${interestTurn.body.actionProposal.id}/confirm`).send({ sessionId: multiTurn.body.sessionId, confirmed: true }).expect(422);

    const demoSession = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'catalog-tenant' }).expect(201);
    const demoTurn = await api.post('/api/v1/chat/messages').send({ sessionId: demoSession.body.sessionId, message: 'Can I book a demo?', clientMessageId: 'catalog-demo-1' }).expect(200);
    expect(demoTurn.body.actionProposal).toBeNull();
    expect(demoTurn.body.answer).toContain('What name');

    const clarificationSession = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'catalog-tenant' }).expect(201);
    const clarificationTurn = await api.post('/api/v1/chat/messages').send({ sessionId: clarificationSession.body.sessionId, message: 'I was looking for a developer who can build an ERP solution for my company', clientMessageId: 'catalog-clarification-1' }).expect(200);
    expect(clarificationTurn.body.actionProposal).toBeNull();
    expect(clarificationTurn.body.answer).toContain('To make sure I route this correctly');

    const documentSession = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'catalog-tenant' }).expect(201);
    const documentTurn = await api.post('/api/v1/chat/messages').send({ sessionId: documentSession.body.sessionId, message: 'I have supporting documents to share', clientMessageId: 'catalog-document-1' }).expect(200);
    expect(documentTurn.body.actionProposal).toBeNull();
    expect(documentTurn.body.answer).toContain('To make sure I route this correctly');

    const session = await api.post('/api/v1/chat/sessions').send({ tenantSlug: 'catalog-tenant' }).expect(201);
    const proposalStart = await api.post('/api/v1/chat/messages').send({ sessionId: session.body.sessionId, message: 'I need a demo. My name is Alice, my email is alice@example.com and my phone is +971500000000.', clientMessageId: 'catalog-lead-1' }).expect(200);
    expect(proposalStart.body.actionProposal).toBeNull();
    expect(proposalStart.body.answer).toContain('interest summary');
    const proposal = await api.post('/api/v1/chat/messages').send({ sessionId: session.body.sessionId, message: 'Please arrange the requested demo for our ERP project.', clientMessageId: 'catalog-lead-2' }).expect(200);
    expect(proposal.body.actionProposal).toMatchObject({ intent: 'crm.lead.create', consentRequired: true });
    const confirmed = await api.post(`/api/v1/chat/actions/${proposal.body.actionProposal.id}/confirm`).send({ sessionId: session.body.sessionId, confirmed: true }).expect(200);
    expect(confirmed.body.action.state).toBe('approved');
    expect(confirmed.body.action.payload.contactConsent).toBe(true);
    expect(workflow.calls).toHaveLength(0);

    const secondProposal = await api.post('/api/v1/chat/messages').send({ sessionId: session.body.sessionId, message: 'I need a separate project', clientMessageId: 'catalog-second-intent-1' }).expect(200);
    expect(secondProposal.body.actionProposal).toMatchObject({ intent: 'crm.consulting.create', consentRequired: true });
    const secondConfirmed = await api.post(`/api/v1/chat/actions/${secondProposal.body.actionProposal.id}/confirm`).send({ sessionId: session.body.sessionId, confirmed: true }).expect(200);
    expect(secondConfirmed.body.action.state).toBe('approved');
    expect((await runtime.store.listActions(tenant.body.tenant.id)).filter((action) => action.sessionId === session.body.sessionId)).toHaveLength(2);

    const claimed = await api.post('/api/v1/internal/workflow-events/claim').set('x-agentic-internal-secret', 'crm-secret').send({ actionId: proposal.body.actionProposal.id, workflowKey: 'crm.lead.create', limit: 10 }).expect(200);
    expect(claimed.body.items).toHaveLength(1);
    expect(claimed.body.items[0]).toMatchObject({ actionId: proposal.body.actionProposal.id, qualityWorkflowKey: 'crm.lead.quality.score', catalogVersionId: version.id });
    expect((await runtime.store.getAction(proposal.body.actionProposal.id))?.state).toBe('processing');
    const replayedClaim = await api.post('/api/v1/internal/workflow-events/claim').set('x-agentic-internal-secret', 'crm-secret').send({ actionId: proposal.body.actionProposal.id, workflowKey: 'crm.lead.create', limit: 10 }).expect(200);
    expect(replayedClaim.body.items).toHaveLength(0);

    const action = await runtime.store.getAction(proposal.body.actionProposal.id);
    const messages = await runtime.store.listMessages(session.body.sessionId, tenant.body.tenant.id);
    const crmInput = { tenantId: tenant.body.tenant.id, sessionId: session.body.sessionId, leadData: action?.payload, intent: 'lead.capture', score: 70, validationPass: true, conversation: messages.map((message) => ({ role: message.role, content: message.maskedContent, createdAt: message.createdAt })) };
    const firstLead = await api.post('/api/v1/internal/crm/leads').set('x-agentic-internal-secret', 'crm-secret').send({ ...crmInput, actionId: action?.id }).expect(201);
    const scored = await api.put(`/api/v1/internal/crm/leads/${firstLead.body.lead.id}/quality`).set('x-agentic-internal-secret', 'crm-secret').send({ tenantId: tenant.body.tenant.id, score: 88, qualityWorkflowKey: 'crm.lead.quality.score', catalogVersionId: version.id, intentKey: 'lead.capture' }).expect(200);
    expect(scored.body.quality).toBe('hot');
    const duplicateAction = await runtime.store.createAction({ ...action!, id: randomUUID(), idempotencyKey: 'catalog-duplicate-action', state: 'completed' });
    const secondLead = await api.post('/api/v1/internal/crm/leads').set('x-agentic-internal-secret', 'crm-secret').send({ ...crmInput, actionId: duplicateAction.id }).expect(201);
    expect(secondLead.body.lead.id).toBe(firstLead.body.lead.id);
    expect(await runtime.store.listCrmLeads(tenant.body.tenant.id)).toHaveLength(1);

    const unrelated = await api.post('/api/v1/chat/messages').send({ sessionId: session.body.sessionId, message: 'What is the refund policy?', clientMessageId: 'catalog-unrelated-1' }).expect(200);
    expect(unrelated.body.actionProposal).toBeNull();
    expect(unrelated.body.answer).not.toContain('contact details needed');
    expect(unrelated.body.answer).not.toContain('submit your contact request');
  });
});

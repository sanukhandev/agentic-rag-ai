import { describe, expect, it } from 'vitest';
import { composeConversationSummary, consentVersionForState, mergeConcurrentConversationState, mergeWorkflowCallbackState, newConversationState } from './conversation-state.js';

describe('conversation state concurrency merge', () => {
  it('does not carry consent across a conflicting intent transition', () => {
    const latest = { ...newConversationState(), catalogVersionId: 'catalog-v1', selectedIntentKey: 'lead.capture', slotValues: { contact_consent: 'true' }, contactConsent: 'granted' as const, consentVersion: consentVersionForState({ catalogVersionId: 'catalog-v1', selectedIntentKey: 'lead.capture' }), consentCapturedAt: '2026-10-22T10:00:00.000Z' };
    const candidate = { ...latest, selectedIntentKey: 'consulting.request', slotValues: { name: '[NAME_2]' }, contactConsent: 'unknown' as const, consentVersion: null, consentCapturedAt: null };

    const merged = mergeConcurrentConversationState(latest, candidate);

    expect(merged.selectedIntentKey).toBe('consulting.request');
    expect(merged.contactConsent).toBe('unknown');
    expect(merged.consentVersion).toBeNull();
    expect(merged.consentCapturedAt).toBeNull();
    expect(merged.slotValues).toEqual({ name: '[NAME_2]' });
  });

  it('treats an explicit revocation as authoritative for the same purpose', () => {
    const purpose = { catalogVersionId: 'catalog-v1', selectedIntentKey: 'lead.capture' } as const;
    const latest = { ...newConversationState(), ...purpose, contactConsent: 'granted' as const, consentVersion: consentVersionForState(purpose) };
    const candidate = { ...latest, contactConsent: 'denied' as const, consentVersion: null, consentCapturedAt: null };

    const merged = mergeConcurrentConversationState(latest, candidate);

    expect(merged.contactConsent).toBe('denied');
    expect(merged.consentVersion).toBeNull();
    expect(merged.consentCapturedAt).toBeNull();
    expect(merged.slotValues.contact_consent).toBeUndefined();
    expect(merged.contactConsent).toBe('denied');
  });

  it('keeps the latest intent when an older workflow callback races with it', () => {
    const latest = {
      ...newConversationState(),
      catalogVersionId: 'catalog-v2',
      selectedIntentKey: 'company.setup',
      pendingPrompt: { id: 'new-prompt', type: 'slot' as const, intentKey: 'company.setup', slotKey: 'business_activity', issuedAt: '2026-10-22T10:01:00.000Z' },
      workflowStatus: 'queued' as const,
    };
    const candidate = {
      ...latest,
      catalogVersionId: 'catalog-v1',
      selectedIntentKey: 'lead.capture',
      pendingPrompt: null,
      workflowStatus: 'succeeded' as const,
      phase: 'SUCCEEDED' as const,
      rollingSummary: 'stale callback state',
    };

    const merged = mergeWorkflowCallbackState(latest, candidate);

    expect(merged.selectedIntentKey).toBe('company.setup');
    expect(merged.catalogVersionId).toBe('catalog-v2');
    expect(merged.pendingPrompt).toEqual(latest.pendingPrompt);
    expect(merged.workflowStatus).toBe('queued');
    expect(merged.rollingSummary).toBe(latest.rollingSummary);
  });

  it('keeps a newer chat offer when a workflow callback carries stale offer state', () => {
    const offer = { offerKey: 'offer-1', intentKey: 'company.setup', sourceMessageId: 'assistant-1', sourceQuery: 'setup procedure', options: [{ key: 'steps', label: 'the setup steps', retrievalHints: ['setup procedure'] }], issuedAt: '2026-10-22T10:01:00.000Z', expiresAt: '2026-10-22T10:31:00.000Z' };
    const latest = { ...newConversationState(), pendingFollowUpOffer: offer };
    const candidate = { ...latest, pendingFollowUpOffer: null, workflowStatus: 'succeeded' as const, phase: 'SUCCEEDED' as const };

    expect(mergeWorkflowCallbackState(latest, candidate).pendingFollowUpOffer).toEqual(offer);
  });

  it('builds a deterministic masked summary from authoritative state', () => {
    const state = { ...newConversationState(), selectedIntentKey: 'company.setup', intentConfidence: 0.91, slotValues: { business_activity: 'fashion boutique', budget: '[PHONE_1]' }, contactConsent: 'unknown' as const, workflowStatus: 'awaiting_customer' as const, pendingPrompt: { id: 'p', type: 'slot' as const, intentKey: 'company.setup', slotKey: 'timeline', issuedAt: '2026-10-23T00:00:00.000Z' } };
    expect(composeConversationSummary(state, 'within two weeks')).toContain('Primary intent: company.setup (91% confidence).');
    expect(composeConversationSummary(state, 'within two weeks')).toContain('budget=[PHONE_1]');
    expect(composeConversationSummary(state, 'within two weeks')).toContain('Next question: slot/timeline.');
  });

  it('does not let an older concurrent slot update replace a correction', () => {
    const latest = { ...newConversationState(), slotValues: { email: '[EMAIL_2]' }, slotProvenance: { email: { source: 'visitor' as const, messageSequence: 2, capturedAt: '2026-10-23T00:00:02.000Z', corrected: true } } };
    const stale = { ...newConversationState(), slotValues: { email: '[EMAIL_1]' }, slotProvenance: { email: { source: 'visitor' as const, messageSequence: 1, capturedAt: '2026-10-23T00:00:01.000Z', corrected: false } } };
    expect(mergeConcurrentConversationState(latest, stale).slotValues.email).toBe('[EMAIL_2]');
  });

  it('uses capture time and correction status to resolve equal message sequence provenance', () => {
    const latest = { ...newConversationState(), slotValues: { phone: '[PHONE_1]' }, slotProvenance: { phone: { source: 'visitor' as const, messageSequence: 4, capturedAt: '2026-10-23T00:00:04.000Z', corrected: false } } };
    const stale = { ...newConversationState(), slotValues: { phone: '[PHONE_0]' }, slotProvenance: { phone: { source: 'visitor' as const, messageSequence: 4, capturedAt: '2026-10-23T00:00:03.000Z', corrected: true } } };
    expect(mergeConcurrentConversationState(latest, stale).slotValues.phone).toBe('[PHONE_1]');
    const correction = { ...stale, slotProvenance: { phone: { ...stale.slotProvenance.phone, capturedAt: latest.slotProvenance.phone.capturedAt, corrected: true } } };
    expect(mergeConcurrentConversationState(latest, correction).slotValues.phone).toBe('[PHONE_0]');
  });

  it('does not resurrect a cleared offer or prompt from an older concurrent turn', () => {
    const offer = { offerKey: 'offer-old', intentKey: 'company.setup', sourceMessageId: 'assistant-old', sourceQuery: 'setup procedure', options: [{ key: 'steps', label: 'the setup steps', retrievalHints: ['setup procedure'] }], issuedAt: '2026-10-26T10:00:00.000Z', expiresAt: '2026-10-26T10:30:00.000Z' };
    const latest = { ...newConversationState(), messageSequence: 3, lastTurnAt: '2026-10-26T10:01:00.000Z', pendingPrompt: null, pendingFollowUpOffer: null };
    const stale = { ...newConversationState(), messageSequence: 3, lastTurnAt: '2026-10-26T10:00:30.000Z', pendingPrompt: { id: 'old-prompt', type: 'confirmation' as const, intentKey: 'company.setup', slotKey: null, issuedAt: '2026-10-26T10:00:30.000Z' }, pendingFollowUpOffer: offer };
    const merged = mergeConcurrentConversationState(latest, stale);
    expect(merged.pendingFollowUpOffer).toBeNull();
    expect(merged.pendingPrompt).toBeNull();
  });

  it('does not restore a stale prompt after a newer workflow callback clears it', () => {
    const latest = { ...newConversationState(), workflowStatus: 'succeeded' as const, phase: 'SUCCEEDED' as const, lastTurnAt: '2026-10-26T10:01:00.000Z', pendingPrompt: null };
    const candidate = { ...newConversationState(), workflowStatus: 'awaiting_customer' as const, phase: 'SLOT_COLLECTION' as const, lastTurnAt: '2026-10-26T10:02:00.000Z', pendingPrompt: { id: 'stale-prompt', type: 'slot' as const, intentKey: 'company.setup', slotKey: 'business_activity', issuedAt: '2026-10-26T10:01:30.000Z' } };
    const merged = mergeConcurrentConversationState(latest, candidate);
    expect(merged.workflowStatus).toBe('succeeded');
    expect(merged.phase).toBe('SUCCEEDED');
    expect(merged.pendingPrompt).toBeNull();
  });
});

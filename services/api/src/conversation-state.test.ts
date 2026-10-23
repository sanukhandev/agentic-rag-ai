import { describe, expect, it } from 'vitest';
import { consentVersionForState, mergeConcurrentConversationState, mergeWorkflowCallbackState, newConversationState } from './conversation-state.js';

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
});

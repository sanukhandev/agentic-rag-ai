import { describe, expect, it } from 'vitest';
import { consentVersionForState, mergeConcurrentConversationState, newConversationState } from './conversation-state.js';

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
  });
});

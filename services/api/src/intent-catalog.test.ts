import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogIntentClarification, catalogSlotQuestion, resolveIntent, resolveIntentContinuity, validateIntentCatalog } from './intent-catalog.js';
import type { IntentCatalogVersion } from './types.js';

const version: IntentCatalogVersion = {
  id: '00000000-0000-0000-0000-000000000001', tenantId: '00000000-0000-0000-0000-000000000002', version: 1, status: 'published', sourceFileName: 'catalog.xlsx', sourceHash: 'a'.repeat(64), parserVersion: 'test', createdAt: new Date().toISOString(), publishedAt: new Date().toISOString(), catalog: {
    tenantScope: 'demo',
    intents: [{ intentKey: 'lead.capture', displayName: 'Request a service', description: 'lead', category: 'sales', workflowKey: 'crm.lead.create', minimumScore: 70, confidenceThreshold: 0.8, confirmationRequired: true, active: true, priority: 100, versionNote: '' }, { intentKey: 'appointment.request', displayName: 'Appointment', description: 'appointment', category: 'sales', workflowKey: 'calendar.appointment.create', minimumScore: 80, confidenceThreshold: 0.8, confirmationRequired: true, active: false, priority: 90, versionNote: '' }],
    signals: [{ intentKey: 'lead.capture', signalId: 'lead-1', signalType: 'phrase', value: 'need a demo', language: 'en', matchMode: 'exact_phrase', weight: 40, relationGroup: null, notes: '' }, { intentKey: 'lead.capture', signalId: 'lead-2', signalType: 'exclusion', value: 'what services do you offer', language: 'en', matchMode: 'contains', weight: -50, relationGroup: null, notes: '' }, { intentKey: 'appointment.request', signalId: 'appointment-1', signalType: 'keyword', value: 'appointment', language: 'en', matchMode: 'contains', weight: 90, relationGroup: null, notes: '' }],
    slots: [{ intentKey: 'lead.capture', slotKey: 'name', dataType: 'person_name', required: true, alternativeGroup: null, collectionOrder: 1, promptKey: 'lead.ask_name', validationRule: 'token:NAME', retentionClass: 'crm_contact' }, { intentKey: 'lead.capture', slotKey: 'email', dataType: 'email', required: false, alternativeGroup: 'contact', collectionOrder: 2, promptKey: 'lead.ask_contact', validationRule: 'token:EMAIL', retentionClass: 'crm_contact' }, { intentKey: 'lead.capture', slotKey: 'phone', dataType: 'phone', required: false, alternativeGroup: 'contact', collectionOrder: 2, promptKey: 'lead.ask_contact', validationRule: 'token:PHONE', retentionClass: 'crm_contact' }],
    relations: [], workflowBindings: [{ workflowKey: 'crm.lead.create', n8nWorkflowId: 'demo', webhookPath: 'lead-capture', payloadContract: 'crm-lead-v1', sideEffectClass: 'crm_write', active: true }, { workflowKey: 'calendar.appointment.create', n8nWorkflowId: 'future', webhookPath: 'appointment-request', payloadContract: 'appointment-v1', sideEffectClass: 'calendar_write', active: false }]
  }
};

describe('intent catalog', () => {
  it('rejects unknown workflow references', () => {
    const result = validateIntentCatalog({ intents: [{ intentKey: 'lead.capture', displayName: 'Lead', workflowKey: 'missing', minimumScore: 70, confidenceThreshold: 0.8, active: true }], signals: [], slots: [], relations: [], workflowBindings: [] });
    expect(result.catalog).toBeNull();
    expect(result.errors.join(' ')).toContain('unknown workflow');
  });

  it('rejects malformed rows without throwing through the API boundary', () => {
    expect(() => validateIntentCatalog({ intents: [null], signals: [], slots: [], relations: [], workflowBindings: [] })).not.toThrow();
    expect(validateIntentCatalog({ intents: [null], signals: [], slots: [], relations: [], workflowBindings: [] }).catalog).toBeNull();
  });

  it('does not trigger an action for informational exclusions', () => {
    expect(resolveIntent(version, 'what services do you offer', { name: '[NAME_1]', email: '[EMAIL_1]' }).actionAllowed).toBe(false);
    expect(resolveIntent(version, 'what services do you offer', { name: '[NAME_1]', email: '[EMAIL_1]' }).intentKey).toBeNull();
  });

  it('requires the catalog signal and contact slots before proposing CRM', () => {
    const resolution = resolveIntent(version, 'I need a demo', { name: '[NAME_1]', email: '[EMAIL_1]' });
    expect(resolution.intentKey).toBe('lead.capture');
    expect(resolution.interest).toBe('Request a service');
    expect(resolution.actionAllowed).toBe(true);
    expect(resolution.score).toBeGreaterThanOrEqual(70);
  });

  it('treats an alternative contact group as one required slot and uses a user-facing prompt', () => {
    const resolution = resolveIntent(version, 'I need a demo', { name: '[NAME_1]' });
    expect(resolution.missingSlots).toEqual(['email']);
    expect(resolution.actionAllowed).toBe(false);
    expect(catalogSlotQuestion(version, 'lead.capture', 'email')).toContain('email address');
  });

  it('builds clarification from the published intent signals', () => {
    const clarification = catalogIntentClarification(version, 'lead.capture');
    expect(clarification).toContain('request a service');
    expect(clarification).toContain('need a demo');
  });

  it('asks for clarification when the matched signal is below the catalog threshold', () => {
    const resolution = resolveIntent(version, 'I need a demo');
    expect(resolution.reason).toBe('below_threshold');
    expect(resolution.actionAllowed).toBe(false);
    expect(catalogIntentClarification(version, resolution.intentKey ?? '')).toContain('To make sure I route this correctly');
  });

  it('blocks inactive workflows even when the intent score is high', () => {
    const resolution = resolveIntent(version, 'appointment', { name: '[NAME_1]', email: '[EMAIL_1]' });
    expect(resolution.intentKey).toBe('appointment.request');
    expect(resolution.reason).toBe('intent_inactive');
    expect(resolution.actionAllowed).toBe(false);
  });

  it('keeps the selected primary intent for contextual follow-ups and records alternatives', () => {
    const continuity = resolveIntentContinuity(version, { currentText: 'sure, continue', contextText: 'I need a demo\nsure, continue', selectedIntentKey: 'lead.capture', slotValues: { name: '[NAME_1]' } });
    expect(continuity.primary.intentKey).toBe('lead.capture');
    expect(continuity.secondaryIntentKeys).not.toContain('lead.capture');
  });

  it('switches only when a new unrelated current intent is strong', () => {
    const continuity = resolveIntentContinuity(version, { currentText: 'appointment', contextText: 'I need a demo\nappointment', selectedIntentKey: 'lead.capture', slotValues: { name: '[NAME_1]' } });
    expect(continuity.primary.intentKey).toBe('appointment.request');
  });

  it('accepts the proposed OCR catalog extensions without activating the pending OCR binding', () => {
    const catalog = JSON.parse(readFileSync(new URL('../../../docs/feature-specs/dynamic-ocr/ANCFZ-intent-catalog-OCR-WF1-proposed.json', import.meta.url), 'utf8')) as unknown;
    const result = validateIntentCatalog(catalog);
    expect(result.errors).toEqual([]);
    expect(result.catalog?.documentPolicies).toHaveLength(16);
    expect(result.catalog?.documentSettings?.workflowKey).toBe('anc.document.ocr.extract');
    expect(result.catalog?.workflowBindings.find((binding) => binding.workflowKey === 'anc.document.ocr.extract')?.active).toBe(false);
  });
});

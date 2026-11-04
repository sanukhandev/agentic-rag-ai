import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogV2Document } from './catalog-v2.js';
import { resolveV2IntentEvidence } from './v2-intent-evidence.js';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as CatalogV2Document;
const current = (message: string, recentCustomerTurns: Array<{ messageId: string; text: string }> = [], document = catalog) =>
  resolveV2IntentEvidence({ catalog: document, catalogVersionRef: 'anc:r1:verified-catalog',
    currentMessage: message, currentMessageId: 'current-message-12345678', recentCustomerTurns });

describe('V2 catalog-backed contextual customer intent evidence', () => {
  it('observes published direct signals without inferring authorization from knowledge questions', () => {
    const result = current('Tell me about company formation');
    expect(result.currentSignalIds).toContain('signal.company.register');
    expect(result.initiation).toBe('information');
    expect(result.initiationSupported).toBe(false);
    expect(result.observedSignals[0]).toMatchObject({
      source: 'current_turn', catalogVersionRef: 'anc:r1:verified-catalog',
      sourceMessageId: 'current-message-12345678',
    });
  });

  it.each(['I want to form a company', 'I want to start a company', 'Please incorporate a company'])(
    'recognizes only reviewed synonyms for direct formation initiation: %s', text => {
      const result = current(text);
      expect(result.currentSignalIds).toEqual(['signal.company.register']);
      expect(result.initiation).toBe('explicit');
      expect(result.initiationSupported).toBe(true);
    },
  );

  it('uses an earlier CUSTOMER formation signal only for an explicit contextual start', () => {
    const history = [{ messageId: 'previous-customer-12345678', text: 'Tell me about company formation' }];
    const result = current("Let's start the process", history);
    expect(result.currentSignalIds).toEqual([]);
    expect(result.contextSignalIds).toEqual(['signal.company.register']);
    expect(result.contextAnchorMessageId).toBe('previous-customer-12345678');
    expect(result.initiationSupported).toBe(true);
    expect(result.observedSignals[0]).toMatchObject({ source: 'prior_customer_turn',
      sourceMessageId: 'previous-customer-12345678' });
  });

  it.each(['How can I start the process?', 'How does it work?', 'What are the steps?'])(
    'does not convert information-only follow-up into initiation: %s', text => {
      const result = current(text, [{ messageId: 'previous-customer-12345678', text: 'company formation' }]);
      expect(result.initiationSupported).toBe(false);
      expect(result.contextSignalIds).toEqual([]);
    },
  );

  it('does not score a formation phrase when the customer explicitly rejects it', () => {
    for (const message of ["I don't want to start a company", "I'm not ready to form a company"]) {
      const result = current(message);
      expect(result.currentSignalIds).toEqual([]);
      expect(result.initiationSupported).toBe(false);
    }
  });

  it('does not treat a standalone yes or conversational greeting as consent', () => {
    for (const message of ['Yes', 'Hello', 'Sure']) {
      const result = current(message, [{ messageId: 'previous-customer-12345678', text: 'company formation' }]);
      expect(result.initiationSupported).toBe(false);
      expect(result.observedSignals).toHaveLength(0);
    }
  });

  it('does not replay a stale anchor after a customer rejection or change of mind', () => {
    const result = current("Let's start the process", [
      { messageId: 'old-12345678', text: 'company formation' },
      { messageId: 'new-12345678', text: 'I changed my mind, I do not want to proceed' },
    ]);
    expect(result.contextSignalIds).toEqual([]);
    expect(result.initiationSupported).toBe(false);
  });

  it('rejects ambiguity across different recent customer-requested goals', () => {
    const other = structuredClone(catalog);
    other.sheets.BusinessGoals.push({ ...other.sheets.BusinessGoals[0]!,
      businessGoalKey: 'anc.other_service', name: 'Other service' });
    other.sheets.IntentSignals.push({ ...other.sheets.IntentSignals[0]!, signalId: 'signal.other',
      targetKey: 'anc.other_service', value: 'another service', aliases: [] });
    const result = current("Let's start the process", [
      { messageId: 'first', text: 'company formation' },
      { messageId: 'second', text: 'another service' },
    ], other);
    expect(result.ambiguous).toBe(true);
    expect(result.initiationSupported).toBe(false);
  });

  it('does not claim that a model-suggested, unpublished phrase is observed', () => {
    const result = current('I want to start an aircraft business');
    expect(result.observedSignals).toHaveLength(0);
    expect(result.initiationSupported).toBe(false);
  });

  it('does not carry context from more than the last eight trusted customer turns', () => {
    const history = [
      { messageId: 'old', text: 'company formation' },
      ...Array.from({ length: 8 }, (_, i) => ({ messageId: 'neutral-' + i, text: 'Thanks' })),
    ];
    expect(current("Let's start the process", history).contextSupported).toBe(false);
  });

  it('never uses an unapproved alias or signal of type exclusion as positive evidence', () => {
    const other = structuredClone(catalog);
    other.sheets.IntentSignals[0]!.signalType = 'exclusion';
    expect(current('I want to register a company', [], other).observedSignals).toEqual([]);
  });
});

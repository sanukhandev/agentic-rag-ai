import type { UserIntentFact } from '../types.js';
import type { V2PlanningProposal } from './planning.js';

/** A proposed fact is only a customer statement, never an external-provider fact. */
type ProposedFact = V2PlanningProposal['proposedFacts'][number];
const prohibited = /(?:\[[A-Z]+_\d+\]|https?:\/\/|[^\s@]+@[^\s@]+\.[^\s@]+|\b\d{12,19}\b|\b(?:password|otp|cvv|api[_ -]?key)\b)/iu;
const normalize = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
const numberWords: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
};
const negatedBefore = (message: string, start: number): boolean =>
  /\b(?:not|never|without|don't|do not)\s+(?:[\w-]+\s+){0,3}$/iu.test(message.slice(Math.max(0, start - 36), start));
const validQuote = (fact: ProposedFact, customerMessage: string): boolean => {
  const quote = normalize(fact.supportingQuote);
  const value = normalize(fact.maskedValue);
  if (!quote || !value || prohibited.test(fact.supportingQuote) || prohibited.test(fact.maskedValue)
    || !normalize(customerMessage).includes(quote) || /(?:^|\s)(?:not|never|without|don't)(?:\s|$)/iu.test(quote)) return false;
  if (fact.key === 'visa_count') {
    if (!/^\d{1,2}$/u.test(value)) return false;
    const count = Number(value);
    if (!Number.isSafeInteger(count) || count > 99) return false;
    const hasCount = new RegExp('(?:^|\\D)' + value + '(?:\\D|$)', 'u').test(quote)
      || Object.entries(numberWords).some(([word, digit]) => digit === value && new RegExp('\\b' + word + '\\b', 'u').test(quote));
    return hasCount && /\bvisas?\b/iu.test(quote);
  }
  if (fact.key === 'entity_type' && fact.maskedValue.length > 80) return false;
  if (fact.key === 'timeline' && fact.maskedValue.length > 100) return false;
  return quote.includes(value);
};

/**
 * Treats model extraction as untrusted until the quote is found verbatim in the
 * authenticated customer message and the canonical value is supported by it.
 * No CRM, pricing, legal or provider outcome can be inserted through this API.
 */
export const validateQuotedV2CustomerFacts = (
  proposals: readonly ProposedFact[],
  customerMessage: string,
  messageId: string,
  messageSequence: number,
): Record<string, UserIntentFact> => {
  const facts: Record<string, UserIntentFact> = {};
  const conflicts = new Set<string>();
  for (const proposal of (proposals ?? []).slice(0, 8)) {
    const key = proposal.key;
    if (conflicts.has(key) || !validQuote(proposal, customerMessage)) continue;
    const existing = facts[key];
    if (existing && existing.maskedValue !== proposal.maskedValue) {
      delete facts[key];
      conflicts.add(key);
      continue;
    }
    facts[key] = {
      maskedValue: proposal.maskedValue.trim(),
      source: 'visitor',
      messageSequence,
      evidenceRefs: ['customer-message:' + messageId],
      corrected: false,
    };
  }
  return facts;
};

/** Recover explicit, non-sensitive requirement values when the model omits a fact proposal. */
export const extractQuotedV2CustomerFacts = (
  customerMessage: string,
  messageId: string,
  messageSequence: number,
): Record<string, UserIntentFact> => {
  const proposals: ProposedFact[] = [];
  const visa = customerMessage.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})\s+visas?\b/iu);
  if (visa && !negatedBefore(customerMessage, visa.index ?? 0)) {
    const word = visa[1]!.toLocaleLowerCase('en-US');
    proposals.push({ key: 'visa_count', maskedValue: numberWords[word] ?? word, supportingQuote: visa[0] });
  }
  const timelinePattern = /\b(?:next|this|within)\s*[- ]\s*(?:month|months|week|weeks)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+months?\b|\b(?:asap|immediately|urgent)\b/giu;
  const timeline = [...customerMessage.matchAll(timelinePattern)].find(match => !negatedBefore(customerMessage, match.index ?? 0));
  if (timeline) proposals.push({ key: 'timeline', maskedValue: timeline[0]!, supportingQuote: timeline[0]! });
  return validateQuotedV2CustomerFacts(proposals, customerMessage, messageId, messageSequence);
};

import { describe, expect, it } from 'vitest';
import { normalizeFullTextQuery } from './search-query.js';

describe('full-text query normalization', () => {
  it('converts multiword natural language into valid OR terms', () => {
    expect(normalizeFullTextQuery('company formation packages ANC')).toBe('company | formation | packages');
  });

  it('strips punctuation and tsquery operators before building terms', () => {
    expect(normalizeFullTextQuery('company-formation/packages (ANC)! & | <->')).toBe('company | formation | packages');
  });

  it('returns an empty expression when no lexical terms remain', () => {
    expect(normalizeFullTextQuery('the, are, ? & |')).toBe('');
  });

  it('deduplicates terms and keeps the expression bounded', () => {
    expect(normalizeFullTextQuery('Company company formation formation')).toBe('company | formation');
    expect(normalizeFullTextQuery(Array.from({ length: 50 }, (_, index) => `term${index.toString().padStart(2, '0')}`).join(' ')).split(' | ')).toHaveLength(40);
  });
});

import { describe, expect, it } from 'vitest';
import { supportsV2SourceCloseClause } from './v2-claim-support.js';

describe('source-close claim support cannot be established by one shared topic word', () => {
  it('rejects unsupported location and approval claims sharing the word company', () => {
    const source = 'The company requires a passport.';
    expect(supportsV2SourceCloseClause('The company is located on Mars.', source)).toBe(false);
    expect(supportsV2SourceCloseClause('The company is fully approved.', source)).toBe(false);
  });
  it('accepts source-close omissions of nonmaterial wording', () => {
    expect(supportsV2SourceCloseClause('The package costs 42 credits.',
      'The approved package costs 42 credits.')).toBe(true);
  });
  it('does not accept added availability, price conditions or unrelated policies', () => {
    expect(supportsV2SourceCloseClause('The package costs 42 credits per month.',
      'The package costs 42 credits.')).toBe(false);
    expect(supportsV2SourceCloseClause('The package is available worldwide.',
      'The package is available in Ajman.')).toBe(false);
  });
  it('allows narrowly reviewed terms while independent proof handles other paraphrases', () => {
    expect(supportsV2SourceCloseClause('The package includes one visa.',
      'The package contains one visa.')).toBe(true);
  });
});

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
  it('does not assemble prices or visa entitlements from separate offerings', () => {
    const prices = 'Package Alpha costs 40 AED. Package Beta costs 80 AED.';
    expect(supportsV2SourceCloseClause('Package Alpha costs 80 AED.', prices)).toBe(false);
    expect(supportsV2SourceCloseClause('Package Alpha costs 40 AED.', prices)).toBe(true);
    const visas = 'Package Alpha includes 1 visa and Package Beta includes 3 visas.';
    expect(supportsV2SourceCloseClause('Package Alpha includes 3 visas.', visas)).toBe(false);
    expect(supportsV2SourceCloseClause('Package Beta includes 3 visas.', visas)).toBe(true);
  });
  it('does not treat reversed requirements as a grounded paraphrase', () => {
    expect(supportsV2SourceCloseClause('Document Beta requires Document Alpha.',
      'Document Alpha requires Document Beta.')).toBe(false);
  });
  it('requires an independent grounding proof for multi-number assertions lacking a single source statement', () => {
    expect(supportsV2SourceCloseClause('Package Alpha costs 40 AED.',
      'Alpha 40 AED, Beta 80 AED.')).toBe(false);
  });
  it('allows narrowly reviewed terms while independent proof handles other paraphrases', () => {
    expect(supportsV2SourceCloseClause('The package includes one visa.',
      'The package contains one visa.')).toBe(true);
  });
});

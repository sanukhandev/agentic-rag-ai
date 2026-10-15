import { describe, expect, it } from 'vitest';
import { parsePermittedLanguages } from './persona-utils';

describe('admin persona utilities', () => {
  it('normalizes and de-duplicates permitted languages', () => {
    expect(parsePermittedLanguages(' EN, ar, en , ')).toEqual(['en', 'ar']);
  });
});

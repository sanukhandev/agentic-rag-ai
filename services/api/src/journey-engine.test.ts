import { describe, expect, it } from 'vitest';
import { classifyTurn } from './journey-engine.js';

describe('generic journey turn handling', () => {
  it('keeps an outstanding requirement across an information interruption', () => {
    expect(classifyTurn('What packages are available?', 'visa_count')).toBe('INFORMATION_QUESTION');
    expect(classifyTurn('Two', 'visa_count')).toBe('SLOT_ANSWER');
  });

  it('recognises corrections and explicit farewells', () => {
    expect(classifyTurn('Actually, make that three')).toBe('SLOT_CORRECTION');
    expect(classifyTurn('Goodbye')).toBe('FAREWELL');
  });
});

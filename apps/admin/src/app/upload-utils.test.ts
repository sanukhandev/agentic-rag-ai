import { describe, expect, it } from 'vitest';
import { fileMimeType } from './upload-utils';

describe('admin upload utilities', () => {
  it('maps only supported ingestion extensions', () => {
    expect(fileMimeType('FAQ.DOCX')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(fileMimeType('notes.txt')).toBe('text/plain');
    expect(fileMimeType('macro.doc')).toBeNull();
  });
});

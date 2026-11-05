import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ingestionArchiveResultSchema } from './http/schemas.js';

const chunk = (content: string) => ({ ordinal: 0, locator: 'training/guide.md · section 1', content, contentHash: createHash('sha256').update(content).digest('hex') });
const member = { fileName: 'training/guide.md', mimeType: 'text/markdown', normalizedContent: 'Approved training content',
  contentHash: createHash('sha256').update('Approved training content').digest('hex'), chunks: [chunk('Approved training content')] };
describe('ZIP archive ingestion result schema', () => {
  it('accepts member-scoped review-pending source input', () => {
    expect(ingestionArchiveResultSchema.safeParse({ kind: 'archive_members', parserVersion: 'python-ingestion-0.5.0', members: [member], warnings: [] }).success).toBe(true);
  });
  it('rejects ZIP slip, unsupported MIME, missing hashes and empty member sets', () => {
    const base = { kind: 'archive_members', parserVersion: 'python-ingestion-0.5.0', members: [member], warnings: [] };
    for (const fileName of ['../secret.txt', '/etc/passwd', 'dir/../secret.txt', 'dir\\secret.txt']) {
      expect(ingestionArchiveResultSchema.safeParse({ ...base, members: [{ ...member, fileName }] }).success).toBe(false);
    }
    expect(ingestionArchiveResultSchema.safeParse({ ...base, members: [{ ...member, mimeType: 'application/x-msdownload' }] }).success).toBe(false);
    expect(ingestionArchiveResultSchema.safeParse({ ...base, members: [{ ...member, contentHash: '' }] }).success).toBe(false);
    expect(ingestionArchiveResultSchema.safeParse({ ...base, members: [] }).success).toBe(false);
  });
});

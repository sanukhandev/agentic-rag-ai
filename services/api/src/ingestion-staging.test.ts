import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasValidFileSignature, IngestionStaging, MAX_INGESTION_FILE_BYTES } from './ingestion-staging.js';

describe('private ingestion staging', () => {
  it('writes, reads and purges only bounded supported job files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentic-staging-'));
    const staging = new IngestionStaging(root);
    const jobId = '11111111-1111-4111-8111-111111111111';
    const content = Buffer.from('private source');
    try {
      await staging.write(jobId, 'text/plain', content);
      expect(await staging.read(jobId, 'text/plain')).toEqual(content);
      await expect(staging.write(jobId, 'text/plain', content)).rejects.toThrow();
      await expect(staging.write('../escape', 'text/plain', content)).rejects.toThrow('Invalid ingestion job ID.');
      await expect(staging.write(jobId, 'application/octet-stream', content)).rejects.toThrow('Unsupported ingestion file type.');
      await expect(staging.write('22222222-2222-4222-8222-222222222222', 'text/plain', Buffer.alloc(MAX_INGESTION_FILE_BYTES + 1))).rejects.toThrow('Input exceeds the 5 MiB ingestion limit.');
      await expect(staging.write('22222222-2222-4222-8222-222222222222', 'application/pdf', Buffer.from('not a pdf'))).rejects.toThrow('signature');
      expect(hasValidFileSignature('application/pdf', Buffer.from('%PDF-1.7'))).toBe(true);
      expect(hasValidFileSignature('application/pdf', Buffer.from('plain text'))).toBe(false);
      expect(hasValidFileSignature('application/zip', Buffer.from('PK\u0005\u0006'))).toBe(true);
      await staging.write('22222222-2222-4222-8222-222222222222', 'application/zip', Buffer.from('PK\u0005\u0006'));
      expect(await staging.read('22222222-2222-4222-8222-222222222222', 'application/zip')).toEqual(Buffer.from('PK\u0005\u0006'));
      await staging.purge('22222222-2222-4222-8222-222222222222', 'application/zip');
      await staging.purge(jobId, 'text/plain');
      await staging.purge(jobId, 'text/plain');
      expect(await staging.read(jobId, 'text/plain')).toBeNull();
      expect(await readdir(root)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_INGESTION_FILE_BYTES = 5 * 1024 * 1024;

const extensions: Record<string, string> = {
  'text/plain': '.txt',
  'text/markdown': '.md',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export const hasValidFileSignature = (mimeType: string, content: Buffer): boolean => {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') return !content.includes(0);
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return content.subarray(0, 4).equals(zipSignature);
  return false;
};

const safeJobId = (jobId: string): void => {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error('Invalid ingestion job ID.');
};

export class IngestionStaging {
  constructor(private readonly root: string) {}

  extensionFor(mimeType: string): string | null { return extensions[mimeType] ?? null; }

  async write(jobId: string, mimeType: string, content: Buffer): Promise<void> {
    const extension = this.extensionFor(mimeType);
    safeJobId(jobId);
    if (!extension) throw new Error('Unsupported ingestion file type.');
    if (content.length > MAX_INGESTION_FILE_BYTES) throw new Error('Input exceeds the 5 MiB ingestion limit.');
    if (!hasValidFileSignature(mimeType, content)) throw new Error('Input file signature does not match its declared type.');
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await chmod(this.root, 0o700);
    const target = join(this.root, `${jobId}${extension}`);
    await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  }

  async read(jobId: string, mimeType: string): Promise<Buffer | null> {
    const extension = this.extensionFor(mimeType);
    safeJobId(jobId);
    if (!extension) return null;
    try { return await readFile(join(this.root, `${jobId}${extension}`)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async purge(jobId: string, mimeType: string): Promise<void> {
    const extension = this.extensionFor(mimeType);
    safeJobId(jobId);
    if (!extension) return;
    await unlink(join(this.root, `${jobId}${extension}`)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

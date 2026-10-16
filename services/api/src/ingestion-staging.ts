import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_INGESTION_FILE_BYTES = 5 * 1024 * 1024;

const extensions: Record<string, string> = {
  'text/plain': '.txt',
  'text/markdown': '.md',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/zip': '.zip',
};

const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const emptyZipSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const spannedZipSignature = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

export const hasValidFileSignature = (mimeType: string, content: Buffer): boolean => {
  if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/csv') return !content.includes(0);
  if (mimeType === 'application/json') {
    try {
      JSON.parse(content.toString('utf8').replace(/^\uFEFF/, ''));
      return true;
    } catch {
      return false;
    }
  }
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return content.subarray(0, 4).equals(zipSignature);
  if (mimeType === 'application/zip') return content.subarray(0, 4).equals(zipSignature) || content.subarray(0, 4).equals(emptyZipSignature) || content.subarray(0, 4).equals(spannedZipSignature);
  return false;
};

const safeJobId = (jobId: string): void => {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new Error('Invalid ingestion job ID.');
};

export const isUnsupportedMountPermissionError = (error: unknown): boolean => {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPERM' || code === 'ENOTSUP';
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
    try {
      await chmod(this.root, 0o700);
    } catch (error) {
      // Docker Desktop bind mounts use host ACLs and may reject POSIX mode changes.
      if (!isUnsupportedMountPermissionError(error)) throw error;
    }
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

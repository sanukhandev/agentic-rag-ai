import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import type { CrmLead, LeadConversationMessage, SupportingDocument } from './types.js';

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
export const DEFAULT_DOCUMENT_MIME_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png', 'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv'
];

const safeId = (value: string): void => {
  if (!/^[0-9a-f-]{36}$/iu.test(value)) throw new Error('Invalid document identifier.');
};

export const documentExtension = (mimeType: string): string => ({
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/tiff': '.tif',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'text/plain': '.txt', 'text/csv': '.csv'
}[mimeType] ?? '');

export const hasSupportingDocumentSignature = (mimeType: string, content: Buffer): boolean => {
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return !content.includes(0);
  if (mimeType === 'application/pdf') return content.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return content.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === 'image/png') return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimeType === 'image/tiff') return content.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || content.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]));
  if (mimeType.endsWith('.document') || mimeType.endsWith('.sheet')) return content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  return false;
};

export const documentSha256 = (content: Buffer): string => createHash('sha256').update(content).digest('hex');

export class PrivateDocumentStorage {
  constructor(private readonly root: string) {}

  key(tenantId: string, documentId: string, mimeType: string): string {
    safeId(tenantId); safeId(documentId);
    return posix.join(tenantId, `${documentId}${documentExtension(mimeType)}`);
  }

  async write(key: string, content: Buffer): Promise<void> {
    if (key.includes('..') || key.startsWith('/') || key.includes('\\')) throw new Error('Invalid private document key.');
    const target = join(this.root, ...key.split('/'));
    await mkdir(join(target, '..'), { recursive: true, mode: 0o700 });
    await writeFile(target, content, { flag: 'wx', mode: 0o600 });
  }

  async read(key: string): Promise<Buffer | null> {
    try { return await readFile(join(this.root, ...key.split('/'))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  async purge(key: string): Promise<void> {
    await unlink(join(this.root, ...key.split('/'))).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export const composeDocumentSummary = (lead: CrmLead, documents: SupportingDocument[]): string => {
  const conversation = lead.conversation
    .filter((message: LeadConversationMessage) => message.role === 'user')
    .map((message) => message.content.replace(/\[(?:NAME|EMAIL|PHONE)_\d+\]/gu, '[visitor detail]').trim())
    .filter(Boolean)
    .slice(-12);
  const excerpts = documents.filter((document) => document.status === 'completed' && document.summary)
    .map((document) => `${document.fileName}: ${document.summary}`)
    .slice(-5);
  const parts = [`Intent: ${lead.intent}`, conversation.length ? `Visitor requirements: ${conversation.join(' | ')}` : '', excerpts.length ? `Supporting documents: ${excerpts.join(' | ')}` : ''].filter(Boolean);
  return parts.join('\n').slice(0, 20_000);
};

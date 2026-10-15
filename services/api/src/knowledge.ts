import { createHash, randomUUID } from 'node:crypto';
import type { Chunk, Source } from './types.js';
import { contentHash } from './store-memory.js';
import type { EmbeddingProvider } from './embedding.js';

export const EMBEDDING_MODEL = 'deterministic-demo-8d-v1';

export const embedText = (text: string): number[] => {
  const digest = createHash('sha256').update(text).digest();
  const values = Array.from({ length: 8 }, (_, index) => (digest[index] ?? 0) / 255);
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
  return values.map((value) => value / magnitude);
};

export const chunkText = (text: string, maxCharacters = 800): string[] => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && (current.length + paragraph.length + 2 > maxCharacters)) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current.length > maxCharacters) {
      for (let start = 0; start < current.length; start += maxCharacters) chunks.push(current.slice(start, start + maxCharacters).trim());
      current = '';
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
};

export const buildChunks = (source: Pick<Source, 'id' | 'tenantId' | 'versionId'>, content: string): Chunk[] =>
  chunkText(content).map((chunk, ordinal) => ({
    id: randomUUID(),
    sourceId: source.id,
    tenantId: source.tenantId,
    versionId: source.versionId,
    ordinal,
    locator: `section ${ordinal + 1}`,
    content: chunk,
    contentHash: contentHash(chunk),
    embedding: embedText(chunk),
  }));

export const buildChunksWithEmbeddings = async (source: Pick<Source, 'id' | 'tenantId' | 'versionId'>, content: string, provider: EmbeddingProvider): Promise<Chunk[]> => {
  const chunks = chunkText(content);
  const result: Chunk[] = [];
  for (const [ordinal, chunk] of chunks.entries()) result.push({ id: randomUUID(), sourceId: source.id, tenantId: source.tenantId, versionId: source.versionId, ordinal, locator: `section ${ordinal + 1}`, content: chunk, contentHash: contentHash(chunk), embedding: await provider.embed(chunk) });
  return result;
};

export const buildIngestionChunksWithEmbeddings = async (
  source: Pick<Source, 'id' | 'tenantId' | 'versionId'>,
  chunks: Array<{ ordinal: number; locator: string; content: string; contentHash: string }>,
  provider: EmbeddingProvider,
): Promise<Chunk[]> => {
  const result: Chunk[] = [];
  for (const chunk of chunks) result.push({ id: randomUUID(), sourceId: source.id, tenantId: source.tenantId, versionId: source.versionId, ordinal: chunk.ordinal, locator: chunk.locator, content: chunk.content, contentHash: chunk.contentHash, embedding: await provider.embed(chunk.content) });
  return result;
};

const cosine = (left: number[], right: number[]): number => {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
};

const rankWithEmbedding = <T extends { chunk: { embedding: number[] } }>(query: string, rows: T[], queryEmbedding: number[], limit: number): T[] => {
  const terms = query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return rows.map((row) => {
    const content = JSON.stringify(row).toLowerCase();
    const overlap = terms.filter((term) => content.includes(term)).length;
    return { row, score: cosine(queryEmbedding, row.chunk.embedding) + overlap * 0.1, overlap };
  })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .filter(({ score, overlap }) => score >= 0.45 && overlap > 0)
    .map(({ row }) => row);
};

export const rankChunks = <T extends { chunk: { embedding: number[] } }>(query: string, rows: T[], limit = 4): T[] => rankWithEmbedding(query, rows, embedText(query), limit);

export const rankChunksWithEmbedding = async <T extends { chunk: { embedding: number[] } }>(query: string, rows: T[], provider: EmbeddingProvider, limit = 4): Promise<T[]> => rankWithEmbedding(query, rows, await provider.embed(query), limit);

export const rankChunksWithVector = <T extends { chunk: { embedding: number[] } }>(query: string, rows: T[], queryEmbedding: number[], limit = 4): T[] => rankWithEmbedding(query, rows, queryEmbedding, limit);

export const hasConflictingEvidence = (contents: string[]): boolean => {
  for (let leftIndex = 0; leftIndex < contents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < contents.length; rightIndex += 1) {
      const left = contents[leftIndex] ?? '';
      const right = contents[rightIndex] ?? '';
      const leftTerms = new Set(left.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const rightTerms = new Set(right.toLowerCase().match(/[a-z]{4,}/g) ?? []);
      const sharedTopic = [...leftTerms].some((term) => rightTerms.has(term));
      const leftFacts = new Set(left.match(/\b\d+(?:\.\d+)?\b/g) ?? []);
      const rightFacts = new Set(right.match(/\b\d+(?:\.\d+)?\b/g) ?? []);
      if (sharedTopic && leftFacts.size > 0 && rightFacts.size > 0 && [...leftFacts].some((fact) => !rightFacts.has(fact))) return true;
    }
  }
  return false;
};

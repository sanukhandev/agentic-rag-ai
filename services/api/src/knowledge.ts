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
  return embedChunkRows(source, chunks.map((content, ordinal) => ({ ordinal, locator: `section ${ordinal + 1}`, content, contentHash: contentHash(content) })), provider);
};

const EMBEDDING_BATCH_SIZE = 64;

const embedChunkRows = async (
  source: Pick<Source, 'id' | 'tenantId' | 'versionId'>,
  chunks: Array<{ ordinal: number; locator: string; content: string; contentHash: string }>,
  provider: EmbeddingProvider,
  onProgress?: (processed: number, total: number) => Promise<void>,
): Promise<Chunk[]> => {
  const result: Chunk[] = [];
  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    const embeddings = provider.embedBatch ? await provider.embedBatch(batch.map((chunk) => chunk.content)) : await Promise.all(batch.map((chunk) => provider.embed(chunk.content)));
    if (embeddings.length !== batch.length) throw new Error('Embedding provider returned an incomplete batch.');
    result.push(...batch.map((chunk, index) => {
      const embedding = embeddings[index];
      if (!embedding) throw new Error('Embedding provider returned a missing vector.');
      return { id: randomUUID(), sourceId: source.id, tenantId: source.tenantId, versionId: source.versionId, ordinal: chunk.ordinal, locator: chunk.locator, content: chunk.content, contentHash: chunk.contentHash, embedding };
    }));
    if (onProgress) await onProgress(Math.min(start + batch.length, chunks.length), chunks.length);
  }
  return result;
};

export const buildIngestionChunksWithEmbeddings = async (
  source: Pick<Source, 'id' | 'tenantId' | 'versionId'>,
  chunks: Array<{ ordinal: number; locator: string; content: string; contentHash: string }>,
  provider: EmbeddingProvider,
  onProgress?: (processed: number, total: number) => Promise<void>,
): Promise<Chunk[]> => {
  return embedChunkRows(source, chunks, provider, onProgress);
};

const evidenceMetadataLine = /^(?:File|Format|Primary intent|Suggested routing|Retrieval keywords|Sample user query(?:\s*\([^)]*\))?|Search phrasing|Related customer phrasing|Context\s*\/\s*limitation|Response policy|Response pattern|Retrieval metadata|Detection examples|Clarification|Next action):/iu;
const evidenceMetadataHeader = /^(?:Knowledge Records|Detailed retrieval-ready knowledge records|tenantScope|sourceKey|sourceFile|sourceSha256|visibility|piiScreening|---)$/iu;
const evidenceRecordHeader = /^[A-Z][A-Z0-9_.-]*-\d+\s*(?:[—-]|\|)/u;
const sourceBackedLine = /^Source-backed\s+(?:content|knowledge):/iu;

/** Removes ingestion/template metadata while preserving the approved source-backed facts. */
export const presentKnowledgeText = (input: string): string => {
  const lines = input.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const hasSourceBackedContent = lines.some((line) => sourceBackedLine.test(line.trim()));
  let inSourceBackedContent = false;
  const visible: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (sourceBackedLine.test(trimmed)) {
      inSourceBackedContent = true;
      const value = trimmed.replace(/^Source-backed\s+(?:content|knowledge):\s*/iu, '').trim();
      if (value) visible.push(value);
      continue;
    }
    if (evidenceMetadataLine.test(trimmed) || evidenceMetadataHeader.test(trimmed) || evidenceRecordHeader.test(trimmed)) {
      inSourceBackedContent = false;
      continue;
    }
    if (hasSourceBackedContent && !inSourceBackedContent) continue;
    if (trimmed) visible.push(trimmed);
    else if (visible.at(-1) !== '') visible.push('');
  }
  return visible.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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

const rankWithEmbedding = <T extends { chunk: { content: string; embedding: number[] } }>(query: string, rows: T[], queryEmbedding: number[], limit: number): T[] => {
  const terms = query.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return rows.map((row) => {
    const content = presentKnowledgeText(row.chunk.content).toLowerCase();
    const overlap = terms.filter((term) => content.includes(term)).length;
    return { row, score: cosine(queryEmbedding, row.chunk.embedding) + overlap * 0.1, overlap };
  })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .filter(({ score, overlap }) => score >= 0.45 && overlap > 0)
    .map(({ row }) => row);
};

export const rankChunks = <T extends { chunk: { content: string; embedding: number[] } }>(query: string, rows: T[], limit = 4): T[] => rankWithEmbedding(query, rows, embedText(query), limit);

export const rankChunksWithEmbedding = async <T extends { chunk: { content: string; embedding: number[] } }>(query: string, rows: T[], provider: EmbeddingProvider, limit = 4): Promise<T[]> => rankWithEmbedding(query, rows, await provider.embed(query), limit);

export const rankChunksWithVector = <T extends { chunk: { content: string; embedding: number[] } }>(query: string, rows: T[], queryEmbedding: number[], limit = 4): T[] => rankWithEmbedding(query, rows, queryEmbedding, limit);

const factualSegments = (content: string): string[] => content
  .replace(/^File:.*$/gim, '')
  .replace(/\b(?:document_id|document|section|page)\s*[:#-]?\s*(?:[A-Z]+-)?\d+\b/gi, '')
  .split(/\n{2,}|(?<=[.!?])\s+/u)
  .map((segment) => segment.trim())
  .filter(Boolean);

const termsNearFacts = (content: string): Set<string> => {
  const tokens = content.toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) ?? [];
  const metadataTerms = new Set(['document', 'file', 'page', 'portfolio', 'sample', 'section', 'source', 'training', 'data', 'casestudies', 'case', 'study', 'project', 'projects', 'domain', 'github', 'url']);
  const terms = new Set<string>();
  tokens.forEach((token, index) => {
    if (!/^\d/.test(token)) return;
    for (const nearby of tokens.slice(Math.max(0, index - 4), index + 5)) if (/^[a-z]{4,}$/.test(nearby) && !metadataTerms.has(nearby)) terms.add(nearby);
  });
  return terms;
};

const measurementTerms = new Set(['price', 'prices', 'cost', 'costs', 'credit', 'credits', 'hour', 'hours', 'market', 'markets', 'system', 'systems', 'user', 'users', 'year', 'years', 'month', 'months', 'percent', 'percentage']);

export const hasConflictingEvidence = (contents: string[]): boolean => {
  for (let leftIndex = 0; leftIndex < contents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < contents.length; rightIndex += 1) {
      for (const left of factualSegments(contents[leftIndex] ?? '')) {
        for (const right of factualSegments(contents[rightIndex] ?? '')) {
          const leftTerms = termsNearFacts(left);
          const rightTerms = termsNearFacts(right);
          const sharedTerms = [...leftTerms].filter((term) => rightTerms.has(term));
          const sharedTopic = sharedTerms.length >= 2 && sharedTerms.some((term) => measurementTerms.has(term));
          const leftFacts = new Set(left.match(/\b\d+(?:\.\d+)?\b/g) ?? []);
          const rightFacts = new Set(right.match(/\b\d+(?:\.\d+)?\b/g) ?? []);
          if (sharedTopic && leftFacts.size > 0 && rightFacts.size > 0 && [...leftFacts].some((fact) => !rightFacts.has(fact))) return true;
        }
      }
    }
  }
  return false;
};

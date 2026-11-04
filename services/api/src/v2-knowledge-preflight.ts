import { retrieveApprovedKnowledge } from './knowledge.js';
import { sanitizeKnowledgeText } from './privacy.js';
import type { EmbeddingProvider } from './embedding.js';
import type { Store } from './types.js';
import type { ModelEvidence } from './model.js';
import type { V2ApprovedEvidence } from './v2-evidence.js';

/** Read-only preflight: facts must come from active, tenant-scoped public knowledge.
 * Never treat a Business Goal catalog as a substantive knowledge document. */
export const isV2FactualKnowledgeQuestion = (message: string): boolean => {
  const value = message.toLocaleLowerCase('en-US');
  const factual = /\b(?:process|procedure|steps?|how (?:do|can|to|does)|what (?:is|are|documents?|requirements?)|tell me (?:about|how)|explain|costs?|pricing|prices?|fees?|licen[cs]e|eligib\w*|regulations?|rules?|timeline|how long|visa requirements?)\b/u.test(value);
  const subject = /\b(?:company|companies|business|free[\s-]?zone|formation|incorporat\w*|registr\w*|setup|set[\s-]?up|license|licence|visas?|packages?|documents?|requirements?|ajman)\b/u.test(value);
  return factual && subject;
};

/** The model may understand "How does it work?" from conversation history,
 * but vector retrieval cannot. Add only a previously customer-anchored, active
 * catalog goal label for bounded anaphoric knowledge follow-ups. This is query
 * context, never evidence or confirmation of a goal or provider operation. */
export const contextualizeV2KnowledgeQuery = (message: string, topicName: string | null): string => {
  if (!topicName || isV2FactualKnowledgeQuestion(message)) return message;
  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 240 || topicName.length > 120) return message;
  const reference = /^(?:(?:so|then|and|okay|ok)\s+)*(?:how (?:does|do|can|would) (?:it|this|that|the process)\b|what (?:about|are|is) (?:it|this|that|the|these|those|visas?|documents?|requirements?|costs?|prices?)\b|can you (?:explain|clarify) (?:it|this|that)\b|tell me more(?: about (?:it|that))?\b)/iu;
  return reference.test(trimmed) ? `${topicName}: ${trimmed}` : message;
};

const relevantEvidenceText = (text: string, query: string): string => {
  const sentences = text.replace(/\s+(?=\d+\.\s+|(?:what|which)\s+(?:documents?|passport|proof of residence)\b)/giu, '\n')
    .split(/(?<=[.!?])\s+|\n+/u).map(value => value.trim()).filter(Boolean);
  const normalizedQuery = query.toLocaleLowerCase('en-US');
  const asksDocuments = /\b(?:document|documents|passport|proof of residence|requirements?)\b/u.test(normalizedQuery);
  const formationQuestion = /\b(?:formation|setup|set[- ]?up|registration|process|procedure|step|steps)\b/u.test(normalizedQuery);
  if (!formationQuestion) return text;
  if (!asksDocuments && text.trim().replace(/^\d+\.\s*/u, '').toLocaleLowerCase('en-US').startsWith('what documents')) return '';
  if (sentences.length < 2) {
    const value = text.toLocaleLowerCase('en-US');
    return !asksDocuments && /document|passport|proof of residence|application form/u.test(value) ? '' : text;
  }
  const selected = sentences.filter(sentence => {
    const value = sentence.toLocaleLowerCase('en-US');
    const heading = value.replace(/^\d+\.\s*/u, '');
    const processTerms = /\b(?:formation|setup|process|procedure|step|steps|structure|completed?|issued?|issuance|takes?|choose|select|apply|establish|incorporat\w*|licen[cs]e|registration)\b/u;
    const documentOnlyLine = /^(?:passport|passport-size|proof of residence|application form|note:|additional documents)\b/u.test(value);
    if (!asksDocuments && /^(?:what|which)\s+(?:documents?|passport|proof of residence)\b/u.test(heading)) return false;
    if (!asksDocuments && documentOnlyLine) return false;
    if (!asksDocuments && /\b(?:document|documents|passport|proof of residence|application form)\b/u.test(value)
      && !processTerms.test(value)) return false;
    return processTerms.test(value)
      || (asksDocuments && /\b(?:application|document|documents?|passport|proof of residence|requirements?)\b/u.test(value));
  });
  if (selected.length > 0) return selected.join(' ');
  return !asksDocuments && sentences.every(sentence => /\b(?:document|documents|passport|proof of residence|application form)\b/u.test(sentence.toLocaleLowerCase('en-US'))) ? '' : text;
};

/** Use the true persisted chunk ID as the citation key. Hashing this breaks
 * the public citation resolver even though the model evidence guard passes. */
export const toV2KnowledgeEvidence = (item: ModelEvidence, query?: string): V2ApprovedEvidence => ({
  citationId: item.citation.chunkId,
  text: relevantEvidenceText(sanitizeKnowledgeText(item.content), query ?? '').slice(0, 1_500),
  sourceRef: item.citation.sourceId,
  sourceVersion: item.citation.versionId,
  approved: true,
  revoked: false,
});

export const prefetchV2ApprovedKnowledge = async (
  store: Pick<Store, 'getSource' | 'searchSearchableChunks' | 'listSearchableChunks'>,
  embedding: EmbeddingProvider,
  tenantId: string,
  message: string,
): Promise<V2ApprovedEvidence[]> => {
  if (!isV2FactualKnowledgeQuestion(message)) return [];
  const matches = await retrieveApprovedKnowledge(store, embedding, tenantId, 'public', message, 4);
  const checked = await Promise.all(matches.map(async match => {
    const source = await store.getSource(match.citation.sourceId);
    if (!source || source.tenantId !== tenantId || source.status !== 'active'
      || source.versionId !== match.citation.versionId) return null;
    return toV2KnowledgeEvidence(match, message);
  }));
  return checked.filter((item): item is V2ApprovedEvidence => item !== null && item.text.trim().length > 0);
};

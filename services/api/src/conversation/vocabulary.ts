import { createHash, randomUUID } from 'node:crypto';
import type { IntentCatalogVersion, IntentVocabularyCandidate, Store } from '../types.js';

export type VocabularyDecision = 'candidate' | 'promotable' | 'rejected';

export interface VocabularyCandidateInput {
  phrase: string;
  intentKey: string;
  sourceRole: 'user' | 'assistant';
  sourceSessionIds: string[];
  existingPhrases: string[];
  competingPhrases: string[];
  containsPii: boolean;
  isNegated: boolean;
  isQuotedOrHypothetical: boolean;
}

export interface VocabularyEvaluation {
  status: VocabularyDecision;
  reason: string;
  phrase: string | null;
}

export const normalizeVocabularyPhrase = (value: string): string | null => {
  const phrase = value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
  return phrase.length >= 3 ? phrase : null;
};

export const evaluateVocabularyCandidate = (input: VocabularyCandidateInput): VocabularyEvaluation => {
  const phrase = normalizeVocabularyPhrase(input.phrase);
  if (!phrase) return { status: 'rejected', reason: 'empty_phrase', phrase: null };
  if (!input.intentKey.trim()) return { status: 'rejected', reason: 'unregistered_intent', phrase };
  if (input.sourceRole !== 'user') return { status: 'rejected', reason: 'assistant_text', phrase };
  if (input.containsPii) return { status: 'rejected', reason: 'pii_detected', phrase };
  if (input.isNegated) return { status: 'rejected', reason: 'negated_expression', phrase };
  if (input.isQuotedOrHypothetical) return { status: 'rejected', reason: 'quoted_or_hypothetical', phrase };
  const existing = input.existingPhrases.map(normalizeVocabularyPhrase).filter(Boolean);
  if (existing.includes(phrase)) return { status: 'rejected', reason: 'duplicate_phrase', phrase };
  const competing = input.competingPhrases.map(normalizeVocabularyPhrase).filter(Boolean);
  if (competing.includes(phrase)) return { status: 'rejected', reason: 'ambiguous_phrase', phrase };
  const independentSessions = new Set(input.sourceSessionIds.filter(Boolean)).size;
  if (independentSessions < 2) return { status: 'candidate', reason: 'awaiting_independent_customer_support', phrase };
  return { status: 'promotable', reason: 'independent_customer_support', phrase };
};

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export class VocabularyLearningService {
  constructor(private readonly store: Store) {}

  async list(tenantId: string): Promise<IntentVocabularyCandidate[]> {
    return this.store.listVocabularyCandidates(tenantId);
  }

  async reject(tenantId: string, candidateId: string, reason = 'rejected_by_admin'): Promise<IntentVocabularyCandidate> {
    const candidate = await this.store.getVocabularyCandidate(tenantId, candidateId);
    if (!candidate) throw new Error('VOCABULARY_CANDIDATE_NOT_FOUND');
    const updated = await this.store.updateVocabularyCandidate({ ...candidate, status: 'rejected', reason, evaluatedAt: new Date().toISOString() });
    await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'intent_vocabulary.rejected', metadata: { candidateId, reason }, createdAt: new Date().toISOString() });
    return updated;
  }

  async rollback(tenantId: string, candidateId: string): Promise<IntentVocabularyCandidate> {
    const candidate = await this.store.getVocabularyCandidate(tenantId, candidateId);
    if (!candidate) throw new Error('VOCABULARY_CANDIDATE_NOT_FOUND');
    if (candidate.status !== 'promoted' || !candidate.promotedCatalogVersionId) throw new Error('VOCABULARY_CANDIDATE_NOT_PROMOTED');
    const current = await this.store.getPublishedIntentCatalog(tenantId);
    if (!current || current.id !== candidate.promotedCatalogVersionId) throw new Error('VOCABULARY_CATALOG_CHANGED');
    if (!candidate.catalogVersionId) throw new Error('VOCABULARY_SOURCE_CATALOG_NOT_FOUND');
    const previous = await this.store.getIntentCatalogVersion(tenantId, candidate.catalogVersionId);
    if (!previous) throw new Error('VOCABULARY_SOURCE_CATALOG_NOT_FOUND');
    const published = await this.store.publishIntentCatalogVersion(tenantId, previous.id);
    if (!published) throw new Error('VOCABULARY_ROLLBACK_FAILED');
    const updated = await this.store.updateVocabularyCandidate({ ...candidate, status: 'rolled_back', reason: 'rolled_back_by_admin', evaluatedAt: new Date().toISOString() });
    await this.store.addAudit({ id: randomUUID(), tenantId, actorId: null, eventName: 'intent_vocabulary.rolled_back', metadata: { candidateId, restoredCatalogVersionId: previous.id }, createdAt: new Date().toISOString() });
    return updated;
  }

  async observe(input: { tenantId: string; intentKey: string; phrase: string; sessionId: string; messageId: string; containsPii: boolean; isNegated: boolean; isQuotedOrHypothetical: boolean }): Promise<IntentVocabularyCandidate | null> {
    const published = await this.store.getPublishedIntentCatalog(input.tenantId);
    if (!published) return null;
    const intent = published.catalog.intents.find(candidate => candidate.intentKey === input.intentKey && candidate.active);
    if (!intent) return null;
    const existingCandidate = (await this.store.listVocabularyCandidates(input.tenantId)).find(candidate => candidate.intentKey === input.intentKey && candidate.phrase === normalizeVocabularyPhrase(input.phrase));
    const existingPhrases = published.catalog.signals.filter(signal => signal.intentKey === input.intentKey && signal.signalType !== 'exclusion').map(signal => signal.value);
    const competingPhrases = published.catalog.signals.filter(signal => signal.intentKey !== input.intentKey && signal.signalType !== 'exclusion').map(signal => signal.value);
    const evaluation = evaluateVocabularyCandidate({ phrase: input.phrase, intentKey: input.intentKey, sourceRole: 'user', sourceSessionIds: [...(existingCandidate?.sourceSessionIds ?? []), input.sessionId], existingPhrases, competingPhrases, containsPii: input.containsPii, isNegated: input.isNegated, isQuotedOrHypothetical: input.isQuotedOrHypothetical });
    const candidate: IntentVocabularyCandidate = {
      id: existingCandidate?.id ?? randomUUID(), tenantId: input.tenantId, intentKey: input.intentKey, phrase: evaluation.phrase ?? normalizeVocabularyPhrase(input.phrase) ?? input.phrase,
      sourceSessionIds: [...new Set([...(existingCandidate?.sourceSessionIds ?? []), input.sessionId])], sourceMessageIds: [...new Set([...(existingCandidate?.sourceMessageIds ?? []), input.messageId])],
      catalogVersionId: published.id, status: evaluation.status, reason: evaluation.reason, evaluation: { independentSessionCount: new Set([...(existingCandidate?.sourceSessionIds ?? []), input.sessionId]).size, source: 'customer_conversation' }, promotedCatalogVersionId: existingCandidate?.promotedCatalogVersionId ?? null,
      createdAt: existingCandidate?.createdAt ?? new Date().toISOString(), evaluatedAt: new Date().toISOString(), promotedAt: existingCandidate?.promotedAt ?? null,
    };
    const stored = existingCandidate ? await this.store.updateVocabularyCandidate(candidate) : await this.store.createVocabularyCandidate(candidate);
    if (stored.status !== 'promotable' || stored.promotedCatalogVersionId) return stored;
    return this.promote(stored, published);
  }

  async promote(candidate: IntentVocabularyCandidate, published?: IntentCatalogVersion): Promise<IntentVocabularyCandidate> {
    const current = published ?? await this.store.getPublishedIntentCatalog(candidate.tenantId);
    if (!current || current.id !== candidate.catalogVersionId) return { ...candidate, status: 'rejected', reason: 'catalog_revision_changed', evaluatedAt: new Date().toISOString() };
    const signalId = `learned.${digest(`${candidate.intentKey}:${candidate.phrase}`).slice(0, 24)}`;
    if (current.catalog.signals.some(signal => signal.signalId === signalId)) return candidate;
    const catalog = structuredClone(current.catalog);
    catalog.signals.push({ intentKey: candidate.intentKey, signalId, signalType: 'phrase', value: candidate.phrase, language: 'en', matchMode: 'contains', weight: 55, relationGroup: null, notes: 'Automatically promoted from two independent customer conversations.' });
    const version = await this.store.createIntentCatalogVersion({ tenantId: candidate.tenantId, status: 'draft', sourceFileName: `${current.sourceFileName} (learned vocabulary)`, sourceHash: digest(JSON.stringify(catalog)), parserVersion: 'intent-vocabulary-auto-1', catalog });
    const publishedVersion = await this.store.publishIntentCatalogVersion(candidate.tenantId, version.id);
    if (!publishedVersion) return { ...candidate, status: 'rejected', reason: 'catalog_publish_failed', evaluatedAt: new Date().toISOString() };
    const promoted = { ...candidate, status: 'promoted' as const, promotedCatalogVersionId: publishedVersion.id, promotedAt: new Date().toISOString(), evaluatedAt: new Date().toISOString(), reason: 'independent_customer_support' };
    const updated = await this.store.updateVocabularyCandidate(promoted);
    await this.store.addAudit({ id: randomUUID(), tenantId: candidate.tenantId, actorId: null, eventName: 'intent_vocabulary.promoted', metadata: { candidateId: candidate.id, intentKey: candidate.intentKey, phrase: candidate.phrase, catalogVersionId: publishedVersion.id }, createdAt: new Date().toISOString() });
    return updated;
  }
}

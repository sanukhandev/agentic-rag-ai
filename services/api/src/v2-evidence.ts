import { createHash } from 'node:crypto';
import { hasConflictingEvidence } from './knowledge.js';
import { hasSufficientEvidence, type ModelEvidence } from './model.js';
import { personaComposedResponseSchema, type PersonaComposedResponseV2, type ResponseGuardVerdictV2 } from './python-model/v2-contracts.js';

export interface V2ApprovedEvidence {
  citationId: string;
  text: string;
  sourceVersion: string;
  approved: boolean;
  revoked: boolean;
  sourceRef?: string;
}

export interface V2VerifiedFact {
  factId: string;
  text: string;
  sourceVersion: string;
  verified: boolean;
}

export interface V2ClaimProvenance {
  claimDigest: string;
  citationIds: string[];
  sourceVersions: string[];
}

export interface V2EvidenceDecision {
  verdict: ResponseGuardVerdictV2;
  claims: V2ClaimProvenance[];
}

const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 32);
const sentences = (answer: string): string[] => answer.split(/(?<=[.!?])\s+|\n+/u).map((value) => value.trim()).filter(Boolean);
const unsafeOutput = (answer: string): boolean => {
  const normalized = answer.toLocaleLowerCase('en-US');
  return normalized.includes('ignore all previous instructions')
    || normalized.includes('ignore previous instructions')
    || normalized.includes('system prompt')
    || /(?:api[_ -]?key|secret|password|token)\s*[:=]/iu.test(answer)
    || /(?:tenantId|sessionId|opportunityId)/u.test(answer)
    || /https?:\/\/[^\s]+(?:webhook|callback)/iu.test(answer);
};
const uncitedConversation = (answer: string): boolean => /^(?:hi|hello|hey|thanks|thank you|you['’]?re welcome|nice to meet you|how can i help|what can i help with)[!.?,\s]/iu.test(answer.trim());
const uncitedQuestion = (answer: string, nextQuestion: string | null): boolean => {
  if (!nextQuestion) return false;
  const prefix = answer.slice(0, Math.max(0, answer.length - nextQuestion.length)).trim();
  return answer.trim().endsWith(nextQuestion.trim()) && /^(?:sure|okay|ok|of course|i can help(?: with that)?|to get started|thanks)?[.!?,\s]*$/iu.test(prefix);
};
const verdict = (accepted: boolean, reasonCode: ResponseGuardVerdictV2['reasonCode'], response: PersonaComposedResponseV2 | null): ResponseGuardVerdictV2 => ({ schemaVersion: 2, accepted, reasonCode, response });

export const verifyV2ResponseEvidence = (input: unknown, evidence: V2ApprovedEvidence[], facts: V2VerifiedFact[] = [], options: { conversational?: boolean; allowUncitedQuestion?: boolean; allowApprovedFallback?: boolean } = {}): V2EvidenceDecision => {
  const parsed = personaComposedResponseSchema.safeParse(input);
  if (!parsed.success) return { verdict: verdict(false, 'metadata_leak', null), claims: [] };
  const response = parsed.data;
  if (unsafeOutput(response.answer)) return { verdict: verdict(false, 'metadata_leak', null), claims: [] };
  const evidenceById = new Map(evidence.map((item) => [item.citationId, item]));
  const factById = new Map(facts.map((item) => [item.factId, item]));
  const citationIds = [...new Set(response.citationIds)];
  if (citationIds.length !== response.citationIds.length) return { verdict: verdict(false, 'invalid_citation', null), claims: [] };
  if (citationIds.some((id) => !evidenceById.has(id) && !factById.has(id))) return { verdict: verdict(false, 'invalid_citation', null), claims: [] };
  const citedEvidence = citationIds.map((id) => evidenceById.get(id)).filter((item): item is V2ApprovedEvidence => Boolean(item));
  const citedFacts = citationIds.map((id) => factById.get(id)).filter((item): item is V2VerifiedFact => Boolean(item));
  if (citedEvidence.some((item) => !item.approved || item.revoked || !item.sourceVersion) || citedFacts.some((item) => !item.verified || !item.sourceVersion)) return { verdict: verdict(false, 'invalid_citation', null), claims: [] };
  if (hasConflictingEvidence(citedEvidence.map((item) => item.text))) return { verdict: verdict(false, 'policy_denied', null), claims: [] };
  const modelEvidence: ModelEvidence[] = [
    ...citedEvidence.map((item) => ({ citation: { sourceId: item.sourceRef ?? item.citationId, versionId: item.sourceVersion, chunkId: item.citationId, title: 'approved evidence', locator: item.citationId }, content: item.text })),
    ...citedFacts.map((fact) => ({ citation: { sourceId: fact.factId, versionId: fact.sourceVersion, chunkId: fact.factId, title: 'verified fact', locator: fact.factId }, content: fact.text })),
  ];
  const trustedFacts = citedFacts.map((fact) => fact.text).join(' ');
  const citations = modelEvidence.map((item) => item.citation);
  const grounded = options.allowApprovedFallback === true && citationIds.length === 0
    ? true
    : options.conversational === true && citationIds.length === 0
    ? uncitedConversation(response.answer) || (options.allowUncitedQuestion === true && uncitedQuestion(response.answer, response.nextQuestion))
    : citationIds.length > 0 && hasSufficientEvidence(response.answer, modelEvidence, citations, trustedFacts);
  if (!grounded) return { verdict: verdict(false, citationIds.length === 0 ? 'unsupported_claim' : 'unsupported_claim', null), claims: [] };
  const sourceVersions = [...new Set([...citedEvidence.map((item) => item.sourceVersion), ...citedFacts.map((item) => item.sourceVersion)])];
  const claims = sentences(response.answer).map((claim) => ({ claimDigest: digest(claim), citationIds, sourceVersions }));
  return { verdict: verdict(true, 'accepted', response), claims };
};

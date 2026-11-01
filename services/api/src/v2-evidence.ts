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
// Uncited model output is restricted to non-factual conversational speech acts.
// Do not accept a greeting prefix followed by an unsupported business claim.
const uncitedConversation = (answer: string): boolean =>
  /^(?:hi|hello|hey)(?:[,!.\s]+(?:how can i help(?: you)?|what can i help (?:you )?with)\??)?[.!?\s]*$/iu.test(answer.trim())
  || /^(?:thanks|thank you|you're welcome|you’re welcome|nice to meet you)[.!?\s]*$/iu.test(answer.trim());

const nonFactualPreface = (input: string): boolean => {
  const value = input.trim().replace(/[.!]\s*$/u, '').trim().replace(/\s+/gu, ' ');
  if (!value || value.length > 190) return false;
  return /^(?:thanks?(?: you)?(?: for (?:sharing|clarifying|confirming|explaining)(?: (?:that|the details|those details|your request))?)?|understood|got it|okay|ok|sure|of course|certainly|that makes sense|i understand|i see|no problem|happy to help)$/iu.test(value)
    || /^i (?:can|would be happy to|am happy to)(?: help(?: you)?(?: work through (?:that|this))?| guide you| walk you through (?:that|it|the steps))(?: (?:with|on|through) (?:that|this|your (?:request|setup|company formation|company-formation request)|the (?:process|next steps)))?$/iu.test(value)
    || /^i(?:'|’)ll (?:keep|bear) (?:your|those|the) (?:details|requirements|request|company-formation request) in (?:mind|view)$/iu.test(value)
    || /^i (?:don(?:'|’)t|do not|can(?:'|’)t|cannot) (?:have (?:a )?verified (?:answer|information|details)(?: (?:for|about|on|to) (?:that|this|the specific (?:detail|question)))?(?: yet)?|want to guess(?: about that)?|verify that (?:detail|claim) yet)$/iu.test(value);
};

const uncitedQuestion = (answer: string, question: string | null): boolean => {
  if (!question || !answer.trim().endsWith(question.trim())) return false;
  const preface = answer.trim().slice(0, answer.trim().length - question.trim().length).trim();
  return !preface || nonFactualPreface(preface);
};

const safeNoEvidenceDialogue = (answer: string, question: string | null): boolean => {
  // Disallow business consequences, authority claims, numbers, deadlines and links
  // without approved evidence even when the rest of the reply is conversational.
  if (/\b(?:aed|usd|gbp|eur|dollars?|dirhams?|fees?|prices?|costs?|invoices?|paid|payment|eligible|eligibility|guaranteed|guarantee|registered|registration|created|uploaded|completed|signed|legal(?:ly)?|law|policy|licen[cs]e|approved|confirmed|successful|visa issued|will take|takes? \d+|within \d+)\b|\b\d+(?:[.,]\d+)?\s*(?:days?|hours?|weeks?|months?|visas?)\b|https?:\/\//iu.test(answer)) return false;
  if (answer.length > 500) return false;
  if (!question && uncitedConversation(answer)) return true;
  if (question) {
    if (!answer.trim().endsWith(question.trim()) || !/\?\s*$/u.test(question)) return false;
    if (!/^(?:what|which|who|when|where|how|could you|would you|can you|do you|are you|is there|please|tell me|have you)\b/iu.test(question.trim())) return false;
  }
  const preface = question ? answer.trim().slice(0, answer.trim().length - question.trim().length).trim() : answer.trim();
  if (!preface) return Boolean(question);
  const segments = preface.split(/(?<=[.!])\s+/u).filter(Boolean);
  return segments.length <= 2 && segments.every(nonFactualPreface);
};
const verdict = (accepted: boolean, reasonCode: ResponseGuardVerdictV2['reasonCode'], response: PersonaComposedResponseV2 | null): ResponseGuardVerdictV2 => ({ schemaVersion: 2, accepted, reasonCode, response });

export const verifyV2ResponseEvidence = (input: unknown, evidence: V2ApprovedEvidence[], facts: V2VerifiedFact[] = [], options: { conversational?: boolean; allowUncitedQuestion?: boolean; allowNonFactualDialogue?: boolean; allowApprovedFallback?: boolean } = {}): V2EvidenceDecision => {
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
    : citationIds.length === 0 && options.allowNonFactualDialogue === true
    ? safeNoEvidenceDialogue(response.answer, response.nextQuestion)
    : options.conversational === true && citationIds.length === 0
    ? uncitedConversation(response.answer) || (options.allowUncitedQuestion === true && uncitedQuestion(response.answer, response.nextQuestion))
    : citationIds.length > 0 && hasSufficientEvidence(response.answer, modelEvidence, citations, trustedFacts);
  if (!grounded) return { verdict: verdict(false, citationIds.length === 0 ? 'unsupported_claim' : 'unsupported_claim', null), claims: [] };
  const sourceVersions = [...new Set([...citedEvidence.map((item) => item.sourceVersion), ...citedFacts.map((item) => item.sourceVersion)])];
  const claims = sentences(response.answer).map((claim) => ({ claimDigest: digest(claim), citationIds, sourceVersions }));
  return { verdict: verdict(true, 'accepted', response), claims };
};

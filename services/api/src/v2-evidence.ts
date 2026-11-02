import { createHash } from 'node:crypto';
import { hasConflictingEvidence } from './knowledge.js';
import { hasSufficientEvidence, type ModelEvidence } from './model.js';
import { personaComposedResponseSchema, type PersonaComposedResponseV2, type ResponseGuardVerdictV2 } from './python-model/v2-contracts.js';
import type { Citation } from './types.js';

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
const factWords = (value: string): string[] => (value.toLocaleLowerCase('en-US').match(/[a-z\u00c0-\u024f\d]{3,}/gu) ?? []);
const factValueWords = (value: string): string[] => {
  const match = value.match(/\b(?:is|as|requested)\s+(.+?)(?:[.!?]|$)/iu);
  return factWords(match?.[1] ?? value);
};
const factAppearsIn = (answer: string, fact: V2VerifiedFact): boolean => {
  const normalized = answer.toLocaleLowerCase('en-US');
  const value = factValueWords(fact.text);
  const numbers = value.filter((word) => /\d/u.test(word));
  const labels = value.filter((word) => !/\d/u.test(word));
  return value.length > 0
    && numbers.every((word) => normalized.includes(word))
    && labels.every((word) => new RegExp(`\\b${word.replace(/s$/u, 's?').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u').test(normalized));
};
const safeFactAcknowledgement = (sentence: string): boolean => /^(?:thanks?(?: for (?:checking|clarifying|confirming|sharing))?|understood|got it|okay|ok|sure|that makes sense)\.?$/iu.test(sentence.trim());
const safeUncertainty = (sentence: string): boolean => /\b(?:i (?:cannot|can't|can’t|do not|don't|don’t) (?:verify|confirm|have)|there (?:is|are) no (?:verified|approved))\b/iu.test(sentence)
  && !/\b(?:legally registered|registered successfully|is eligible|are eligible|is created|are created|is complete|are complete|is completed|are completed|costs?|requires?|includes?|paid|signed)\b/iu.test(sentence)
  && !/\b(?:your|the|this|that)\b[\s\S]{0,60}\b(?:costs?|requires?|includes?|is complete|are complete|is created|are created|is registered|are registered|is paid|is signed)\b/iu.test(sentence);
const safeOutcomeAbstention = (sentence: string): boolean => /^\s*(?:i(?:'|’)ll|i will)\s+wait for verified evidence and (?:i\s+)?(?:won't|won’t|will not)\s+assume (?:the )?(?:account|opportunity|payment|invoice|contract)\s+(?:is|was)\s+(?:complete|completed|created|registered|paid|signed)\.?\s*$/iu.test(sentence);
const customerFactReflection = (sentence: string, facts: V2VerifiedFact[]): boolean => {
  const matching = facts.filter((fact) => factAppearsIn(sentence, fact));
  if (safeUncertainty(sentence)) return true;
  if (matching.length === 0) return safeFactAcknowledgement(sentence) || safeUncertainty(sentence);
  if (/\b(?:legally registered|registered successfully|is eligible|are eligible|is created|are created|is completed|are completed|costs?|requires?|includes?)\b/iu.test(sentence)) return false;
  const vocabulary = new Set([...matching.flatMap((fact) => factWords(fact.text)), 'thanks', 'checking', 'clarifying', 'confirming', 'sharing', 'noted', 'note', 'setup', 'keep', 'keeping', 'unchanged', 'current', 'still', 'view', 'details', 'detail', 'target', 'start', 'started', 'expect', 'expected', 'want', 'get', 'moving', 'move', 'outline', 'general', 'process', 'once', 'continue', 'file', 'rather', 'may', 'need', 'needs', 'count', 'have', 'has', 'your', 'company', 'structure', 'activity', 'visa', 'visas', 'timeline', 'number', 'type', 'said', 'told', 'mentioned', 'requested']);
  return factWords(sentence).every((word) => vocabulary.has(word));
};
const relaxedEvidenceText = (value: string): string => value.replace(/\b(?:i|can|help|with|that|the|only|see|shows?|confirm|request|company|formation|journey|specific|process|option|details?|review|information|currently|from|have|your|our|still|yet|right|now|further|outcome|after|things|moving|keep|keeping|what|would|like|this|these|those|into|before|once|continue|general|outline|rather|may)\b/giu, ' ').replace(/\s+/gu, ' ').trim();
const safeCurrentStatusParaphrase = (sentence: string, citedText: string): boolean => /\b(?:not complete|currently at|no server-authorized requirement|no further verified action)\b/iu.test(sentence)
  && /\b(?:authoritative journey|current (?:workflow )?status|current(?:ly)? at|server-authorized requirement|verified action|awaiting verified provider evidence)\b/iu.test(citedText);
const evidenceGrounded = (answer: string, evidence: ModelEvidence[], citations: Citation[], trustedFacts: string): boolean => {
  const citedText = `${evidence.filter((item) => citations.some((citation) => citation.chunkId === item.citation.chunkId)).map((item) => item.content).join(' ')} ${trustedFacts}`;
  const groundedSentence = (sentence: string): boolean => safeFactAcknowledgement(sentence)
    || safeUncertainty(sentence)
    || hasSufficientEvidence(sentence, evidence, citations, trustedFacts)
    || hasSufficientEvidence(relaxedEvidenceText(sentence), evidence, citations, trustedFacts)
    || safeCurrentStatusParaphrase(sentence, citedText);
  return hasSufficientEvidence(answer, evidence, citations, trustedFacts)
    || hasSufficientEvidence(relaxedEvidenceText(answer), evidence, citations, trustedFacts)
    || sentences(answer).every(groundedSentence);
};
const mixedEvidenceGrounded = (answer: string, evidence: ModelEvidence[], citations: Citation[], trustedFacts: string, facts: V2VerifiedFact[]): boolean => sentences(answer).every((sentence) => customerFactReflection(sentence, facts) || evidenceGrounded(sentence, evidence, citations, trustedFacts));
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
  if (/^(?:hi|hello|hey)[,!]?\s+i can help(?: you)?(?: with that| with your (?:request|company formation))?$/iu.test(value)) return true;
  return /^(?:thanks?(?: you)?(?: for (?:sharing|clarifying|confirming|explaining)(?: (?:that|the details|those details|your request))?)?|understood|got it|okay|ok|sure|of course|certainly|that makes sense|i understand|i see|no problem|happy to help)$/iu.test(value)
    || /^i (?:can|would be happy to|am happy to)(?: help(?: you)?(?: work through (?:that|this))?| guide you| walk you through (?:that|it|the steps))(?: (?:with|on|through) (?:that|this|your (?:request|setup|company formation|company-formation request)|the (?:process|next steps)))?$/iu.test(value)
    || /^i(?:'|’)ll (?:keep|bear) (?:your|those|the) (?:details|requirements|request|company-formation request) in (?:mind|view)$/iu.test(value)
    || /^i (?:can(?:'|’)t|cannot) (?:verify|confirm) [\s\S]{1,170} (?:from|with|based on) (?:the )?(?:approved information|approved sources|what i have)(?: yet| right now| at this time)?$/iu.test(value)
    || /^i (?:don(?:'|’)t|do not|can(?:'|’)t|cannot) (?:have (?:a )?verified (?:answer|information|details)(?: (?:for|about|on|to) (?:that|this|the specific (?:detail|question)))?(?: yet)?|want to guess(?: about that)?|verify that (?:detail|claim) yet)$/iu.test(value);
};

const uncitedQuestion = (answer: string, question: string | null): boolean => {
  if (!question || !answer.trim().endsWith(question.trim())) return false;
  const preface = answer.trim().slice(0, answer.trim().length - question.trim().length).trim();
  return !preface || nonFactualPreface(preface);
};

const safeNoEvidenceDialogue = (answer: string, question: string | null, pendingRequirementKey: string | null = null): boolean => {
  // Disallow business consequences, authority claims, numbers, deadlines and links
  // without approved evidence even when the rest of the reply is conversational.
  const controlledUncertainty = /^\s*i (?:can(?:'|’)t|cannot) (?:verify|confirm)\b/iu.test(answer) || safeOutcomeAbstention(answer);
  const containsBlockedClaim = /\b(?:aed|usd|gbp|eur|dollars?|dirhams?|fees?|prices?|costs?|invoices?|paid|payment|eligible|eligibility|guaranteed|guarantee|registered|registration|created|uploaded|completed|signed|legal(?:ly)?|law|policy|licen[cs]e|approved|confirmed|successful|visa issued|will take|takes? \d+|within \d+)\b|\b\d+(?:[.,]\d+)?\s*(?:days?|hours?|weeks?|months?|visas?)\b|https?:\/\//iu.test(answer);
  if (containsBlockedClaim && !controlledUncertainty) return false;
  if (answer.length > 500) return false;
  if (!question && (uncitedConversation(answer) || safeOutcomeAbstention(answer)
    || /^(?:of course|absolutely|sure)[,!.\s—-]+i(?:'|’)ll keep your company-formation request active while you ask your questions\.?$/iu.test(answer.trim())
    || (/^(?:in general,\s+)?(?:forming|setting up) (?:a|the) company means\b[\s\S]*$/iu.test(answer.trim())
      && !/\b(?:usually|typically|required|eligible|price|cost|licen[cs]e|legal|regulation|policy|timeline|days?|weeks?|months?)\b/iu.test(answer)))) return true;
  if (question) {
    if (!answer.trim().endsWith(question.trim()) || !/\?\s*$/u.test(question)) return false;
    if (!/^(?:what|which|who|when|where|how|could you|would you|can you|do you|are you|is there|please|tell me|have you)\b/iu.test(question.trim())) return false;
  }
  const preface = question ? answer.trim().slice(0, answer.trim().length - question.trim().length).trim() : answer.trim();
  if (!preface) return Boolean(question);
  const segments = preface.split(/(?<=[.!])\s+/u).filter(Boolean);
  const pendingTerms = pendingRequirementKey?.split('_').filter((term) => term.length >= 3) ?? [];
  const pendingRequirementPreface = (segment: string): boolean => pendingTerms.length > 0
    && /\b(?:still need|missing requirement|missing detail|remaining detail|to continue)\b/iu.test(segment)
    && pendingTerms.some((term) => segment.toLocaleLowerCase('en-US').includes(term));
  return segments.length <= 2 && segments.every((segment) => nonFactualPreface(segment) || pendingRequirementPreface(segment));
};
export const addVerifiedFactCitations = (response: PersonaComposedResponseV2, facts: V2VerifiedFact[]): PersonaComposedResponseV2 => {
  const matching = facts.filter((fact) => fact.verified && factAppearsIn(response.answer, fact));
  if (matching.length === 0) return response;
  const citationIds = [...new Set([...response.citationIds, ...matching.map((fact) => fact.factId)])];
  return citationIds.length === response.citationIds.length ? response : { ...response, citationIds };
};
const verdict = (accepted: boolean, reasonCode: ResponseGuardVerdictV2['reasonCode'], response: PersonaComposedResponseV2 | null): ResponseGuardVerdictV2 => ({ schemaVersion: 2, accepted, reasonCode, response });

export const verifyV2ResponseEvidence = (input: unknown, evidence: V2ApprovedEvidence[], facts: V2VerifiedFact[] = [], options: { conversational?: boolean; allowUncitedQuestion?: boolean; allowNonFactualDialogue?: boolean; allowApprovedFallback?: boolean; pendingRequirementKey?: string | null } = {}): V2EvidenceDecision => {
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
  const answerForEvidence = response.nextQuestion && response.answer.trim().endsWith(response.nextQuestion.trim())
    ? response.answer.trim().slice(0, -response.nextQuestion.trim().length).trim()
    : response.answer;
  const grounded = options.allowApprovedFallback === true && citationIds.length === 0
    ? true
    : citationIds.length === 0 && options.allowNonFactualDialogue === true
    ? safeNoEvidenceDialogue(response.answer, response.nextQuestion, options.pendingRequirementKey ?? null)
    : options.conversational === true && citationIds.length === 0
    ? uncitedConversation(response.answer) || (options.allowUncitedQuestion === true && uncitedQuestion(response.answer, response.nextQuestion))
    : citationIds.length > 0 && (evidenceGrounded(answerForEvidence, modelEvidence, citations, trustedFacts)
      || (citedFacts.length > 0 && mixedEvidenceGrounded(answerForEvidence, modelEvidence, citations, trustedFacts, citedFacts)));
  if (!grounded) return { verdict: verdict(false, citationIds.length === 0 ? 'unsupported_claim' : 'unsupported_claim', null), claims: [] };
  const sourceVersions = [...new Set([...citedEvidence.map((item) => item.sourceVersion), ...citedFacts.map((item) => item.sourceVersion)])];
  const claims = sentences(response.answer).map((claim) => ({ claimDigest: digest(claim), citationIds, sourceVersions }));
  return { verdict: verdict(true, 'accepted', response), claims };
};

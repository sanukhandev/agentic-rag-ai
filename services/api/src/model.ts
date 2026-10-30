import type { Citation, FollowUpOfferOption, IntentCatalog, LeadData, PendingFollowUpOffer } from './types.js';

export interface ModelEvidence { citation: Citation; content: string; }
export interface ModelPersona { name: string; greeting: string; personality: string; tone: string; speakingStyle: string; permittedLanguages: string[]; }
export interface ConversationTurn { role: 'user' | 'assistant'; content: string; }
export interface ModelDraft {
  answer: string;
  citationIds: string[];
  proposedIntent: string | null;
  followUpOptions?: FollowUpOfferOption[] | null | undefined;
}

export interface ModelTrustedContext { tenantId: string; sessionId: string; }

export interface ModelToolCall { name: string; input: Record<string, string | number | boolean | null>; }
export interface ModelToolPlan { calls: ModelToolCall[]; }

export type OfferReplyAction = 'accept' | 'reject' | 'select_option' | 'clarify' | 'new_request' | 'unknown';
export interface ModelOfferReply { action: OfferReplyAction; optionKey?: string | null; confidence: number; }

export interface QueryNormalizationInput {
  maskedMessage: string;
  catalog: Pick<IntentCatalog, 'intents' | 'signals' | 'relations'>;
  conversation?: ConversationTurn[];
  selectedIntentKey?: string | null;
}

export interface ModelFollowUpContext {
  leadCaptured: boolean;
  primaryIntentKey: string | null;
  workflowStatus?: string;
  phase?: string;
  capturedSlots?: Record<string, string>;
  conversationSummary?: string;
  detectedSecondaryIntentKey?: string | null;
  continuityTurn?: boolean;
  responseMode?: 'slot_collection' | 'intent_clarification' | 'consent' | 'confirmation' | 'document_collection' | 'document_processing' | 'knowledge' | 'mixed' | 'follow_up' | 'queued' | 'reconcile_follow_up' | 'offer_clarification';
  pendingOffer?: PendingFollowUpOffer | null;
  resolvedOfferOption?: FollowUpOfferOption | null;
  nextSlotLabel?: string | null;
  nextRequirement?: { requirementKey: string; requirementType: string; promptKey: string; documentType?: string | null; label?: string | null } | null;
  documentPolicies?: Array<{
    intentKey: string;
    requestMode: string;
    required: boolean;
    requestPromptKey: string;
    allowedDocumentTypes: string[];
  }>;
  documentStatus?: string[];
  agentToolResults?: Array<{ name: string; ok: boolean; data: Record<string, unknown> }>;
}

export interface CrmSummaryInput {
  maskedSummary: string;
  conversation: ConversationTurn[];
  intent: string;
  secondaryIntentKeys: string[];
  score: number;
  validationPass: boolean;
}

export interface ChatModel {
  plan?(input: { maskedMessage: string; availableTools: readonly string[]; conversationSummary: string; activeIntentKey: string | null }): Promise<ModelToolPlan>;
  draft(input: { maskedMessage: string; evidence: ModelEvidence[]; personaName: string; ownerName?: string; persona?: ModelPersona; conversation?: ConversationTurn[]; followUpContext?: ModelFollowUpContext; trustedContext?: ModelTrustedContext }): Promise<ModelDraft>;
  compose?(input: { maskedMessage: string; evidence: ModelEvidence[]; personaName: string; ownerName?: string; persona?: ModelPersona; conversation?: ConversationTurn[]; followUpContext?: ModelFollowUpContext }): Promise<ModelDraft>;
  normalizeQuery?(input: QueryNormalizationInput): Promise<string | null>;
  classifyOfferReply?(input: { maskedMessage: string; offer: PendingFollowUpOffer; conversation?: ConversationTurn[]; conversationSummary?: string; activeIntentKey?: string | null }): Promise<ModelOfferReply>;
  summarize?(input: CrmSummaryInput): Promise<string>;
}

const numberWords: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };

/** Keeps the fallback tenant-neutral: it only removes formatting noise and normalizes compact quantities. */
export const normalizeConversationQuery = (text: string): string => text
  .normalize('NFKC')
  .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/gu, ' ')
  .replace(/\b(\d+(?:\.\d+)?)[kK]\b/gu, '$1 thousand')
  .replace(new RegExp(`\\b(${Object.keys(numberWords).join('|')})\\b`, 'giu'), (word) => numberWords[word.toLowerCase()] ?? word)
  .replace(/[“”]/gu, '"')
  .replace(/[‘’]/gu, "'")
  .replace(/\s+/gu, ' ')
  .trim()
  .slice(0, 4_000);

const offerReplyText = (text: string): string => normalizeConversationQuery(text).toLocaleLowerCase('en-US');
const offerAffirmation = /^(?:yes|yeah|yep|sure|okay|ok|please do|go ahead|tell me more|please explain|that would help|i(?:'d| would) like that)(?:[\s,.]*(?:please|sure|yes|go ahead))*[.!]*$/iu;
const offerRejection = /^(?:no|nope|not now|later|not yet|maybe later|decline|reject|stop|nothing else|i(?:'m| am) done)[.!]*$/iu;
const offerReplyQuestion = /(?:[?؟]$|^(?:what|how|where|which|why|when|who|can|could|would|is|are|does|should|will)\b|^do\s+(?:you|we|they|i)\b)/iu;
const offerReplyMinimumConfidence = 0.75;

/** Resolves only against the currently persisted offer; it never chooses a business intent. */
export const classifyOfferReplyDeterministically = (maskedMessage: string, offer: PendingFollowUpOffer): ModelOfferReply => {
  const message = offerReplyText(maskedMessage);
  if (offerRejection.test(message)) return { action: 'reject', confidence: 1 };
  if (!offerAffirmation.test(message) && offerReplyQuestion.test(message)) return { action: 'new_request', confidence: 1 };
  const matches = offer.options.filter((option) => [option.key, option.label, ...option.retrievalHints]
    .map(offerReplyText)
    .some((candidate) => candidate.length >= 3 && (message === candidate || message.includes(candidate))));
  if (matches.length > 0 && /\b(?:do not|don't|not|never|without|no)\b/iu.test(message)) return { action: 'clarify', confidence: 1 };
  if (matches.length === 1) return { action: 'select_option', optionKey: matches[0]?.key ?? null, confidence: 1 };
  if (matches.length > 1) return { action: 'clarify', confidence: 1 };
  if (offerAffirmation.test(message)) return offer.options.length === 1
    ? { action: 'accept', optionKey: offer.options[0]?.key ?? null, confidence: 1 }
    : { action: 'clarify', confidence: 1 };
  if (hasLeadIntent(message)) return { action: 'new_request', confidence: 1 };
  const conversational = conversationalIntent(message);
  if (conversational && conversational !== 'acknowledgement') return { action: 'new_request', confidence: 1 };
  if (/^(?:what|how|where|which|why|when|who|can|could|would|tell me|please explain)\b/iu.test(message)) return { action: 'new_request', confidence: 1 };
  return { action: 'unknown', confidence: 0 };
};

export const classifyOfferReply = async (model: ChatModel, input: { maskedMessage: string; offer: PendingFollowUpOffer; conversation?: ConversationTurn[]; conversationSummary?: string; activeIntentKey?: string | null }): Promise<ModelOfferReply> => {
  if (input.offer.intentKey && input.activeIntentKey && input.offer.intentKey !== input.activeIntentKey) return { action: 'new_request', optionKey: null, confidence: 1 };
  const deterministic = classifyOfferReplyDeterministically(input.maskedMessage, input.offer);
  if (deterministic.action !== 'unknown' || !model.classifyOfferReply) return deterministic;
  try {
    const result = await model.classifyOfferReply(input);
    const validKey = result.optionKey && input.offer.options.some((option) => option.key === result.optionKey) ? result.optionKey : null;
    const confidence = Number.isFinite(result.confidence) ? Math.min(Math.max(result.confidence, 0), 1) : 0;
    if (confidence < offerReplyMinimumConfidence) return { action: 'unknown', optionKey: null, confidence };
    if (result.action === 'accept') {
      const onlyOption = input.offer.options.length === 1 ? input.offer.options[0] : null;
      if (!onlyOption || (validKey && validKey !== onlyOption.key)) return { action: 'clarify', optionKey: null, confidence };
      return { action: 'accept', optionKey: onlyOption.key, confidence };
    }
    if (result.action === 'select_option' && !validKey) return { action: 'clarify', optionKey: null, confidence };
    return { action: result.action, optionKey: result.action === 'select_option' ? validKey : null, confidence };
  } catch {
    return deterministic;
  }
};

const normalizationNumbers = (text: string): string[] => normalizeConversationQuery(text).match(/\b\d+(?:\.\d+)?\b/gu) ?? [];
const normalizationNegation = (text: string): boolean => /\b(?:no|not|never|don't|do not|doesn't|does not|didn't|did not|without|neither|nor|can't|cannot|won't|will not)\b|(?:لا|ليس|لست|لن|بدون)/iu.test(text);
const normalizationTokens = (text: string): string[] => text.match(/\[(?:EMAIL|PHONE|NAME)_\d+\]/gu) ?? [];

export const preservesNormalizationFacts = (original: string, normalized: string): boolean => {
  const sorted = (values: string[]): string[] => [...values].sort();
  return normalizationNegation(original) === normalizationNegation(normalized)
    && JSON.stringify(sorted(normalizationNumbers(original))) === JSON.stringify(sorted(normalizationNumbers(normalized)))
    && JSON.stringify(sorted(normalizationTokens(original))) === JSON.stringify(sorted(normalizationTokens(normalized)));
};

export const naturalAbstention = (
  language = 'en',
  request = '',
  context?: { capturedSlots?: Record<string, string> },
): string => {
  const normalizedRequest = normalizeConversationQuery(request).toLocaleLowerCase('en-US');
  const topic = /\b(?:price|pricing|cost|fee|quote|quotation)\b/u.test(normalizedRequest)
    ? 'the pricing for this setup'
    : /\b(?:step|steps|process|procedure|register|registration|formation)\b/u.test(normalizedRequest)
      ? 'the setup steps'
      : /\b(?:timeline|timelines|when|how long|processing time|duration|timeframe|days?|weeks?|months?)\b/u.test(normalizedRequest)
        ? 'the setup timeline'
      : /\bvisa\b/u.test(normalizedRequest)
        ? 'the visa details'
        : /\b(?:package|option)\b/u.test(normalizedRequest)
          ? 'the package options'
          : 'that specific setup detail';
  const slots = context?.capturedSlots ?? {};
  const known = [
    slots.visa_count ? `${slots.visa_count} visa${slots.visa_count === '1' ? '' : 's'}` : '',
    slots.workspace_preference ?? '',
    slots.timeline ? `a ${slots.timeline} start` : '',
    slots.budget_aed ? `a budget of AED ${slots.budget_aed}` : '',
  ].filter(Boolean).join(', ');
  if (language === 'ar') return `لا أستطيع تأكيد ${topic} من المعلومات المعتمدة المتاحة حاليًا. سأحتفظ بمتطلباتك الحالية${known ? ` (${known})` : ''}، ويمكنني طلب عرض سعر موثق أو مراجعة من مستشار. هل تريدني أن أطلب ذلك؟`;
  return `I can’t verify ${topic} from the approved information currently available. I’ll keep your current requirements${known ? ` (${known})` : ''} in view, and I can request a verified quotation or advisor review. Would you like me to request that?`;
};
export const permittedLanguageReply = (language: string, permittedLanguages: string[]): string => language === 'ar'
  ? `يمكنني الإجابة فقط باللغات المسموح بها: ${permittedLanguages.join('، ')}.`
  : `I can only answer in the permitted languages: ${permittedLanguages.join(', ')}.`;

export const hasLeadIntent = (text: string): boolean => !/\b(?:what(?:'s| is)|where is|who is|do you have|give me|find)\b.{0,40}\b(?:email|phone|contact|linkedin|github)\b/i.test(text) && /\b(?:contact\s+me|call\s+me|email\s+me|reach\s+(?:out\s+to\s+)?me|(?:i(?:'m| am)|we(?:'re| are))\s+interested\s+in|(?:i|we)\s+(?:would\s+like|want|need)\s+(?:to\s+)?(?:get\s+)?(?:a\s+)?(?:demo|quote|consultation|meeting|call|service(?:s)?)|(?:book|schedule|request|arrange|set\s+up)\s+(?:a\s+)?(?:demo|quote|call|consultation|meeting|appointment|service(?:s)?)|(?:i(?:'d| would)\s+like\s+to\s+|i\s+want\s+to\s+|we\s+want\s+to\s+)(?:hire|engage|work\s+with)|speak\s+(?:to|with)\s+(?:someone|an?\s+expert))\b/i.test(text);
export const extractLeadData = (text: string): LeadData => {
  const data: LeadData = {};
  const name = text.match(/\[NAME_\d+\]/u)?.[0];
  const email = text.match(/\[EMAIL_\d+\]/u)?.[0];
  const phone = text.match(/\[PHONE_\d+\]/u)?.[0];
  if (name) data.name = name;
  if (email) data.email = email;
  if (phone) data.phone = phone;
  return data;
};
export const mergeLeadData = (...values: LeadData[]): LeadData => {
  const merged: LeadData = {};
  for (const value of values) {
    if (value.name) merged.name = value.name;
    if (value.email) merged.email = value.email;
    if (value.phone) merged.phone = value.phone;
    if (value.slotValues) merged.slotValues = { ...(merged.slotValues ?? {}), ...value.slotValues };
  }
  return merged;
};
export const leadCollectionReply = (data: LeadData, invalidField?: 'name' | 'email' | 'phone' | null): string => {
  if (invalidField === 'name' || !data.name) return 'I’d be happy to help. What name should I use?';
  if (invalidField === 'email' || !data.email) return 'Thanks. What email address should I use?';
  if (invalidField === 'phone' || !data.phone) return 'Thanks. What phone number, including country code, should I use?';
  return 'I have the contact details needed. Please explicitly consent before I register the request.';
};

export class DeterministicGroundedModel implements ChatModel {
  async draft(input: { maskedMessage: string; evidence: ModelEvidence[]; personaName: string; ownerName?: string; persona?: ModelPersona; conversation?: ConversationTurn[]; followUpContext?: ModelFollowUpContext }): Promise<ModelDraft> {
    if (input.followUpContext?.responseMode === 'reconcile_follow_up') return { answer: 'I’ll keep the conversation open while this is reviewed. What would you like to go over next?', citationIds: [], proposedIntent: null };
    if (input.followUpContext?.continuityTurn) return { answer: 'Thanks, I’ve noted that. What would you like to explore next?', citationIds: [], proposedIntent: null };
    if (input.followUpContext?.responseMode === 'knowledge' || input.followUpContext?.responseMode === 'mixed') {
      const query = input.maskedMessage.toLocaleLowerCase('en-US');
      const boilerplate = /answer only from approved|knowledge base|retrieval metadata|source validation|validate all prices|ingestion|do not invent|where the answer depends on|use this knowledge domain|retrieval instructions|source reference/iu;
      const sentences = input.evidence.flatMap((item) => item.content.split(/(?<=[.!?])\s+|\n+/u)
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length > 24 && !boilerplate.test(sentence))
        .map((sentence) => ({ sentence, chunkId: item.citation.chunkId })));
      const queryTerms = query.match(/[a-z]{4,}/gu) ?? [];
      const selected = [...new Map(sentences
        .map((item) => ({ ...item, score: queryTerms.filter((term) => item.sentence.toLocaleLowerCase('en-US').includes(term)).length }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map((item) => [item.sentence.toLocaleLowerCase('en-US'), item])).values()];
      const known = input.followUpContext.capturedSlots ?? {};
      const availablePackages = input.followUpContext.agentToolResults?.find((result) => result.name === 'get_available_packages' && result.ok)?.data.packages;
      const packageRows = Array.isArray(availablePackages) ? availablePackages.filter((row): row is { name: string; visas?: number; officeRequirement?: string } => typeof row === 'object' && row !== null && typeof row.name === 'string') : [];
      const pricing = input.followUpContext.agentToolResults?.find((result) => result.name === 'get_authoritative_pricing' && result.ok)?.data.pricing;
      const pricingRows = Array.isArray(pricing) ? pricing.filter((row): row is { name: string; amountMinor: number; currency: string } => typeof row === 'object' && row !== null && typeof row.name === 'string' && typeof row.amountMinor === 'number' && typeof row.currency === 'string') : [];
      const packageAnswer = /\b(?:package|packages|option|options)\b/u.test(query) && packageRows.length > 0
        ? `The approved packages currently available are ${packageRows.map((row) => { const price = pricingRows.find((candidate) => candidate.name === row.name); return `${row.name}${typeof row.visas === 'number' ? ` with ${row.visas} visa${row.visas === 1 ? '' : 's'}` : ''}${row.officeRequirement ? ` (${row.officeRequirement})` : ''}${price ? ` at ${price.currency} ${(price.amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}`; }).join('; ')}.`
        : null;
      const pricingAnswer = /\b(?:price|pricing|cost|fee|fees|quote|quotation)\b/u.test(query) && pricingRows.length > 0
        ? `The approved package pricing currently available for this setup is ${pricingRows.map((row) => `${row.name}: ${row.currency} ${(row.amountMinor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`).join('; ')}.`
        : null;
      const timelineAnswer = /\b(?:timeline|timelines|how long|processing time|duration)\b/u.test(query)
        ? 'I cannot confirm an approved processing timeline for this setup from the current catalog.'
        : null;
      const nextQuestion = input.followUpContext.nextSlotLabel
        ? `What ${input.followUpContext.nextSlotLabel.toLocaleLowerCase('en-US').replace(/^what\s+/u, '')} would you like to use for this setup?`
        : known.business_activity ? 'Would you like me to compare the approved package options for this setup?' : 'What business activity would you like to register?';
      const evidenceAnswer = packageAnswer ? '' : selected.map((item) => item.sentence).join(' ');
      if (packageAnswer || pricingAnswer || timelineAnswer || selected.length > 0) return { answer: `${[packageAnswer, pricingAnswer, timelineAnswer, evidenceAnswer].filter(Boolean).join(' ')} ${nextQuestion}`, citationIds: packageAnswer ? [] : selected.map((item) => item.chunkId), proposedIntent: null };
    }
    const wantsLead = /\b(contact|call|email|interested|demo|quote)\b/i.test(input.maskedMessage);
    return { answer: naturalAbstention(detectedLanguage(input.maskedMessage), input.maskedMessage, input.followUpContext), citationIds: [], proposedIntent: wantsLead ? 'lead.capture' : null };
  }
}

export const detectedLanguage = (text: string): string => /[\u0600-\u06ff]/u.test(text) ? 'ar' : 'en';
export const isPermittedLanguage = (text: string, permittedLanguages: string[]): boolean => permittedLanguages.some((language) => language.toLowerCase().split('-')[0] === detectedLanguage(text));
export type ConversationalIntent = 'greeting' | 'wellbeing' | 'identity' | 'introduction' | 'clarification' | 'thanks' | 'farewell' | 'acknowledgement';

export const conversationalIntent = (text: string): ConversationalIntent | null => {
  const normalized = text.toLowerCase().replace(/[\u064b-\u065f]/gu, '').replace(/[؟،؛]/gu, ' ').replace(/[أإآ]/gu, 'ا').replace(/ى/gu, 'ي').replace(/[^a-z0-9\u0600-\u06ff]+/gu, ' ').trim();
  if (/^(?:(?:hi|hello|hey|hiya)(?: there)?(?: [a-z0-9]+)?|(?:hi|hello|hey|hiya)(?:,? (?:good )?(?:morning|afternoon|evening))?|(?:hi|hello|hey|hiya) how (?:are you(?: doing)?|(?:is|s|z) (?:it )?going)|good (?:morning|afternoon|evening)(?: there)?)$/u.test(normalized)) return 'greeting';
  if (/^(?:مرحبا|اهلا|السلام عليكم|صباح الخير|مساء الخير)(?: يا [\u0600-\u06ff]+)?$/u.test(normalized)) return 'greeting';
  if (/^(?:how are you(?: doing)?|how (?:is|s|z) (?:it )?going|what (?:is|s) up|how (?:is|s) your day)$/u.test(normalized)) return 'wellbeing';
  if (/^(?:i m|im|i am) (?:good|fine|great|well)|^(?:doing|feeling) (?:good|fine|great|well)$/u.test(normalized)) return 'wellbeing';
  if (/^(?:كيف حالك|كيف حالكم|كيف امورك|كيف انت|انا بخير|انا جيد|تمام)$/u.test(normalized)) return 'wellbeing';
  if (/^(?:who|what) are you$|^(?:what can you|how can you) (?:do|help)$|^(?:so )?what(?: (?:is|s))? your name$|^tell me your name$/u.test(normalized)) return 'identity';
  if (/^(?:من انت|ما اسمك|ماذا تستطيع|كيف تساعد)$/u.test(normalized)) return 'identity';
  const introduction = normalized.match(/^(?:i m|im|i am|my name is|this is) (.+)$/u)?.[1];
  if (introduction && introduction.split(' ').length <= 4 && !/\b(?:looking|interested|trying|here|asking|calling|working|planning|starting|setting|going|from|based)\b/u.test(introduction)) return 'introduction';
  if (/^(?:what|why|huh|sorry|pardon|come again)[!?.,\s]*$/u.test(normalized)) return 'clarification';
  if (/^(?:thanks|thank you)(?: very much| so much)?|^(?:much )?appreciate it$/u.test(normalized)) return 'thanks';
  if (/^(?:شكرا|مشكور|مشكورة|جزاك الله خيرا)$/u.test(normalized)) return 'thanks';
  if (/^(?:bye|goodbye|see you|talk to you later|have a good (?:day|one)|that (?:is|s) all(?: for now| bye)?|i (?:am|m) done|nothing (?:more|else)(?: i need)?(?: for now)?|no more (?:questions|help)(?: needed)?|i (?:do not|don't) need anything (?:else|more))(?: thank you| thanks?)?$/u.test(normalized)) return 'farewell';
  if (/^(?:مع السلامة|الى اللقاء|وداعا|باي)$/u.test(normalized)) return 'farewell';
  if (/^(?:ok|okay|sure|yes|yeah|yep|got it|sounds good|great|nice|cool|perfect)$/u.test(normalized)) return 'acknowledgement';
  if (/^(?:حسنا|نعم|موافق|رائع)$/u.test(normalized)) return 'acknowledgement';
  return null;
};

export const isGreeting = (text: string): boolean => conversationalIntent(text) !== null;
export const needsConversationContext = (text: string): boolean => {
  const normalized = text.toLowerCase().trim();
  return /\b(?:it|that|this|he|him|her|his|them|there|again|more|also|now|working|company|resume|email|phone|linkedin|github|connect|find|yes|yeah|yep|sure|continue|go on)\b|\b(?:what about|tell me more|please do)\b|^(?:what|where|which|how|why)(?:\s+\w+)?[?!.,]*$/u.test(normalized);
};

export const isKnowledgeQuestion = (text: string): boolean => {
  const normalized = normalizeConversationQuery(text).toLocaleLowerCase('en-US');
  const conversational = conversationalIntent(normalized);
  if (conversational !== null && conversational !== 'clarification') return false;
  const directActionRequest = /^(?:can|could|would)\s+(?:i|you)\s+(?:book|schedule|request|arrange|register|call|contact)\b|^(?:book|schedule|request|arrange|register)\s+(?:a\s+)?(?:demo|quote|call|consultation|meeting|appointment|service|business)\b/u.test(normalized);
  const embeddedQuestion = /\b(?:what|how|where|which|why|when)\s+(?:are|is|do|does|can|could|should|to)\b[\s\S]{0,120}/u.test(normalized);
  const setupConsultation = /^(?:i|we)\s+(?:would like|want|need|plan|intend)\s+to\s+(?:start|set up|setup|open|form|register|establish)\s+(?:an?|the)\s+\S+(?:\s+\S+){0,3}\s+(?:company|business|firm)\b/u.test(normalized);
  return !directActionRequest && (/[?؟]/u.test(normalized)
    || /^(?:what|how|where|which|why|when|who|can(?: you)?|could(?: you)?|would(?: you)?|is|are|does|should|will|do\s+(?:you|we|they|i)|tell me|please explain)\b/u.test(normalized)
    || /\b(?:i(?:'d| would| want)|we(?:'d| would| want)|would) like to know\b/u.test(normalized)
    || /\b(?:want|need|would like)\s+to know\b/u.test(normalized)
    || /\bi want to understand\b/u.test(normalized)
    || embeddedQuestion
    || setupConsultation);
};

/** A short non-question can answer the last journey question without being a knowledge query. */
export const isContextualReply = (text: string): boolean => {
  const normalized = normalizeConversationQuery(text).toLocaleLowerCase('en-US');
  if (!normalized || normalized.length > 240 || /[?؟]/u.test(normalized)) return false;
  if (/^(?:what|how|where|which|why|when|who|can|could|would|do|does|is|are|tell me|please explain)\b/u.test(normalized)) return false;
  return /^(?:yes|yeah|yep|sure|okay|ok|no|not yet|i(?:'m| am)|we(?:'re| are)|my|our)\b/u.test(normalized)
    || /\b(?:week|weeks|month|months|day|days|visa|visas|budget|aed|office|desk|shareholder|employee|employees|timeline|urgent|asap|passport|license|licence)\b/u.test(normalized);
};

/** A visitor can reject a repeated slot question without supplying a replacement value. */
export const isCatalogSlotNonAnswer = (text: string): boolean => {
  const normalized = normalizeConversationQuery(text).toLocaleLowerCase('en-US');
  return /^(?:i|we)\s+(?:already\s+)?(?:told|said|mentioned|shared)\b|^(?:as|like)\s+i\s+(?:already\s+)?(?:told|said|mentioned)|\b(?:you\s+already\s+(?:have|know)|that(?:'s|\s+is)\s+what\s+i\s+(?:said|told\s+you))\b/iu.test(normalized);
};

/** Allows only a no-fact continuation draft when the model follows the continuity instruction. */
export const isSafeContinuityAnswer = (answer: string, citations: Citation[]): boolean => {
  const normalized = answer.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  if (!normalized || normalized.length > 1_200 || citations.length > 0 || /(?:\$|€|£|aed|\b\d+(?:\.\d+)?\s*%?\b)/u.test(normalized)) return false;
  if (/\b(?:we offer|we provide|our package|our packages|starts at|costs?|prices?|requires?|includes\b|available|guarantee|will be|is located|officially)\b/u.test(normalized)) return false;
  return normalized.includes('?') || /^(?:thanks?|thank you|great|okay|noted|understood|got it|sure|i(?:'ve| have) noted)\b/u.test(normalized);
};
export const isGuidedResponse = (answer: string, mode: 'slot_collection' | 'intent_clarification' | 'consent' | 'confirmation' | 'document_collection' | 'document_processing' | 'queued' | 'follow_up' | 'offer_clarification', slotKey: string | null = null, scopeLabel: string | null = null): boolean => {
  const normalized = answer.normalize('NFKC').toLocaleLowerCase('en-US');
  if (!normalized || normalized.length > 1_200) return false;
  if (/\b(?:verified information|knowledge base|what would you like to explore)\b/u.test(normalized)) return false;
  const guidedSentences = normalized.split(/(?<=[.!?])\s+/u).filter(Boolean);
  const unsupportedFact = /(?:\b(?:aed|usd|eur|gbp|dirham|dollars?)\s*[\d,.]+|\b[\d,.]+\s*(?:aed|usd|eur|gbp|dirham|dollars?)\b|\b(?:we|our|ancfz|the (?:company|tenant))\b.{0,120}\b(?:charge|cost|fee|price|offer|provide|support|include|require|located|based|is|are)\b|\b(?:headquarters|located|based)\b.{0,80}\b(?:in|at)\b|\b(?:license|licence|package|visa|office|company|business|setup|application)\b.{0,100}\b(?:cost|costs|fee|fees|price|prices|charge|charges|issued|approved|processed|completed|takes?|eligible|qualif|require|include|available)\b|\b(?:is|are|was|were|will be|can be|may be)\s+(?:issued|approved|processed|completed|available|eligible|included|required|granted)\b.{0,80}\b(?:hour|day|week|month|visa|license|licence|requirement|document)\b)/u;
  if (['slot_collection', 'intent_clarification', 'consent', 'confirmation', 'document_collection', 'document_processing'].includes(mode) && guidedSentences.some((sentence) => !sentence.endsWith('?') && unsupportedFact.test(sentence))) return false;
  const neutralGuidedSentence = /^(?:thanks?(?:,?\s+i(?:['’]ve| have) noted(?: that)?(?: from earlier)?|\s+for\s+sharing(?: that)?)?|thank you(?:\s+for\s+sharing(?: that)?)?|great(?:[—,]\s+(?:let['’]s keep going|thanks for sharing))?|okay|ok|noted|understood|got it|nice to meet you|i(?:['’]ve| have) noted(?: that)?(?: from earlier)?|i have the details needed|i can help with that|i(?:['’]ve| have) received the requested document(?: and it is being reviewed)?)\.?$/u;
  const guidedRequest = /^(?:please\s+(?:approve|provide|share|send|confirm|tell|let me know)\b|(?:could|can|would|may|shall)\s+(?:you|i)\b|what|which|how|where|when|do you|are you|is your|tell me|share|let me know|to continue,?\s+(?:could|can|would|please)|before i continue,?\s+(?:could|can|would|please))\b/u;
  if (['slot_collection', 'intent_clarification', 'consent', 'confirmation', 'document_collection', 'document_processing'].includes(mode)
    && guidedSentences.some((sentence) => !sentence.endsWith('?') && !neutralGuidedSentence.test(sentence) && !guidedRequest.test(sentence))) return false;
  if (mode === 'consent') return /\b(?:consent|approve|approval|permission|register|submit|proceed|shall i|may i)\b/u.test(normalized)
    && !/(?:\b(?:document|passport|emirates|visa|office|budget|package|cost|price|timeline|require(?:d|s)?|include(?:d|s)?|usually|typically)\b|\baed\b|\b\d+(?:[.,]\d+)?\b)/u.test(normalized);
  if (mode === 'confirmation') {
    const scopeTerms = (scopeLabel ?? '').toLocaleLowerCase('en-US').match(/[\p{L}\p{N}]{4,}/gu) ?? [];
    const scoped = !scopeTerms.length || scopeTerms.some((term) => normalized.includes(term));
    return scoped && /\?|\b(?:confirm|confirmation|yes|no|approve|accept|proceed)\b/u.test(normalized)
      && !/\b(?:we\s+(?:offer|provide|support)|supports?|is feasible|are feasible|typically|normally|usually|starts? at|costs?|prices?|includes?|requires?|available|you can|will be|competitive|fast[- ]track|packages?|headquarters|located|based)\b/u.test(normalized);
  }
  if (mode === 'document_processing') return !/\b(?:upload|attach|send)\b.{0,60}\b(?:again|another|the same)\b/u.test(normalized)
    && !/\b(?:we\s+(?:offer|provide)|supports?|starts? at|costs?|prices?|includes?|requires?|available|headquarters|located|based)\b/u.test(normalized);
  if ((mode === 'slot_collection' || mode === 'intent_clarification' || mode === 'document_collection') && /\b(?:we\s+(?:offer|provide|support)|supports?|well[- ]suited|is feasible|are feasible|typically|normally|usually|starts? at|costs?|prices?|includes?|requires?|available|you can|will be|competitive|fast[- ]track|packages?)\b/u.test(normalized)) return false;
  if (mode !== 'follow_up' && /\b(?:we|our|the (?:company|tenant))\b.{0,120}\b(?:is|are|has|have|offers?|provides?|supports?|requires?|includes?|located|based)\b/u.test(normalized)) return false;
  if (mode === 'slot_collection' && slotKey === 'name' && /\b(?:company|business|trade)\s+name\b/u.test(normalized)) return false;
  if (mode === 'slot_collection' && slotKey === 'phone') return /\b(?:phone|mobile|telephone|number)\b/u.test(normalized) && !/\bemail\b/u.test(normalized);
  if (mode === 'slot_collection' && slotKey === 'email') return /\bemail\b/u.test(normalized) && !/\b(?:phone|mobile|telephone)\b/u.test(normalized);
  return true;
};
export const conversationalReply = (intent: ConversationalIntent, personaName: string, language = 'en', tenantName = 'this tenant'): string => {
  if (language === 'ar') {
    if (intent === 'greeting') return 'مرحبًا! أنا هنا لمساعدتك. ماذا تود أن تستكشف اليوم؟';
    if (intent === 'wellbeing') return 'أنا بخير، شكرًا لسؤالك! كيف يمكنني مساعدتك؟';
    if (intent === 'thanks') return 'على الرحب والسعة! هل هناك شيء آخر تود استكشافه؟';
    if (intent === 'introduction') return `تشرفت بلقائك! أنا ${personaName}. كيف يمكنني مساعدتك اليوم؟`;
    if (intent === 'clarification') return 'أنا معك. ما الجزء الذي تود أن أوضحه لك؟';
    if (intent === 'farewell') return 'سعدت بالدردشة معك. أغلقت هذه المحادثة الآن؛ يمكنك بدء محادثة جديدة متى احتجت.';
    if (intent === 'acknowledgement') return 'رائع، لنكمل. ما الذي تود معرفته بعد ذلك؟';
    return `أنا ${personaName}، المساعد المخصص لـ ${tenantName}. يمكنني مساعدتك في المنتجات والخدمات والمشاريع والمعلومات العامة الموثقة هنا.`;
  }
  if (intent === 'greeting') return `Hi! I’m ${personaName}. What would you like to explore today?`;
  if (intent === 'wellbeing') return 'I’m doing great—thanks for asking! What can I help you discover?';
  if (intent === 'introduction') return `Nice to meet you! I’m ${personaName}. How can I help you today?`;
  if (intent === 'clarification') return 'I’m with you. What would you like me to clarify?';
  if (intent === 'thanks') return 'You’re very welcome! Is there anything else you’d like to explore?';
  if (intent === 'farewell') return 'It was lovely chatting with you. This conversation is now closed; start a new session whenever you’re ready.';
  if (intent === 'acknowledgement') return 'Great—let’s keep going. What would you like to look at next?';
  return `I’m ${personaName}, the configured assistant for ${tenantName}. I can help with the products, services, projects, and public information documented here.`;
};

/** Use the tenant's configured greeting while normalizing accidental spacing between sentences. */
export const openingGreeting = (greeting: string | undefined, personaName: string): string => {
  const normalized = greeting?.replace(/\s+/gu, ' ').replace(/([.!؟?])(?=\p{L})/gu, '$1 ').trim() ?? '';
  return normalized || `Hi! I’m ${personaName}.`;
};
export const hasSufficientEvidence = (answer: string, evidence: ModelEvidence[], citations: Citation[], trustedFacts = ''): boolean => {
  if (citations.length === 0) return false;
  const citedContent = `${evidence.filter((item) => citations.some((citation) => citation.chunkId === item.citation.chunkId)).map((item) => item.content.toLowerCase()).join(' ')} ${trustedFacts.toLocaleLowerCase('en-US')}`;
  const highRisk = ['guarantee', 'guaranteed', 'approved', 'eligible', 'eligibility', 'required', 'requires', 'includes', 'included', 'qualifies', 'available', 'fastest', 'complete in', 'lowest price'];
  return answer.split(/(?<=[.!?])\s+/u).every((claim) => {
    const normalizedClaim = claim.toLocaleLowerCase('en-US');
    const numbers = normalizedClaim.match(/\b\d+(?:[.,]\d+)?\b/g) ?? [];
    if (numbers.some((number) => !citedContent.includes(number))) return false;
    const claimWithoutEmail = normalizedClaim.replace(/\bemail\s+[^\s@]+@[^\s@]+\b/gu, ' pii ').replace(/\b[^\s@]+@[^\s@]+\b/gu, ' pii ');
    const terms = (claimWithoutEmail.match(/[a-z\u00c0-\u024f]{4,}/gu) ?? []).filter((term, index, values) => !['that', 'this', 'with', 'from', 'your', 'approved', 'answer', 'pii', 'here', 'verify', 'verified', 'know', 'information', 'complete', 'step', 'steps'].includes(term) && values.indexOf(term) === index);
    if (terms.length > 0 && !terms.some((term) => citedContent.includes(term))) return false;
    const riskTerms = highRisk.filter((term) => normalizedClaim.includes(term));
    return riskTerms.every((term) => citedContent.includes(term));
  });
};

export const isControlledKnowledgeAbstention = (answer: string): boolean => {
  const normalized = answer.normalize('NFKC').trim().toLocaleLowerCase('en-US');
  return /\b(?:not part of|does not appear|don't appear|do not appear|don't have any information|do not have any information|not available|no approved (?:source )?evidence|cannot verify|can't verify|not documented|not covered|will not choose)\b/iu.test(normalized)
    || /^(?:i can help|how can i help|what would you like to focus on|could you clarify|please clarify)\b[\s\S]{0,240}\?$/iu.test(normalized);
};

export const addressesKnowledgeQuestion = (question: string, answer: string): boolean => {
  const generic = new Set(['about', 'after', 'also', 'approved', 'are', 'available', 'can', 'company', 'could', 'cost', 'costs', 'does', 'fee', 'fees', 'from', 'guarantee', 'guaranteed', 'have', 'here', 'how', 'information', 'long', 'many', 'much', 'owner', 'package', 'packages', 'please', 'policy', 'policies', 'price', 'prices', 'pricing', 'service', 'services', 'setup', 'tell', 'that', 'the', 'this', 'what', 'which', 'visa', 'visas', 'with', 'would', 'your']);
  const terms = question.toLocaleLowerCase('en-US').match(/[a-z0-9]{4,}/g)?.filter((term, index, values) => !generic.has(term) && values.indexOf(term) === index) ?? [];
  if (terms.length === 0) return true;
  const normalizedAnswer = answer.toLocaleLowerCase('en-US');
  const overlap = terms.filter((term) => normalizedAnswer.includes(term) || normalizedAnswer.includes(term.slice(0, Math.max(4, term.length - 3)))).length;
  return overlap >= Math.min(2, terms.length);
};

export const validateCitations = (draft: ModelDraft, evidence: ModelEvidence[]): Citation[] => {
  const allowed = new Map<string, Citation>();
  for (const item of evidence) {
    const locator = item.citation.locator.replace(/^.*[\\/]/u, '').replace(/\s+·\s+/u, ':');
    for (const alias of [item.citation.chunkId, `${item.citation.sourceId}:${item.citation.locator}`, `${item.citation.sourceId}:${locator}`]) allowed.set(alias, item.citation);
  }
  return draft.citationIds.map((id) => allowed.get(id)).filter((citation): citation is Citation => Boolean(citation));
};

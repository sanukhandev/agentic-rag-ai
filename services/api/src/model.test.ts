import { describe, expect, it } from 'vitest';
import { addressesKnowledgeQuestion, classifyOfferReply, classifyOfferReplyDeterministically, conversationalIntent, conversationalReply, detectedLanguage, DeterministicGroundedModel, extractLeadData, hasLeadIntent, hasSufficientEvidence, isCatalogSlotNonAnswer, isContextualReply, isControlledKnowledgeAbstention, isGuidedResponse, isGreeting, isKnowledgeQuestion, isPermittedLanguage, isSafeContinuityAnswer, leadCollectionReply, naturalAbstention, needsConversationContext, normalizeConversationQuery, openingGreeting, preservesNormalizationFacts, validateCitations } from './model.js';

describe('Azure Foundry model adapter', () => {
  it('uses the complete configured greeting', () => {
    expect(openingGreeting("Hi! I'm Sara, your assistant. What would you like to explore?", 'Sara')).toBe("Hi! I'm Sara, your assistant. What would you like to explore?");
    expect(openingGreeting('Welcome.', 'Sara')).toBe('Welcome.');
    expect(openingGreeting(undefined, 'Sara')).toBe('Hi! I’m Sara.');
  });

  it('recognizes natural farewell variants after a longer conversation', () => {
    expect(conversationalIntent('Nothing more I need for now, thank you.')).toBe('farewell');
  });
  it('normalizes generic formatting without tenant-specific vocabulary', () => {
    expect(normalizeConversationQuery('  I need 10k  seats\u200b for two users  ')).toBe('I need 10 thousand seats for 2 users');
  });

  it('resolves short replies only against the active offer', async () => {
    const offer = { offerKey: 'offer-1', intentKey: 'company.setup', sourceMessageId: null, sourceQuery: 'setup procedure', options: [{ key: 'steps', label: 'the setup steps', retrievalHints: ['application procedure'] }], issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
    expect(classifyOfferReplyDeterministically('yes please', offer)).toMatchObject({ action: 'accept', optionKey: 'steps' });
    expect(classifyOfferReplyDeterministically('please explain', { ...offer, options: [...offer.options, { key: 'documents', label: 'the required documents', retrievalHints: ['document requirements'] }] })).toMatchObject({ action: 'clarify' });
    expect(classifyOfferReplyDeterministically('the documents', { ...offer, options: [...offer.options, { key: 'documents', label: 'the required documents', retrievalHints: ['document requirements'] }] })).toMatchObject({ action: 'select_option', optionKey: 'documents' });
    expect(classifyOfferReplyDeterministically("I don't want the setup steps", offer)).toMatchObject({ action: 'clarify' });
    expect(classifyOfferReplyDeterministically('Is the package price inclusive?', offer)).toMatchObject({ action: 'new_request' });
    expect(classifyOfferReplyDeterministically('not now', offer)).toMatchObject({ action: 'reject' });

    const multiOffer = { ...offer, options: [...offer.options, { key: 'documents', label: 'the required documents', retrievalHints: ['document requirements'] }] };
    await expect(classifyOfferReply({ draft: async () => ({ answer: '', citationIds: [], proposedIntent: null }), classifyOfferReply: async () => ({ action: 'accept', optionKey: 'steps', confidence: 1 }) }, { maskedMessage: 'maybe', offer: multiOffer })).resolves.toMatchObject({ action: 'clarify', optionKey: null });
    await expect(classifyOfferReply({ draft: async () => ({ answer: '', citationIds: [], proposedIntent: null }), classifyOfferReply: async () => ({ action: 'select_option', optionKey: 'unknown', confidence: 1 }) }, { maskedMessage: 'maybe', offer })).resolves.toMatchObject({ action: 'clarify', optionKey: null });
    await expect(classifyOfferReply({ draft: async () => ({ answer: '', citationIds: [], proposedIntent: null }), classifyOfferReply: async () => ({ action: 'accept', optionKey: 'steps', confidence: 0.2 }) }, { maskedMessage: 'maybe', offer })).resolves.toMatchObject({ action: 'unknown', optionKey: null });
    await expect(classifyOfferReply({ draft: async () => ({ answer: '', citationIds: [], proposedIntent: null }), classifyOfferReply: async () => ({ action: 'accept', optionKey: 'steps', confidence: 1 }) }, { maskedMessage: 'yes', offer, activeIntentKey: 'different.intent' })).resolves.toMatchObject({ action: 'new_request', optionKey: null });
  });

  it('does not echo raw evidence when the external generation model is unavailable', async () => {
    const model = new DeterministicGroundedModel();
    await expect(model.draft({ maskedMessage: 'I want to start a fashion boutique', personaName: 'Sara', evidence: [{ citation: { sourceId: 'source', versionId: 'version', chunkId: 'chunk-1', title: 'FAQ', locator: 'section 1' }, content: 'Detailed retrieval-ready knowledge records\nWhat is ANCFZ?\nANCFZ supports company setup.' }] })).resolves.toEqual({ answer: naturalAbstention('en', 'I want to start a fashion boutique'), citationIds: [], proposedIntent: null });
  });

  it('detects and enforces configured language families', () => {
    expect(detectedLanguage('مرحبا')).toBe('ar');
    expect(isPermittedLanguage('مرحبا', ['en', 'ar-AE'])).toBe(true);
    expect(isPermittedLanguage('مرحبا', ['en'])).toBe(false);
  });
  it('recognizes short greetings without classifying business questions as greetings', () => {
    expect(conversationalIntent('Hello Nova')).toBe('greeting');
    expect(isGreeting("Hey ! How'z it Going ?")).toBe(true);
    expect(isGreeting('Good morning there')).toBe(true);
    expect(conversationalIntent('مرحبًا')).toBe('greeting');
    expect(conversationalIntent('كيف حالك؟')).toBe('wellbeing');
    expect(conversationalIntent('شكراً')).toBe('thanks');
    expect(isGreeting('What is the price?')).toBe(false);
    expect(conversationalIntent('How are you?')).toBe('wellbeing');
    expect(isKnowledgeQuestion('Is the package price inclusive?')).toBe(true);
  });
  it('does not mark controlled knowledge abstentions as grounded answers', () => {
    expect(isControlledKnowledgeAbstention('The requested topic is not covered by the approved information. What would you like to focus on next?')).toBe(true);
    expect(isControlledKnowledgeAbstention('The package includes the business license. What would you like to focus on next?')).toBe(false);
    expect(addressesKnowledgeQuestion('How many purple nebula teleporters does the imaginary moon lottery grant?', 'The package covers the business license and visa process.')).toBe(false);
    expect(addressesKnowledgeQuestion('Is the package price inclusive?', 'The approved guide explains package inclusivity.')).toBe(true);
  });
  it('handles common small-talk and identity questions without RAG abstention', () => {
    expect(conversationalIntent('I m good')).toBe('wellbeing');
    expect(conversationalIntent('i m sanu')).toBe('introduction');
    expect(conversationalIntent('what ?')).toBe('clarification');
    expect(conversationalIntent('why')).toBe('clarification');
    expect(conversationalIntent('i am looking for a company')).toBeNull();
    expect(conversationalIntent('who are you')).toBe('identity');
    expect(conversationalIntent('so what your name?')).toBe('identity');
    expect(conversationalIntent("what's your name?")).toBe('identity');
    expect(conversationalIntent('Thanks so much')).toBe('thanks');
    expect(conversationalIntent('That’s all')).toBe('farewell');
    expect(conversationalIntent('Nothing more I need')).toBe('farewell');
    expect(conversationalIntent('Sure')).toBe('acknowledgement');
    expect(conversationalIntent('What is the price?')).toBeNull();
    expect(needsConversationContext('Do you have it?')).toBe(true);
    expect(needsConversationContext('Yes, tell me more')).toBe(true);
    expect(needsConversationContext('where is he working?')).toBe(true);
    expect(needsConversationContext('what')).toBe(true);
    expect(needsConversationContext('Tell me about Sanu Khan')).toBe(false);
    expect(isKnowledgeQuestion('what all are the requirements?')).toBe(true);
    expect(isKnowledgeQuestion('I would like to know how the shared office works')).toBe(true);
    expect(isKnowledgeQuestion('I want to start a digital marketing company and would like to know the steps and cost')).toBe(true);
    expect(isKnowledgeQuestion('I want to start a digital marketing company and want to know the steps and cost')).toBe(true);
    expect(isKnowledgeQuestion('I would like to start an IT service company what are the steps')).toBe(true);
    expect(isKnowledgeQuestion('I would like to start an IT service company')).toBe(true);
    expect(isKnowledgeQuestion('Can I book a demo?')).toBe(false);
    expect(isKnowledgeQuestion('Can you book a demo?')).toBe(false);
    expect(isKnowledgeQuestion('How are you?')).toBe(false);
    expect(hasLeadIntent('Please contact me about a demo')).toBe(true);
    expect(hasLeadIntent('I would like get service from Sanu')).toBe(true);
    expect(hasLeadIntent('Can we arrange a meeting with Sanu?')).toBe(true);
    expect(hasLeadIntent('What services does Sanu offer?')).toBe(false);
    expect(hasLeadIntent('Do you have his email?')).toBe(false);
    expect(extractLeadData('My name is [NAME_1], email [EMAIL_1]')).toEqual({ name: '[NAME_1]', email: '[EMAIL_1]' });
    expect(conversationalReply('wellbeing', 'Nova')).toContain('doing great');
    expect(conversationalReply('greeting', 'Nova', 'ar')).toContain('مرحبًا');
    expect(conversationalReply('greeting', 'Nova', 'ar')).not.toContain('What would you');
    expect(conversationalReply('identity', 'Nova', 'en', 'Tenant One')).toContain('configured assistant for Tenant One');
    expect(conversationalReply('identity', 'Nova')).toContain('public information');
    expect(conversationalReply('introduction', 'Nova')).toContain('Nice to meet you');
    expect(conversationalReply('clarification', 'Nova')).toContain('clarify');
    expect(conversationalReply('farewell', 'Nova')).toContain('lovely chatting');
    expect(naturalAbstention('en', 'What is the pricing for the same?', { capturedSlots: { visa_count: '2', workspace_preference: 'shared office' } })).toContain('pricing for this setup');
    expect(naturalAbstention('en', 'What is the pricing for the same?', { capturedSlots: { visa_count: '2', workspace_preference: 'shared office' } })).toContain('2 visas, shared office');
    expect(naturalAbstention('en', 'I would like to start an IT service company what are the steps')).toContain('setup steps');
    expect(naturalAbstention()).not.toContain('knowledge base');
    expect(naturalAbstention('ar')).toContain('لا أستطيع تأكيد');
  });

  it('creates a conversational reconciliation follow-up without business claims', async () => {
    const model = new DeterministicGroundedModel();
    const draft = await model.draft({ maskedMessage: 'Continue after review', personaName: 'Sara', evidence: [], followUpContext: { leadCaptured: true, primaryIntentKey: 'lead.capture', responseMode: 'reconcile_follow_up', workflowStatus: 'reconcile_required' } });
    expect(draft.answer).toContain('?');
    expect(isSafeContinuityAnswer(draft.answer, [])).toBe(true);
    expect(draft.citationIds).toEqual([]);
  });
  it('recognizes contextual answers without treating factual questions as answers', () => {
    expect(isContextualReply('yes 2 weeks')).toBe(true);
    expect(isContextualReply('shared office')).toBe(true);
    expect(isContextualReply('I have my passport ready')).toBe(true);
    expect(isContextualReply('what all are the requirements?')).toBe(false);
    expect(isContextualReply('Can you tell me about visa packages?')).toBe(false);
    expect(isSafeContinuityAnswer('Thanks, I’ve noted that. Would you like to include visa services?', [])).toBe(true);
    expect(isSafeContinuityAnswer('Our packages start at AED 4,888.', [])).toBe(false);
    expect(isSafeContinuityAnswer('I have noted that.', [{ sourceId: 'source', versionId: 'version', chunkId: 'chunk', title: 'FAQ', locator: 'section 1' }])).toBe(false);
  });
  it('recognizes a correction request without treating it as a text slot value', () => {
    expect(isCatalogSlotNonAnswer('I told you already')).toBe(true);
    expect(isCatalogSlotNonAnswer('As I mentioned earlier')).toBe(true);
    expect(isCatalogSlotNonAnswer('I am opening a fashion store')).toBe(false);
  });
  it('validates guided model output against the backend-required stage', () => {
    expect(isGuidedResponse('Could you share your phone number?', 'slot_collection', 'phone')).toBe(true);
    expect(isGuidedResponse('Could you share your email or phone number?', 'slot_collection', 'phone')).toBe(false);
    expect(isGuidedResponse('Please provide your phone number.', 'consent')).toBe(false);
    expect(isGuidedResponse('Please approve the consent request below.', 'consent')).toBe(true);
    expect(isGuidedResponse('For your setup, you usually need a passport and two visas. Do you approve?', 'consent')).toBe(false);
    expect(isGuidedResponse('With AED 12,000, starting within three weeks is feasible. What licence do you prefer?', 'slot_collection', 'business_activity')).toBe(false);
    expect(isGuidedResponse(naturalAbstention(), 'slot_collection', 'visa_count')).toBe(false);
    expect(isGuidedResponse('ANCFZ supports startups with competitive packages. What do you need?', 'intent_clarification')).toBe(false);
    expect(isGuidedResponse('Our headquarters is in XYZ. What is your budget?', 'slot_collection', 'budget')).toBe(false);
    expect(isGuidedResponse('ANCFZ charges AED 6000. What is your phone number?', 'slot_collection', 'phone')).toBe(false);
    expect(isGuidedResponse('The licence is issued in 24 hours. What is your phone number?', 'slot_collection', 'phone')).toBe(false);
    expect(isGuidedResponse('A two-visa package is available. What is your phone number?', 'slot_collection', 'phone')).toBe(false);
    expect(isGuidedResponse('Permits arrive tomorrow. What is your phone number?', 'slot_collection', 'phone')).toBe(false);
    expect(isGuidedResponse('Approval takes only a day. What is your phone number?', 'slot_collection', 'phone')).toBe(false);
    expect(isGuidedResponse('Great, permits arrive tomorrow. What is your phone number?', 'slot_collection', 'phone')).toBe(false);
    expect(isGuidedResponse('Thanks for sharing that. Could you share your phone number?', 'slot_collection', 'phone')).toBe(true);
    expect(isGuidedResponse('Could you confirm the number of visas you need?', 'confirmation')).toBe(true);
    expect(isGuidedResponse('What type of licence would suit your activity?', 'slot_collection', 'business_activity')).toBe(true);
    expect(isGuidedResponse('What is your company name?', 'slot_collection', 'name')).toBe(false);
  });
  it('asks to replace invalid contact data instead of treating it as complete', () => {
    expect(leadCollectionReply({ name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, 'email')).toContain('email address');
    expect(leadCollectionReply({ name: '[NAME_1]', email: '[EMAIL_1]', phone: '[PHONE_1]' }, 'phone')).toContain('phone number');
  });

  it('rejects normalizations that change negation, quantities or privacy tokens', () => {
    expect(preservesNormalizationFacts('I do not need 2 visas for [NAME_1]', 'I need 2 visas for [NAME_1]')).toBe(false);
    expect(preservesNormalizationFacts('I need two visas for [NAME_1]', 'I need 2 visas for [NAME_1]')).toBe(true);
    expect(preservesNormalizationFacts('Email [EMAIL_1]', 'Email [EMAIL_2]')).toBe(false);
  });

  it('drops citation IDs outside the authorized evidence set', () => {
    const citation = { sourceId: 'source', versionId: 'version', chunkId: 'known', title: 'FAQ', locator: 'section 1' };
    expect(validateCitations({ answer: 'answer', citationIds: ['unknown', 'known'], proposedIntent: null }, [{ citation, content: 'answer' }])).toEqual([citation]);
  });

  it('accepts a citation alias derived from the authorized source locator', () => {
    const citation = { sourceId: 'source', versionId: 'version', chunkId: 'known', title: 'FAQ', locator: 'training/faq.docx · section 2' };
    expect(validateCitations({ answer: 'answer', citationIds: ['source:faq.docx:section 2'], proposedIntent: null }, [{ citation, content: 'answer' }])).toEqual([citation]);
  });

  it('rejects unsupported numeric claims even when the citation ID is valid', () => {
    const citation = { sourceId: 'source', versionId: 'version', chunkId: 'known', title: 'FAQ', locator: 'section 1' };
    const evidence = [{ citation, content: 'The approved price is 42 credits.' }];
    expect(hasSufficientEvidence('The approved price is 999 credits.', evidence, [citation])).toBe(false);
    expect(hasSufficientEvidence('The approved price is 42 credits.', evidence, [citation])).toBe(true);
    expect(hasSufficientEvidence('The approved price is 42 credits. Approval is guaranteed.', evidence, [citation])).toBe(false);
    expect(hasSufficientEvidence('The approved price is 42 credits. The office is in Dubai.', evidence, [citation])).toBe(false);
  });

  it('uses scoped pricing tool results while preserving one journey follow-up', async () => {
    const draft = await new DeterministicGroundedModel().draft({
      maskedMessage: 'Could you tell me about the pricing and timelines for the same?',
      personaName: 'Zara',
      evidence: [{ citation: { sourceId: 'source', versionId: 'version', chunkId: 'chunk-1', title: 'Approved timeline', locator: 'section 1' }, content: 'Processing timelines depend on the selected setup and application details.' }],
      followUpContext: {
        leadCaptured: false,
        primaryIntentKey: 'company.setup',
        responseMode: 'mixed',
        nextSlotLabel: 'your business activity',
        agentToolResults: [{ name: 'get_authoritative_pricing', ok: true, data: { pricing: [{ name: 'Sandbox Growth', amountMinor: 450000, currency: 'AED' }] } }],
      },
    });
    expect(draft.answer).toContain('AED 4,500.00');
    expect(draft.answer).toContain('?');
    expect(draft.citationIds).toEqual(['chunk-1']);
  });

  it('uses available package tool results for an unqualified package question', async () => {
    const draft = await new DeterministicGroundedModel().draft({
      maskedMessage: 'what all packages',
      personaName: 'Zara',
      evidence: [{ citation: { sourceId: 'source', versionId: 'version', chunkId: 'chunk-1', title: 'Approved packages', locator: 'section 1' }, content: 'Approved packages are available for company setup.' }],
      followUpContext: {
        leadCaptured: false,
        primaryIntentKey: null,
        responseMode: 'knowledge',
        agentToolResults: [{ name: 'get_available_packages', ok: true, data: { packages: [{ name: 'Sandbox Basic', visas: 1, officeRequirement: 'flexi-desk' }, { name: 'Sandbox Growth', visas: 3, officeRequirement: 'shared office' }] } }, { name: 'get_authoritative_pricing', ok: true, data: { pricing: [{ name: 'Sandbox Basic', amountMinor: 250000, currency: 'AED' }, { name: 'Sandbox Growth', amountMinor: 450000, currency: 'AED' }] } }],
      },
    });
    expect(draft.answer).toContain('Sandbox Basic');
    expect(draft.answer).toContain('Sandbox Growth');
    expect(draft.answer).toContain('AED 2,500.00');
    expect(draft.answer).not.toContain('AED 4,888');
    expect(draft.answer).toContain('?');
  });
});

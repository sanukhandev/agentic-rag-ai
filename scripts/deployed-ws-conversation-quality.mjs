import { WebSocket } from 'ws';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const apiBase = (process.env.API_BASE_URL ?? 'https://ai.techcarrot.ae').replace(/\/$/u, '');
const wsUrl = process.env.WS_URL
  ?? `${(process.env.WS_BASE_URL ?? apiBase.replace(/^http/u, 'ws')).replace(/\/$/u, '')}/api/chat/stream`;
const origin = process.env.ORIGIN ?? apiBase;
const tenantSlug = process.env.TENANT_SLUG ?? 'anc';
const caseLimit = Number.parseInt(process.env.CASE_LIMIT ?? '11', 10);
const turnTimeoutMs = Number.parseInt(process.env.TURN_TIMEOUT_MS ?? '60_000', 10);
const betweenTurnsMs = Number.parseInt(process.env.BETWEEN_TURNS_MS ?? '800', 10);
const betweenCasesMs = Number.parseInt(process.env.BETWEEN_CASES_MS ?? '1_500', 10);
const runId = `${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
const runDir = resolve(process.env.RUN_REPORT_DIR ?? join('artifacts', 'conversation-quality-runs', runId));
const transcriptDir = join(runDir, 'transcripts');
const reportPath = resolve(process.env.REPORT_PATH ?? join(runDir, 'run.json'));
const markdownPath = resolve(process.env.MARKDOWN_REPORT_PATH ?? join(runDir, 'run.md'));
const documentPath = process.env.DOCUMENT_PATH ?? 'C:\\Users\\SanuKarimullaKhan\\Downloads\\Passport-Front-Page.jpg';
const documentMimeType = process.env.DOCUMENT_MIME_TYPE ?? 'image/jpeg';

if (!Number.isInteger(caseLimit) || caseLimit < 1) throw new Error('CASE_LIMIT must be a positive integer.');

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const digest = (value) => Buffer.from(String(value)).toString('base64url').slice(0, 12);
const choose = (values) => values[randomInt(0, values.length)];
const randomDigits = (length) => randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);

const fallbackPattern = /approved information is temporarily unavailable|couldn['’]t find approved|cannot verify that answer safely|could not continue the conversation|approved setup guide is published/iu;
const internalLeakPattern = /(?:actionId|tenantId|catalogVersionId|providerStatus|traceback|stack trace|confidenceScore|promptId|\bUUID\b)/iu;

function createProfile(index) {
  const first = choose(['Avery', 'Mina', 'Jonas', 'Noura', 'Elian', 'Sora', 'Talia', 'Rafi', 'Lena', 'Kian']);
  const last = choose(['Vale', 'Nadir', 'Quill', 'Marin', 'Sayegh', 'Kestrel', 'Roux', 'Hale', 'Darin', 'Sol']);
  const suffix = `${Date.now().toString(36).slice(-4)}${randomDigits(4)}`;
  return {
    name: `${first} ${last}`,
    email: `qa.${index}.${suffix}@example.invalid`,
    phone: `+9715${randomDigits(8)}`,
    company: `${last} ${choose(['Advisory', 'Ventures', 'Digital', 'Trading', 'Labs'])} ${suffix.slice(-3)}`,
  };
}

function redact(value, profile) {
  let text = String(value ?? '');
  for (const [raw, replacement] of [
    [profile?.name, '[SYNTHETIC_NAME]'],
    [profile?.email, '[SYNTHETIC_EMAIL]'],
    [profile?.phone, '[SYNTHETIC_PHONE]'],
    [profile?.company, '[SYNTHETIC_COMPANY]'],
  ]) {
    if (raw) text = text.split(raw).join(replacement);
  }
  return text
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, '[EMAIL]')
    .replace(/\+?\d[\d ()-]{7,}\d/gu, '[PHONE]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/giu, '[ID]');
}

async function createSession() {
  const response = await fetch(`${apiBase}/api/v1/chat/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ tenantSlug }),
    signal: AbortSignal.timeout(turnTimeoutMs),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.sessionId || !body.sessionToken) {
    throw new Error(`Session creation failed (${response.status}): ${JSON.stringify(body).slice(0, 400)}`);
  }
  return body;
}

async function uploadDocument(session, responseSummary, profile) {
  try {
    const content = await readFile(documentPath);
    const body = {
      fileName: documentPath.split(/[\\/]/u).pop() ?? 'identity-document.jpg',
      mimeType: documentMimeType,
      contentBase64: content.toString('base64'),
      processingConsent: true,
      ...(responseSummary.pendingIntentKey ? { primaryIntentKey: responseSummary.pendingIntentKey } : {}),
      // The chat prompt may be asking for consent, not naming a document
      // requirement. Let the V2 route resolve the sole required document from
      // the pinned package instead of sending a consent key as a document key.
    };
    const response = await fetch(`${apiBase}/api/v1/chat/sessions/${session.sessionId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin, 'x-agentic-session-token': session.sessionToken },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(turnTimeoutMs),
    });
    const result = await response.json().catch(() => ({}));
    return {
      attempted: true,
      fileName: body.fileName,
      mimeType: body.mimeType,
      status: response.status,
      accepted: result.accepted === true,
      documentIdDigest: result.document?.id ? digest(result.document.id) : null,
      jobIdDigest: result.jobId ? digest(result.jobId) : null,
      documentStatus: result.document?.status ?? null,
      errorCode: result.error?.code ?? result.code ?? null,
      error: redact(result.error?.message ?? result.message ?? '', profile) || null,
    };
  } catch {
    return {
      attempted: false,
      fileName: documentPath.split(/[\\/]/u).pop() ?? 'identity-document.jpg',
      mimeType: documentMimeType,
      status: null,
      accepted: false,
      documentIdDigest: null,
      jobIdDigest: null,
      documentStatus: null,
      errorCode: 'DOCUMENT_FILE_READ_FAILED',
      error: 'The configured document file could not be read.',
    };
  }
}

function isDocumentRequested(answer, responseSummary) {
  const requirement = String(responseSummary.pendingRequirementKey ?? '');
  if (/passport|identity|document/iu.test(requirement)) return true;
  return /(?:please|need|must|provide|upload|attach|submit|share|send).{0,80}(?:passport|identity document|identity proof)|(?:passport|identity document|identity proof).{0,80}(?:provide|upload|attach|submit|share|send|processing|consent)/iu.test(String(answer ?? ''));
}

class ConversationSocket {
  constructor() {
    this.socket = null;
  }

  async connect(session) {
    const socket = new WebSocket(wsUrl, { headers: { origin } });
    this.socket = socket;
    await new Promise((resolveOpen, rejectOpen) => {
      const timeout = setTimeout(() => rejectOpen(new Error('WebSocket connection timed out.')), turnTimeoutMs);
      socket.once('open', () => { clearTimeout(timeout); resolveOpen(); });
      socket.once('error', (error) => { clearTimeout(timeout); rejectOpen(error); });
    });
    socket.send(JSON.stringify({ type: 'authenticate', sessionId: session.sessionId, sessionToken: session.sessionToken }));
    await this.waitFor((frame) => frame.type === 'authenticated' || frame.type === 'error' || frame.error, turnTimeoutMs);
  }

  async waitFor(predicate, timeoutMs) {
    if (!this.socket) throw new Error('WebSocket is not connected.');
    return new Promise((resolveFrame, rejectFrame) => {
      const timer = setTimeout(() => {
        this.socket.off('message', onMessage);
        rejectFrame(new Error('Timed out waiting for a WebSocket frame.'));
      }, timeoutMs);
      const onMessage = (raw) => {
        let frame;
        try { frame = JSON.parse(raw.toString('utf8')); } catch { return; }
        if (!predicate(frame)) return;
        clearTimeout(timer);
        this.socket.off('message', onMessage);
        if (frame.type === 'error' || frame.error) rejectFrame(new Error(JSON.stringify(frame).slice(0, 800)));
        else resolveFrame(frame);
      };
      this.socket.on('message', onMessage);
    });
  }

  async sendTurn(message) {
    if (!this.socket) throw new Error('WebSocket is not connected.');
    const clientMessageId = randomUUID();
    return new Promise((resolveTurn, rejectTurn) => {
      let answer = '';
      const timer = setTimeout(() => {
        this.socket.off('message', onMessage);
        rejectTurn(new Error('Timed out waiting for turn completion.'));
      }, turnTimeoutMs);
      const onMessage = (raw) => {
        let frame;
        try { frame = JSON.parse(raw.toString('utf8')); } catch { return; }
        if (frame.clientMessageId !== clientMessageId) return;
        if (frame.type === 'assistant.message') answer = frame.answer ?? frame.message?.answer ?? answer;
        if (frame.type === 'turn.failed') {
          clearTimeout(timer);
          this.socket.off('message', onMessage);
          rejectTurn(new Error(JSON.stringify(frame.error ?? frame).slice(0, 800)));
        }
        if (frame.type === 'turn.completed') {
          clearTimeout(timer);
          this.socket.off('message', onMessage);
          resolveTurn({ answer, response: frame.response ?? frame.result ?? null });
        }
      };
      this.socket.on('message', onMessage);
      this.socket.send(JSON.stringify({ type: 'message', clientMessageId, message }));
    });
  }

  close() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }
}

function quoteTurns(profile, packageName, style) {
  const turns = {
    formal: [
      'Good afternoon. I am evaluating a free-zone company formation and would appreciate a clear overview.',
      'Yes, please proceed with the company-formation enquiry.',
      `Please register the enquiry under ${profile.name}.`,
      `My email is ${profile.email} and my phone is ${profile.phone}.`,
      'I consent to using these contact details for this company-formation enquiry.',
      'Please submit the lead.',
      'Yes, I explicitly confirm the Lead submission.',
      'Could you list the approved packages available for this setup?',
      `The ${packageName} package appears suitable for my needs.`,
      'I have my passport available and I consent to document processing.',
      `Yes, please prepare the official quotation for the ${packageName} package.`,
      'Yes, generate the quotation now, please.',
    ],
    conversational: [
      'Hi! I am trying to set up a small company in the free zone. Can you help me figure it out?',
      'That sounds good — let us go ahead with the company setup.',
      `You can put the enquiry under ${profile.name}.`,
      `I can share both: ${profile.email} and ${profile.phone}.`,
      'You have my permission to use those details for this enquiry.',
      'Go ahead and submit the lead for me.',
      'Yes, I am confirming the lead submission.',
      'What company-formation packages can I choose from?',
      `I would like to choose ${packageName}.`,
      'I have the identity document ready, and I agree to its processing.',
      `Please get the official ${packageName} quotation ready.`,
      'Yes, please generate the quote.',
    ],
    concise: [
      'Hello. Need a free-zone company formation. Please guide me.',
      'Confirmed. Start the enquiry.',
      `Name: ${profile.name}.`,
      `Email ${profile.email}; phone ${profile.phone}.`,
      'I consent to contact use for this request.',
      'Submit the lead.',
      'Confirmed — submit it.',
      'Show approved company packages.',
      `I choose ${packageName}.`,
      'Passport is ready. I consent to document processing.',
      `Prepare the ${packageName} quotation.`,
      'Confirm quote generation now.',
    ],
  };
  return turns[style];
}

function buildCases() {
  const quoteProfiles = [createProfile(1), createProfile(2), createProfile(3)];
  const quoteDefinitions = [
    ['quote-formal', 'quote_complete', 'formal', 'Growth'],
    ['quote-conversational', 'quote_complete', 'conversational', 'Starter'],
    ['quote-concise', 'quote_complete', 'concise', 'Premium'],
  ];
  const quoteCases = quoteDefinitions.map(([id, category, style, packageName], index) => ({
    id, category, profile: quoteProfiles[index], expected: 'quote',
    documentPolicy: 'on_request',
    turns: quoteTurns(quoteProfiles[index], packageName, style),
  }));

  const ragCases = [
    {
      id: 'rag-options-formal', category: 'rag_only', expected: 'rag', profile: createProfile(4),
      turns: [
        'Good morning. What are the main free-zone company setup options available?',
        'Could you also explain whether a shared office arrangement is acceptable?',
      ],
    },
    {
      id: 'rag-visa-casual', category: 'rag_only', expected: 'rag', profile: createProfile(5),
      turns: [
        'Hey, how many visas can the company-formation packages support?',
        'What changes if I only need one visa at the beginning?',
      ],
    },
    {
      id: 'rag-documents-direct', category: 'rag_only', expected: 'rag', profile: createProfile(6),
      turns: [
        'Which documents are normally needed to start a company?',
        'Please keep this informational only; I am not ready to register a lead.',
      ],
    },
    {
      id: 'rag-timeline-curious', category: 'rag_only', expected: 'rag', profile: createProfile(7),
      turns: [
        'How long does a typical free-zone company formation take?',
        'What part of the process usually takes the most time?',
      ],
    },
    {
      id: 'rag-price-comparison', category: 'rag_only', expected: 'rag', profile: createProfile(8),
      turns: [
        'Can you compare the approved company-formation packages and their listed prices?',
        'I only want the package information for now, without submitting any contact details.',
      ],
    },
  ];

  const incompleteProfile = createProfile(9);
  const refusalProfile = createProfile(10);
  const negativeCases = [
    {
      id: 'negative-dropped-chat', category: 'negative_dropped', expected: 'dropped', profile: createProfile(11), dropAfterTurn: 2,
      turns: [
        'Hi, I am thinking about forming a company in the free zone.',
        'I need to step away now. I will come back later.',
      ],
    },
    {
      id: 'negative-incomplete-contact', category: 'negative_incomplete', expected: 'incomplete', profile: incompleteProfile,
      turns: [
        'I want to start a company in the free zone.',
        'Yes, let us proceed.',
        `My name is ${incompleteProfile.name}.`,
      ],
    },
    {
      id: 'negative-document-refusal', category: 'negative_document_refusal', expected: 'blocked_safely', profile: refusalProfile,
      documentPolicy: 'never',
      turns: [
        'I would like to form a company in the free zone.',
        'Yes, proceed with that goal.',
        `Use ${refusalProfile.name} for the enquiry.`,
        `My email is ${refusalProfile.email} and my phone is ${refusalProfile.phone}.`,
        'I consent to using my contact details for this enquiry.',
        'Please submit the lead.',
        'Yes, confirm and submit the lead.',
        'Which packages are available?',
        'The Growth package is the one I want.',
        'I do not consent to sharing or processing an identity document. Please generate the quote anyway.',
        'Please generate the quotation without the document.',
      ],
    },
  ];
  return [...quoteCases, ...ragCases, ...negativeCases];
}

function summarizeAction(action, profile) {
  if (!action || typeof action !== 'object') return null;
  return {
    idDigest: action.id ? digest(action.id) : null,
    intent: action.intent ?? action.intentKey ?? null,
    actionKey: action.actionKey ?? action.workflowKey ?? null,
    state: action.state ?? null,
    consentRequired: action.consentRequired ?? null,
    confirmationRequired: action.confirmationRequired ?? null,
    externalReferencePresent: Boolean(action.result?.externalReference ?? action.externalReference),
    answer: action.message ? redact(action.message, profile) : undefined,
  };
}

function summarizeResponse(response, profile) {
  const source = response && typeof response === 'object' ? response : {};
  const action = source.actionProposal ?? source.action ?? null;
  const citations = Array.isArray(source.citations) ? source.citations : [];
  return {
    grounded: source.grounded ?? null,
    citationCount: citations.length,
    pendingIntentKey: source.pendingIntentKey ?? null,
    pendingRequirementKey: source.pendingRequirementKey ?? null,
    actionProposal: summarizeAction(action, profile),
    quoteArtifactPresent: Boolean(source.artifactId || source.artifactFileName || source.quote?.id),
  };
}

function normalizeAnswer(answer) {
  return String(answer ?? '').toLocaleLowerCase().replace(/\s+/gu, ' ').trim();
}

function evaluateCase(testCase, transcript, status) {
  const answers = transcript.map((turn) => turn.assistant).filter(Boolean);
  const normalizedAnswers = answers.map(normalizeAnswer);
  const repeatedAnswers = [...new Set(normalizedAnswers.filter((answer, index) => normalizedAnswers.indexOf(answer) !== index))];
  const fallbackResponses = answers.filter((answer) => fallbackPattern.test(answer)).length;
  const internalLeaks = answers.filter((answer) => internalLeakPattern.test(answer)).length;
  const actionProposals = transcript.flatMap((turn) => turn.response?.actionProposal ? [turn.response.actionProposal] : []);
  const quoteSignals = answers.filter((answer) => /quotation|quote|pdf|package|document/iu.test(answer)).length;
  const ragTurns = testCase.expected === 'rag' ? transcript : [];
  const groundedRagTurns = ragTurns.filter((turn) => turn.response?.grounded === true || (turn.response?.citationCount ?? 0) > 0).length;
  const ragActionLeak = testCase.expected === 'rag' ? actionProposals.length : 0;
  const safelyBlocked = testCase.expected === 'blocked_safely'
    && !transcript.some((turn) => turn.response?.quoteArtifactPresent)
    && !answers.some((answer) => /generated|ready to download|completed/iu.test(answer));
  const dropped = testCase.expected === 'dropped' && status === 'dropped';
  const incomplete = testCase.expected === 'incomplete'
    && !actionProposals.some((action) => action.actionKey === 'crm.lead.create' || action.intent === 'crm.lead.create');
  const quoteJourneyHasAction = testCase.expected === 'quote'
    && actionProposals.some((action) => /quote|quotation/iu.test(`${action.actionKey ?? ''} ${action.intent ?? ''}`));
  const documentUploads = transcript.flatMap((turn) => turn.documentUpload ? [turn.documentUpload] : []);
  const documentUploadAttempted = documentUploads.length > 0;
  const documentUploadAccepted = documentUploads.some((upload) => upload.accepted === true);
  const documentUploadFailures = documentUploads.filter((upload) => upload.accepted !== true).length;
  const documentGatePass = testCase.documentPolicy === 'on_request'
    ? documentUploadAttempted && documentUploadAccepted
    : true;
  const technicalPass = status !== 'transport_error'
    && repeatedAnswers.length === 0
    && fallbackResponses === 0
    && internalLeaks === 0;
  const expectedOutcomePass = testCase.expected === 'quote'
    ? quoteJourneyHasAction && documentGatePass
    : testCase.expected === 'rag'
      ? ragActionLeak === 0 && groundedRagTurns > 0
      : testCase.expected === 'dropped'
        ? dropped
        : testCase.expected === 'incomplete'
          ? incomplete
          : safelyBlocked;
  return {
    status,
    pass: technicalPass && expectedOutcomePass,
    technicalPass,
    expectedOutcomePass,
    repeatedAssistantResponses: repeatedAnswers,
    fallbackResponses,
    internalLeakResponses: internalLeaks,
    actionProposalCount: actionProposals.length,
    quoteSignals,
    documentUploadAttempted,
    documentUploadAccepted,
    documentUploadFailures,
    ragTurns: ragTurns.length,
    groundedRagTurns,
    ragActionLeak,
    expectedOutcome: testCase.expected,
    inferredOutcome: testCase.expected === 'quote'
      ? (quoteJourneyHasAction
        ? (documentGatePass ? 'quote_action_observed_document_accepted_provider_completion_unverified' : 'quote_or_document_gate_review_required')
        : 'quote_action_not_observed')
      : testCase.expected === 'rag'
        ? (groundedRagTurns > 0 && ragActionLeak === 0 ? 'grounded_rag_only' : 'rag_review_required')
        : testCase.expected === 'dropped'
          ? 'chat_dropped'
          : testCase.expected === 'incomplete'
            ? 'journey_incomplete'
            : safelyBlocked ? 'document_gate_blocked' : 'negative_case_review_required',
  };
}

async function runCase(testCase) {
  const session = await createSession();
  const socket = new ConversationSocket();
  const transcript = [];
  const documentUploads = [];
  let documentUploadAttempted = false;
  let documentUploadPendingConsent = false;
  let status = 'completed';
  try {
    await socket.connect(session);
    const turnsToSend = testCase.dropAfterTurn ? testCase.turns.slice(0, testCase.dropAfterTurn) : testCase.turns;
    for (let index = 0; index < turnsToSend.length; index += 1) {
      const userMessage = turnsToSend[index];
      try {
        const result = await socket.sendTurn(userMessage);
        const responseSummary = summarizeResponse(result.response, testCase.profile);
        let documentUpload = null;
        const uploadWasPendingConsent = documentUploadPendingConsent;
        if (testCase.documentPolicy === 'on_request' && !documentUploadAttempted
          && responseSummary.pendingRequirementKey === 'document_processing_consent'
          && isDocumentRequested(result.answer, responseSummary)) {
          documentUploadPendingConsent = true;
        }
        if (testCase.documentPolicy === 'on_request' && !documentUploadAttempted
          && (uploadWasPendingConsent || (responseSummary.pendingRequirementKey !== 'document_processing_consent' && isDocumentRequested(result.answer, responseSummary) && !documentUploadPendingConsent))) {
          documentUploadAttempted = true;
          documentUploadPendingConsent = false;
          documentUpload = await uploadDocument(session, responseSummary, testCase.profile);
          documentUploads.push(documentUpload);
        }
        transcript.push({
          turn: index + 1,
          user: redact(userMessage, testCase.profile),
          assistant: redact(result.answer, testCase.profile),
          response: responseSummary,
          ...(documentUpload ? { documentUpload } : {}),
        });
      } catch (error) {
        status = 'transport_error';
        transcript.push({ turn: index + 1, user: redact(userMessage, testCase.profile), assistant: '', response: null, error: redact(error.message, testCase.profile) });
        break;
      }
      if (index < turnsToSend.length - 1) await wait(betweenTurnsMs);
    }
    if (testCase.dropAfterTurn) status = 'dropped';
  } catch (error) {
    status = 'transport_error';
    transcript.push({ turn: 0, user: '', assistant: '', response: null, error: redact(error.message, testCase.profile) });
  } finally {
    socket.close();
  }
  return {
    caseId: testCase.id,
    category: testCase.category,
    sessionId: session.sessionId,
    sessionIdDigest: digest(session.sessionId),
    transcript,
    documentUploads,
    evaluation: evaluateCase(testCase, transcript, status),
  };
}

function buildBenchmark(cases) {
  const totalTurns = cases.reduce((sum, testCase) => sum + testCase.transcript.length, 0);
  const totalRepeated = cases.reduce((sum, testCase) => sum + testCase.evaluation.repeatedAssistantResponses.length, 0);
  const totalFallbacks = cases.reduce((sum, testCase) => sum + testCase.evaluation.fallbackResponses, 0);
  const ragCases = cases.filter((testCase) => testCase.category === 'rag_only');
  const ragTurns = ragCases.reduce((sum, testCase) => sum + testCase.evaluation.ragTurns, 0);
  const groundedRagTurns = ragCases.reduce((sum, testCase) => sum + testCase.evaluation.groundedRagTurns, 0);
  const ragActionLeaks = ragCases.reduce((sum, testCase) => sum + testCase.evaluation.ragActionLeak, 0);
  const quoteCases = cases.filter((testCase) => testCase.category === 'quote_complete');
  const negativeCases = cases.filter((testCase) => testCase.category.startsWith('negative_'));
  const documentUploadCases = cases.filter((testCase) => testCase.evaluation.documentUploadAttempted).length;
  const documentUploadAcceptedCases = cases.filter((testCase) => testCase.evaluation.documentUploadAccepted).length;
  const documentUploadFailureCount = cases.reduce((sum, testCase) => sum + testCase.evaluation.documentUploadFailures, 0);
  const transportFailures = cases.filter((testCase) => testCase.evaluation.status === 'transport_error').length;
  const passed = cases.filter((testCase) => testCase.evaluation.pass).length;
  const documentGateFailures = quoteCases.filter((testCase) => !testCase.evaluation.documentUploadAccepted).length;
  const verdict = transportFailures > 0 || totalRepeated > 0 || totalFallbacks > 0 || ragActionLeaks > 0 || documentGateFailures > 0
    ? 'BLOCKED'
    : passed === cases.length ? 'PASS' : 'REVIEW';
  return {
    verdict,
    cases: cases.length,
    passedCases: passed,
    failedOrReviewCases: cases.length - passed,
    totalTurns,
    transportFailureRate: cases.length ? transportFailures / cases.length : 0,
    repeatedAnswerCount: totalRepeated,
    fallbackResponseCount: totalFallbacks,
    ragGroundingRate: ragTurns ? groundedRagTurns / ragTurns : null,
    ragActionLeakCount: ragActionLeaks,
    quoteCasesWithActionProposal: quoteCases.filter((testCase) => testCase.evaluation.actionProposalCount > 0).length,
    documentUploadCases,
    documentUploadAcceptedCases,
    documentUploadFailureCount,
    documentGateFailures,
    quoteProviderCompletionVerified: false,
    negativeCasesPassed: negativeCases.filter((testCase) => testCase.evaluation.pass).length,
    benchmarkNote: 'Transcript quality is automatically screened; naturalness and factual usefulness still require human review. Provider completion is not inferred from chat text.',
  };
}

function markdownReport(report) {
  const lines = [
    '# Deployed WebSocket Conversation Quality Report',
    '',
    `- Benchmark: **${report.benchmark.verdict}**`,
    `- Cases: ${report.benchmark.passedCases}/${report.benchmark.cases} passed`,
    `- Turns: ${report.benchmark.totalTurns}`,
    `- RAG grounding rate: ${report.benchmark.ragGroundingRate === null ? 'n/a' : `${Math.round(report.benchmark.ragGroundingRate * 100)}%`}`,
    `- Repeated answers: ${report.benchmark.repeatedAnswerCount}`,
    `- Fallback responses: ${report.benchmark.fallbackResponseCount}`,
    `- RAG action leaks: ${report.benchmark.ragActionLeakCount}`,
    `- Document uploads accepted: ${report.benchmark.documentUploadAcceptedCases}/${report.benchmark.documentUploadCases}`,
    '- Quote provider completion: not verified by this WebSocket-only harness',
    '',
    '## Session IDs',
    '',
  ];
  for (const testCase of report.cases) lines.push(`- ${testCase.caseId}: ${testCase.sessionId}`);
  lines.push('', '## Case outcomes', '');
  for (const testCase of report.cases) {
    lines.push(`### ${testCase.caseId}`, '', `- Category: ${testCase.category}`, `- Outcome: ${testCase.evaluation.inferredOutcome}`, `- Pass: ${testCase.evaluation.pass ? 'yes' : 'no'}`, `- Transcript file: ${testCase.transcriptPath ?? 'not written'}`, '');
    for (const turn of testCase.transcript) {
      lines.push(`**Turn ${turn.turn} — User:** ${turn.user}`, '', `**Assistant:** ${turn.assistant || '[no response]'}`, '');
      if (turn.documentUpload) lines.push(`Document upload: ${turn.documentUpload.accepted ? 'accepted' : 'rejected'}${turn.documentUpload.documentStatus ? ` (${turn.documentUpload.documentStatus})` : ''}${turn.documentUpload.errorCode ? ` — ${turn.documentUpload.errorCode}` : ''}`, '');
    }
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const definitions = buildCases();
  const selected = definitions.slice(0, Math.min(caseLimit, definitions.length));
  const cases = [];
  await mkdir(transcriptDir, { recursive: true });
  for (const testCase of selected) {
    const result = await runCase(testCase);
    const transcriptFile = join('transcripts', `${String(cases.length + 1).padStart(2, '0')}-${testCase.id}.json`).replaceAll('\\', '/');
    result.transcriptPath = transcriptFile;
    await writeFile(resolve(runDir, transcriptFile), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    cases.push(result);
    if (cases.length < selected.length) await wait(betweenCasesMs);
  }
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    environment: { apiBase, wsUrl, origin, tenantSlug, syntheticDataOnly: true, documentUploadEnabled: true, documentFileName: documentPath.split(/[\\/]/u).pop() ?? 'identity-document.jpg' },
    storage: { runDir, reportPath, markdownPath, transcriptDir, transcriptFilesRelativeToRunDir: true },
    requestedComposition: { quoteComplete: 3, ragOnly: 5, negative: 3, total: 11 },
    executedComposition: cases.reduce((counts, testCase) => { counts[testCase.category] = (counts[testCase.category] ?? 0) + 1; return counts; }, {}),
    sessionIds: cases.map((testCase) => ({ caseId: testCase.caseId, sessionId: testCase.sessionId, sessionIdDigest: testCase.sessionIdDigest })),
    benchmark: buildBenchmark(cases),
    cases,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, markdownReport(report), 'utf8');
  console.log(JSON.stringify({ reportPath, markdownPath, sessionIds: report.sessionIds, benchmark: report.benchmark }, null, 2));
  if (report.benchmark.verdict === 'BLOCKED') process.exitCode = 2;
}

main().catch((error) => {
  console.error(`[conversation-quality] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

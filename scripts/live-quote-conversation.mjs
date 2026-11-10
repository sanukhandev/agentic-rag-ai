import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const baseUrl = process.env.API_BASE_URL ?? 'http://127.0.0.1';
const origin = process.env.API_ORIGIN ?? 'http://localhost:3000';
const tenantSlug = process.env.TENANT_SLUG ?? 'anc';
const reviewPath = resolve('docs/verification/quote-conversation-live-review.json');
const artifactDir = resolve('artifacts/quote-sandbox-2026-11-10');
const documents = [
  { fileName: 'synthetic-identity.png', mimeType: 'image/png', contentBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
];
const documentFileName = (document) => document.fileName ?? basename(document.path);
const syntheticRunId = Date.now().toString().slice(-8);
const syntheticEmail = `synthetic.review.${syntheticRunId}@example.test`;
const syntheticPhone = `+97150${syntheticRunId}`;

const digest = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
const redact = (value) => String(value)
  .replace(/Synthetic Review Customer/gu, '[NAME]')
  .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[EMAIL]')
  .replace(/\+?\d[\d ()-]{7,}\d/g, '[PHONE]')
  .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '[ID]')
  .replace(/\b(?:Bearer|Basic)\s+\S+/gi, '[TOKEN]');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { origin, ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) },
  });
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.arrayBuffer();
  return { status: response.status, headers: response.headers, body };
}

const chatHeaders = (sessionToken) => ({ 'x-agentic-session-token': sessionToken });
const errorCode = (body) => body?.error?.code ?? body?.code ?? null;
const errorMessage = (body) => body?.error?.message ?? body?.message ?? null;

function responseSummary(response) {
  if (!response || typeof response.body !== 'object' || response.body instanceof ArrayBuffer) return { status: response?.status ?? null };
  return {
    status: response.status,
    answer: typeof response.body.answer === 'string' ? redact(response.body.answer) : null,
    grounded: response.body.grounded ?? null,
    pendingIntentKey: response.body.pendingIntentKey ?? null,
    pendingRequirementKey: response.body.pendingRequirementKey ?? null,
    actionProposal: response.body.actionProposal ? {
      idDigest: digest(response.body.actionProposal.id),
      intent: response.body.actionProposal.intent ?? null,
      consentRequired: response.body.actionProposal.consentRequired ?? null,
    } : null,
    error: errorCode(response.body) ? { code: errorCode(response.body), message: redact(errorMessage(response.body) ?? '') } : null,
  };
}

async function sendTurn(session, message, turn, transcript, { type = 'text', postbackValue } = {}) {
  const response = await request('/api/v1/chat/messages', {
    method: 'POST',
    headers: chatHeaders(session.sessionToken),
    body: JSON.stringify({ sessionId: session.sessionId, type, message, ...(postbackValue ? { postbackValue } : {}), clientMessageId: `live-quote-review-${turn}` }),
  });
  const summary = responseSummary(response);
  transcript.push({ turn, user: redact(message), assistant: summary });
  return response;
}

async function pollAction(session, actionId) {
  let latest = null;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    const response = await request(`/api/v1/chat/actions/${actionId}?sessionId=${encodeURIComponent(session.sessionId)}`, { headers: chatHeaders(session.sessionToken) });
    latest = response.body;
    const state = latest?.action?.state;
    if (['completed', 'failed', 'reconcile_required', 'human_review'].includes(state)) return { ...latest, attempts: attempt };
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  return { ...latest, attempts: 15, timedOut: true };
}

async function uploadDocument(session, intentKey, requirementKey, document) {
  const fileName = documentFileName(document);
  const content = document.contentBase64 ? Buffer.from(document.contentBase64, 'base64') : await readFile(document.path);
  const response = await request(`/api/v1/chat/sessions/${session.sessionId}/documents`, {
    method: 'POST',
    headers: chatHeaders(session.sessionToken),
    body: JSON.stringify({
      fileName,
      mimeType: document.mimeType,
      contentBase64: content.toString('base64'),
      processingConsent: true,
      primaryIntentKey: intentKey,
      requirementKey,
    }),
  });
  return {
    fileName,
    mimeType: document.mimeType,
    status: response.status,
    accepted: response.body?.accepted ?? false,
    documentIdDigest: response.body?.document?.id ? digest(response.body.document.id) : null,
    jobIdDigest: response.body?.jobId ? digest(response.body.jobId) : null,
    error: errorCode(response.body) ? { code: errorCode(response.body), message: redact(errorMessage(response.body) ?? '') } : null,
  };
}

const transcript = [];
const sessionResponse = await request('/api/v1/chat/sessions', { method: 'POST', body: JSON.stringify({ tenantSlug }) });
assert.equal(sessionResponse.status, 201, `session creation failed: ${JSON.stringify(sessionResponse.body)}`);
const session = sessionResponse.body;
const sessionReview = { sessionIdDigest: digest(session.sessionId), tenantIdDigest: digest(session.tenantId), turns: transcript };

const turns = [
  'Hello! I am exploring options for setting up a new company in the UAE.',
  'I am considering a technology consulting company. Could you clarify the setup steps, expected timeline, and whether a shared office can work?',
  'What documents would you need from me?',
  'Yes, I want to proceed with creating the new company.',
  'My name is Synthetic Review Customer.',
  `My email is ${syntheticEmail} and my phone is ${syntheticPhone}.`,
  'Yes',
];

let actionId = null;
let intentKey = null;
for (let index = 0; index < turns.length; index += 1) {
  const response = await sendTurn(session, turns[index], index + 1, transcript);
  intentKey = response.body?.pendingIntentKey ?? intentKey;
  if (response.body?.actionProposal?.id) actionId = response.body.actionProposal.id;
}
if (!actionId) {
  const response = await sendTurn(session, 'I consent to the use of my contact details to register this request.', turns.length + 1, transcript, { type: 'postback', postbackValue: 'v2:contact-consent:grant' });
  intentKey = response.body?.pendingIntentKey ?? intentKey;
  if (response.body?.actionProposal?.id) actionId = response.body.actionProposal.id;
}

let consent = { attempted: false, status: null, accepted: false, error: null };
if (actionId) {
  consent.attempted = true;
  const response = await request(`/api/v1/chat/actions/${actionId}/confirm`, {
    method: 'POST',
    headers: chatHeaders(session.sessionToken),
    body: JSON.stringify({ sessionId: session.sessionId, confirmed: true }),
  });
  consent.status = response.status;
  consent.accepted = response.status >= 200 && response.status < 300;
  consent.error = errorCode(response.body) ? { code: errorCode(response.body), message: redact(errorMessage(response.body) ?? '') } : null;
}

const leadAction = actionId ? await pollAction(session, actionId) : null;
const leadCompleted = leadAction?.action?.state === 'completed' && typeof leadAction.action.result?.externalReference === 'string';
let reconciliationFollowUp = null;
if (leadAction?.action?.state === 'reconcile_required' && actionId) {
  const response = await request(`/api/v1/chat/actions/${actionId}/follow-up?sessionId=${encodeURIComponent(session.sessionId)}`, { method: 'POST', headers: chatHeaders(session.sessionToken), body: '{}' });
  reconciliationFollowUp = { status: response.status, answer: typeof response.body?.message?.answer === 'string' ? redact(response.body.message.answer) : null, error: errorCode(response.body) ? { code: errorCode(response.body), message: redact(errorMessage(response.body) ?? '') } : null };
}
const packagesResponse = await request(`/api/v1/chat/sessions/${session.sessionId}/packages`, { headers: chatHeaders(session.sessionToken) });
const packages = Array.isArray(packagesResponse.body?.items) ? packagesResponse.body.items : [];
const selectedPackage = packages.find((item) => /growth/i.test(item.name ?? item.packageKey ?? '')) ?? packages[0] ?? null;
let packageSelection = null;
let quoteAction = null;
let quoteExecution = null;
let quoteDownload = null;
if (leadCompleted && selectedPackage && packagesResponse.status === 200) {
  const response = await request(`/api/v1/chat/sessions/${session.sessionId}/packages/select`, {
    method: 'POST',
    headers: chatHeaders(session.sessionToken),
    body: JSON.stringify({ packageKey: selectedPackage.packageKey }),
  });
  packageSelection = {
    status: response.status,
    packageKey: selectedPackage.packageKey,
    packageOfferingIdDigest: digest(selectedPackage.id),
    selectionIdDigest: response.body?.selection?.id ? digest(response.body.selection.id) : null,
    error: errorCode(response.body) ? { code: errorCode(response.body), message: redact(errorMessage(response.body) ?? '') } : null,
  };
  quoteAction = response.body?.action ?? null;
  if (quoteAction?.id && packageSelection?.status >= 200 && packageSelection?.status < 300) {
    const quoteActionResult = await pollAction(session, quoteAction.id);
    const quoteResponse = await request(`/api/v1/chat/sessions/${session.sessionId}/packages/quotes`, {
      method: 'POST',
      headers: chatHeaders(session.sessionToken),
      body: JSON.stringify({ opportunityId: response.body?.selection?.opportunityId ?? null, packageOfferingId: selectedPackage.id }),
    });
    const completedAction = quoteActionResult?.action;
    const quote = quoteResponse.body?.quote;
    quoteExecution = {
      status: quoteResponse.status,
      verified: completedAction?.state === 'completed' && quoteResponse.status === 200,
      mock: completedAction?.result?.artifactId ? true : false,
      n8nDispatched: completedAction?.state === 'completed',
      quoteIdDigest: quote?.id ? digest(quote.id) : null,
      totalAed: quote?.totalAed ?? null,
      artifact: completedAction?.result?.artifactFileName ? { fileName: completedAction.result.artifactFileName, mimeType: completedAction.result.artifactMimeType, sha256: completedAction.result.artifactSha256 } : null,
      error: completedAction?.state !== 'completed' || errorCode(quoteResponse.body) ? { code: errorCode(quoteResponse.body) ?? `QUOTE_ACTION_${completedAction?.state ?? 'UNKNOWN'}`, message: redact(errorMessage(quoteResponse.body) ?? 'The n8n quote workflow did not complete.') } : null,
    };
    if (quote?.id && quoteExecution.verified) {
      await mkdir(artifactDir, { recursive: true });
      const download = await request(`/api/v1/chat/sessions/${session.sessionId}/quotes/${quote.id}/download`, { headers: chatHeaders(session.sessionToken) });
      const filePath = resolve(artifactDir, 'quote-live-review.pdf');
      if (download.status === 200 && download.body instanceof ArrayBuffer) {
        await writeFile(filePath, Buffer.from(download.body));
      quoteDownload = { status: download.status, path: 'artifacts/quote-sandbox-2026-11-10/quote-live-review.pdf', bytes: download.body.byteLength, sha256: createHash('sha256').update(Buffer.from(download.body)).digest('hex') };
      } else {
        quoteDownload = { status: download.status, error: errorCode(download.body) ? { code: errorCode(download.body), message: redact(errorMessage(download.body) ?? '') } : 'download did not return a PDF' };
      }
    }
  }
}

let documentPrompt = null;
if (quoteExecution?.verified) {
  const response = await sendTurn(session, 'Thanks. What do I need to provide next?', transcript.length + 1, transcript);
  intentKey = response.body?.pendingIntentKey ?? intentKey;
  documentPrompt = responseSummary(response);
}

const documentConfig = await request(`/api/v1/chat/sessions/${session.sessionId}/documents/config`, { headers: chatHeaders(session.sessionToken) });
const documentUploads = [];
const activeRequirements = Array.isArray(documentConfig.body?.requirements) ? documentConfig.body.requirements : [];
const activeDocumentRequirement = activeRequirements.find((candidate) => candidate.intentKey === intentKey && candidate.documentType === 'identity_document');
const documentPromptMatchesPolicy = Boolean(documentPrompt?.pendingRequirementKey && activeDocumentRequirement?.requirementKey === documentPrompt.pendingRequirementKey);
if (leadCompleted && packageSelection?.status >= 200 && packageSelection?.status < 300 && quoteExecution?.verified && documentConfig.body?.enabled === true && intentKey && documentPromptMatchesPolicy) {
  const packageRequirements = selectedPackage?.requiredDocuments ?? [];
  for (let index = 0; index < Math.min(documents.length, 1); index += 1) {
    const requiredType = packageRequirements[index] ?? packageRequirements[0] ?? null;
    const requirement = activeRequirements.find((candidate) => candidate.intentKey === intentKey && (!requiredType || candidate.documentType === requiredType || candidate.allowedDocumentTypes?.includes(requiredType)))
      ?? activeRequirements.find((candidate) => candidate.intentKey === intentKey);
    if (!requirement) {
      documentUploads.push({ fileName: documentFileName(documents[index]), status: null, accepted: false, error: { code: 'DOCUMENT_REQUIREMENT_NOT_CONFIGURED', message: 'No active catalog document requirement matches the confirmed package.' } });
      continue;
    }
    try {
      documentUploads.push(await uploadDocument(session, intentKey, requirement.requirementKey, documents[index]));
    } catch (error) {
      documentUploads.push({ fileName: documentFileName(documents[index]), status: null, accepted: false, error: { code: 'UPLOAD_HARNESS_ERROR', message: redact(error instanceof Error ? error.message : String(error)) } });
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  environment: { baseUrl, tenantSlug, syntheticDataOnly: true, rawDocumentsPersistedInReport: false, leadWorkflowReady: leadCompleted },
  session: sessionReview,
  consent,
  lead: { actionIdDigest: actionId ? digest(actionId) : null, intentKey: leadAction?.action?.intentKey ?? intentKey ?? null, actionKey: leadAction?.action?.actionKey ?? null, catalogVersionIdDigest: leadAction?.action?.catalogVersionId ? digest(leadAction.action.catalogVersionId) : null, state: leadAction?.action?.state ?? null, attempts: leadAction?.attempts ?? null, reconciliationFollowUp },
  packageCatalog: { status: packagesResponse.status, count: packages.length, selectedPackage: selectedPackage ? { packageKey: selectedPackage.packageKey, name: redact(selectedPackage.name), priceAed: selectedPackage.priceAed, requiredDocuments: selectedPackage.requiredDocuments } : null },
  packageSelection,
  quote: { actionIdDigest: quoteAction?.id ? digest(quoteAction.id) : null, state: quoteAction?.state ?? null, execution: quoteExecution, download: quoteDownload, nextDocumentTurn: documentPrompt },
  documents: { configStatus: documentConfig.status, config: documentConfig.body?.enabled === undefined ? null : { enabled: documentConfig.body.enabled, workflowKey: documentConfig.body.workflowKey ?? null, allowedMimeTypes: documentConfig.body.allowedMimeTypes ?? [], requirements: (documentConfig.body.requirements ?? []).map((requirement) => ({ intentKey: requirement.intentKey, requirementKey: requirement.requirementKey, documentType: requirement.documentType })) }, uploads: documentUploads },
  outcome: { quoteGenerated: Boolean(quoteExecution?.verified && quoteDownload?.status === 200), quoteDownloadable: Boolean(quoteDownload?.status === 200), documentPromptExposed: documentPromptMatchesPolicy, documentUploadAccepted: documentUploads.some((item) => item.accepted), leadActionCompleted: leadAction?.action?.state === 'completed', providerGate: leadAction?.action?.state === 'reconcile_required' ? 'salesforce_or_n8n_reconciliation_required' : leadCompleted ? null : 'lead_provider_not_verified' },
};
await writeFile(reviewPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ reviewPath, outcome: report.outcome, leadState: report.lead.state, quoteState: report.quote.state, quoteExecution: report.quote.execution, documentUploads: report.documents.uploads }, null, 2));
if (!report.outcome.quoteGenerated) process.exitCode = 2;
else if (documentConfig.body?.enabled === true && !report.outcome.documentPromptExposed) process.exitCode = 3;

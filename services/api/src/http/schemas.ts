import { z } from 'zod';
import { MAX_INGESTION_FILE_BYTES } from '../ingestion-staging.js';
import { MAX_DOCUMENT_BYTES } from '../document-intake.js';

export const DEFAULT_CONTEXT_WINDOW_MESSAGES = 10;
const MAX_KNOWLEDGE_CONTENT_CHARS = 1_000_000;
const MAX_INGESTION_RESULT_BYTES = 25 * 1024 * 1024;
const MAX_INGESTION_RESULT_CHUNKS = 100_000;
const MAX_INGESTION_BASE64_CHARS = Math.ceil(MAX_INGESTION_FILE_BYTES / 3) * 4;
const MAX_DOCUMENT_BASE64_CHARS = Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4;

const safePersonaText = (max: number) => z.string().trim().min(1).max(max).refine((value) => !/\b(ignore (?:all )?rules|system prompt|search the web|reveal secrets|bypass security)\b/i.test(value), 'Persona contains an unsafe instruction.');

export const passwordSchema = z.string().min(8).max(128).regex(/[A-Z]/, 'Password must contain an uppercase letter.').regex(/\d/, 'Password must contain a number.');
export const tenantStatusSchema = z.object({ status: z.enum(['active', 'suspended', 'archived']) });
export const memberRoleSchema = z.object({ role: z.enum(['tenant_editor', 'tenant_viewer', 'tenant_agent']) });
export const tenantSchema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(80), adminEmail: z.string().email(), adminPassword: passwordSchema });
export const memberSchema = z.object({ email: z.string().email(), password: passwordSchema, role: z.enum(['tenant_editor', 'tenant_viewer', 'tenant_agent']) });
export const domainSchema = z.object({ hostname: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'A valid hostname is required.') });
export const channelSchema = z.object({ publicOrigin: z.union([z.literal(''), z.string().url().refine((value) => { const url = new URL(value); return (url.protocol === 'http:' || url.protocol === 'https:') && url.pathname === '/' && !url.search && !url.hash; }, 'A public origin must be an HTTP(S) origin without a path.')]), publicChatEnabled: z.boolean().optional() });
export const featureSchema = z.object({ catalogQueryNormalizationEnabled: z.boolean() }).strict();
export const channelCredentialSchema = z.object({ channel: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9_-]{1,31}$/, 'Channel must be 2-32 lowercase characters, digits, underscores or hyphens.'), authMode: z.enum(['hmac', 'api_key']).default('hmac') });
export const personaSchema = z.object({
  name: safePersonaText(80),
  greeting: safePersonaText(500),
  personality: safePersonaText(500),
  tone: safePersonaText(200),
  speakingStyle: safePersonaText(200),
  permittedLanguages: z.array(z.string().min(2).max(12)).min(1).max(10),
  contextWindowMessages: z.coerce.number().int().min(1).max(DEFAULT_CONTEXT_WINDOW_MESSAGES).default(DEFAULT_CONTEXT_WINDOW_MESSAGES),
  voiceName: z.string().trim().max(200).default(''),
  voiceLanguage: z.string().trim().regex(/^[a-z]{2,3}(?:-[a-z]{2,4})?$/i).default('en-US'),
  voiceRate: z.coerce.number().min(0.5).max(2).default(1),
  voicePitch: z.coerce.number().min(0).max(2).default(1),
  voiceVolume: z.coerce.number().min(0).max(1).default(1)
});
export const personaPreviewSchema = personaSchema.extend({ message: z.string().trim().min(1).max(4000) });
export const sourceSchema = z.object({ title: z.string().trim().min(1).max(200), mimeType: z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-ndjson', 'text/html', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']), sourceUrl: z.string().url().optional(), audience: z.enum(['public', 'internal']).default('public'), content: z.string().trim().min(1).max(MAX_KNOWLEDGE_CONTENT_CHARS) });
export const uploadSchema = z.object({ title: z.string().trim().min(1).max(200), fileName: z.string().trim().min(1).max(240).regex(/^[^\\/]+$/), mimeType: z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-ndjson', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip']), audience: z.enum(['public', 'internal']).default('public'), contentBase64: z.string().min(1).max(MAX_INGESTION_BASE64_CHARS) });
export const intentCatalogUploadSchema = z.object({ fileName: z.string().trim().min(1).max(240).regex(/^[^\\/]+$/i).refine((value) => value.toLowerCase().endsWith('.xlsx'), 'An .xlsx workbook is required.'), contentBase64: z.string().min(1).max(MAX_INGESTION_BASE64_CHARS) });
export const intentCatalogEditSchema = z.object({ catalog: z.unknown() });
export const intentCatalogResultSchema = z.object({ sourceHash: z.string().regex(/^[a-f0-9]{64}$/), parserVersion: z.string().trim().min(1).max(120), catalog: z.unknown() });
export const ingestionRequestSchema = sourceSchema.omit({ content: true });
export const ingestionResultSchema = z.object({
  normalizedContent: z.string().min(1).refine((value) => Buffer.byteLength(value, 'utf8') <= MAX_INGESTION_RESULT_BYTES, 'Normalized ingestion output exceeds the configured byte budget; split the source into smaller files.'),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: z.string().trim().min(1).max(120),
  chunks: z.array(z.object({ ordinal: z.number().int().nonnegative(), locator: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(20_000), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(MAX_INGESTION_RESULT_CHUNKS),
  warnings: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
});
export const ingestionFailureSchema = z.object({ errorCode: z.string().trim().regex(/^[A-Z0-9_]{1,80}$/).default('INGESTION_FAILED'), errorDetail: z.string().trim().min(1).max(2_000).optional() });
export const sessionSchema = z.object({ tenantId: z.string().uuid().optional(), tenantSlug: z.string().regex(/^[a-z0-9-]+$/).optional() });
export const messageSchema = z.object({ sessionId: z.string().uuid(), type: z.enum(['text', 'postback', 'attachment']).default('text'), message: z.string().trim().max(4000).default(''), postbackValue: z.string().trim().max(4000).optional(), replyToPromptId: z.string().uuid().optional(), clientMessageId: z.string().trim().min(1).max(128) }).superRefine((value, context) => {
  if (value.type === 'postback' && !value.postbackValue && !value.message) context.addIssue({ code: z.ZodIssueCode.custom, path: ['postbackValue'], message: 'A postback value is required.' });
  if (value.type !== 'postback' && !value.message) context.addIssue({ code: z.ZodIssueCode.custom, path: ['message'], message: 'A message is required.' });
});
export const confirmSchema = z.object({ sessionId: z.string().uuid(), confirmed: z.literal(true) });
export const retentionSchema = z.object({ before: z.string().datetime() });
export const historyQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(100) });
const leadTokenSchema = z.string().regex(/^\[(?:NAME|EMAIL|PHONE)_\d+\]$/);
export const crmLeadSchema = z.object({
  actionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  sessionId: z.string().uuid(),
  leadData: z.object({ name: leadTokenSchema.optional(), email: leadTokenSchema.optional(), phone: leadTokenSchema.optional(), interest: z.string().trim().min(1).max(200).optional(), slotValues: z.record(z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/u), z.string().trim().max(2000)).optional(), contactConsent: z.boolean().optional() }).strict(),
  intent: z.string().trim().min(1).max(80),
  intentScore: z.number().int().min(0).max(100).optional(),
  intentConfidence: z.number().min(0).max(1).optional(),
  catalogVersionId: z.string().uuid().nullable().optional(),
  score: z.number().int().min(0).max(100),
  validationPass: z.boolean(),
  conversation: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(20_000), createdAt: z.string().datetime() })).min(1).max(200),
  completeAction: z.boolean().default(true)
});
export const crmSummarySchema = z.object({ tenantId: z.string().uuid(), summary: z.string().trim().min(1).max(20_000), status: z.enum(['completed', 'failed']) });
export const crmAdminSummarySchema = z.object({}).strict();
export const crmQualificationSchema = z.object({ tenantId: z.string().uuid(), score: z.number().int().min(0).max(100), summary: z.string().trim().min(1).max(20_000) });
export const crmRemoteSchema = z.object({ tenantId: z.string().uuid(), leadId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/u), remoteCrm: z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9._:-]*$/u) });
export const crmRemotePayloadSchema = z.object({ tenantId: z.string().uuid(), actionId: z.string().uuid() });
const workflowExecutionReference = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u);
export const workflowClaimSchema = z.object({ actionId: z.string().uuid().optional(), tenantId: z.string().uuid().optional(), workflowKey: z.string().trim().regex(/^[a-z][a-z0-9]*(?:\.[a-z0-9_-]+)+$/i).optional(), n8nWorkflowId: z.string().trim().min(1).max(120), contract: z.string().trim().min(1).max(120).optional(), executionReference: workflowExecutionReference, eventId: z.string().uuid().optional(), correlationId: z.string().uuid().optional(), attempt: z.number().int().min(1).max(100_000).optional(), limit: z.number().int().min(1).max(50).default(10) }).superRefine((value, context) => {
  if (value.actionId && !value.tenantId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['tenantId'], message: 'Webhook claims require the server-issued tenant id.' });
  if (value.actionId && !value.eventId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['eventId'], message: 'Webhook claims require the server-issued event id.' });
  if (value.actionId && !value.correlationId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['correlationId'], message: 'Webhook claims require the server-issued correlation id.' });
  if (value.actionId && value.attempt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['attempt'], message: 'Webhook claims require the server-issued attempt.' });
});
const opaqueReference = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u).optional();
const workflowCorrelationFields = { eventId: z.string().uuid().optional(), correlationId: z.string().uuid().optional(), attempt: z.number().int().min(1).max(100_000).optional() };
export const workflowCompletionSchema = z.object({ actionId: z.string().uuid(), tenantId: z.string().uuid(), state: z.enum(['processing', 'completed', 'failed', 'reconcile_required', 'awaiting_customer', 'human_review']), externalReference: opaqueReference, executionReference: opaqueReference, ...workflowCorrelationFields }).superRefine((value, context) => {
  if (value.state === 'completed' || value.state === 'failed') {
    if (!value.executionReference) context.addIssue({ code: z.ZodIssueCode.custom, path: ['executionReference'], message: 'Provider terminal transitions require an execution reference.' });
    if (!value.eventId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['eventId'], message: 'Provider terminal transitions require an event id.' });
    if (!value.correlationId) context.addIssue({ code: z.ZodIssueCode.custom, path: ['correlationId'], message: 'Provider terminal transitions require a correlation id.' });
    if (value.attempt === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ['attempt'], message: 'Provider terminal transitions require an attempt.' });
  }
});
export const workflowTransitionSchema = z.object({ state: z.enum(['processing', 'completed', 'failed', 'reconcile_required', 'awaiting_customer', 'human_review']), externalReference: opaqueReference, executionReference: opaqueReference, ...workflowCorrelationFields });
export const crmQualitySchema = z.object({ tenantId: z.string().uuid(), score: z.number().int().min(0).max(100), qualityWorkflowKey: z.string().trim().min(1).max(80), catalogVersionId: z.string().uuid(), intentKey: z.string().trim().min(1).max(80) });
export const documentUploadSchema = z.object({ fileName: z.string().trim().min(1).max(240).regex(/^[^\\/]+$/), mimeType: z.string().trim().min(1).max(160), contentBase64: z.string().min(1).max(MAX_DOCUMENT_BASE64_CHARS), processingConsent: z.literal(true), primaryIntentKey: z.string().trim().min(1).max(80).optional(), requirementKey: z.string().trim().min(1).max(120).optional() });
export const documentResultSchema = z.object({ tenantId: z.string().uuid(), jobId: z.string().uuid(), extractedText: z.string().max(100_000).default(''), summary: z.string().max(20_000).default(''), executionReference: z.string().trim().max(200).regex(/^[A-Za-z0-9._:-]+$/u).optional() });
export const documentFailureSchema = z.object({ tenantId: z.string().uuid(), jobId: z.string().uuid(), errorCode: z.string().trim().regex(/^[A-Z0-9_]{1,80}$/).default('DOCUMENT_OCR_FAILED') });
export const documentRenewSchema = z.object({ tenantId: z.string().uuid(), jobId: z.string().uuid(), leaseMs: z.number().int().min(60_000).max(900_000).default(120_000) });

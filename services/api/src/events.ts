import { z } from 'zod';
import type { DomainEventType, EventPayload, EventStream, OutboxEvent } from './types.js';

export const EVENT_STREAMS = {
  crm: 'rag:v2:crm',
  documents: 'rag:v2:documents',
  actions: 'rag:v2:actions',
  notifications: 'rag:v2:notifications',
  ingestion: 'rag:v2:ingestion',
  deadLetter: 'rag:v2:dead-letter',
} as const satisfies Record<string, EventStream>;

const uuid = z.string().guid();
const payloadValue = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);

export const outboxEventSchema = z.object({
  eventId: uuid,
  eventType: z.enum([
    'crm.contact.upsert.requested.v1',
    'crm.summary.update.requested.v1',
    'crm.reconcile.requested.v1',
    'document.extraction.requested.v1',
    'intent.action.requested.v1',
    'conversation.notification.requested.v1',
    'ingestion.progress.v1',
  ]),
  stream: z.enum(['rag:v2:crm', 'rag:v2:documents', 'rag:v2:actions', 'rag:v2:notifications', 'rag:v2:ingestion', 'rag:v2:dead-letter']),
  tenantId: uuid,
  sessionId: uuid.nullable(),
  actionId: uuid.nullable(),
  aggregateId: uuid,
  aggregateVersion: z.number().int().positive(),
  workflowKey: z.string().max(200).nullable(),
  payloadRef: z.string().min(1).max(200),
  idempotencyKey: z.string().min(1).max(200),
  correlationId: uuid,
  payload: z.record(z.string(), payloadValue),
  occurredAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  attempts: z.number().int().nonnegative(),
  leaseExpiresAt: z.string().datetime().nullable(),
  lastError: z.string().max(500).nullable(),
});

export const assertSafeEvent = (event: OutboxEvent): OutboxEvent => {
  const parsed = outboxEventSchema.parse(event);
  for (const [key, value] of Object.entries(parsed.payload)) {
    const looksLikeIdentifier = typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
    if (/(?:^|_)(?:name|email|phone|message|content|text|ocr|file|leaddata)(?:$|_)/i.test(key) || (typeof value === 'string' && !looksLikeIdentifier && (value.includes('@') || /\+?\d[\d\s().-]{7,}/u.test(value)))) throw new Error('Event payload may contain routing references only.');
  }
  return parsed;
};

export const eventStreamFor = (eventType: DomainEventType): EventStream => {
  if (eventType.startsWith('ingestion.')) return EVENT_STREAMS.ingestion;
  if (eventType.startsWith('document.')) return EVENT_STREAMS.documents;
  if (eventType.startsWith('intent.')) return EVENT_STREAMS.actions;
  if (eventType.startsWith('conversation.')) return EVENT_STREAMS.notifications;
  return EVENT_STREAMS.crm;
};

export const createOutboxEvent = (input: {
  eventId: string;
  eventType: DomainEventType;
  tenantId: string;
  sessionId?: string | null;
  actionId?: string | null;
  aggregateId: string;
  aggregateVersion?: number;
  workflowKey?: string | null;
  payloadRef: string;
  idempotencyKey: string;
  correlationId?: string;
  payload?: EventPayload;
  occurredAt?: string;
}): OutboxEvent => {
  const event: OutboxEvent = {
    eventId: input.eventId,
    eventType: input.eventType,
    stream: eventStreamFor(input.eventType),
    tenantId: input.tenantId,
    sessionId: input.sessionId ?? null,
    actionId: input.actionId ?? null,
    aggregateId: input.aggregateId,
    aggregateVersion: input.aggregateVersion ?? 1,
    workflowKey: input.workflowKey ?? null,
    payloadRef: input.payloadRef,
    idempotencyKey: input.idempotencyKey,
    correlationId: input.correlationId ?? input.eventId,
    payload: input.payload ?? {},
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    publishedAt: null,
    attempts: 0,
    leaseExpiresAt: null,
    lastError: null,
  };
  return assertSafeEvent(event);
};

export const eventFields = (event: OutboxEvent): Record<string, string> => ({
  eventId: event.eventId,
  eventType: event.eventType,
  stream: event.stream,
  tenantId: event.tenantId,
  sessionId: event.sessionId ?? '',
  actionId: event.actionId ?? '',
  aggregateId: event.aggregateId,
  aggregateVersion: String(event.aggregateVersion),
  workflowKey: event.workflowKey ?? '',
  payloadRef: event.payloadRef,
  idempotencyKey: event.idempotencyKey,
  correlationId: event.correlationId,
  payload: JSON.stringify(event.payload),
  occurredAt: event.occurredAt,
});

export const eventFromFields = (fields: Record<string, string>): OutboxEvent => assertSafeEvent({
  eventId: requiredField(fields, 'eventId'),
  eventType: requiredField(fields, 'eventType') as DomainEventType,
  stream: requiredField(fields, 'stream') as EventStream,
  tenantId: requiredField(fields, 'tenantId'),
  sessionId: fields.sessionId || null,
  actionId: fields.actionId || null,
  aggregateId: requiredField(fields, 'aggregateId'),
  aggregateVersion: Number(requiredField(fields, 'aggregateVersion')),
  workflowKey: fields.workflowKey || null,
  payloadRef: requiredField(fields, 'payloadRef'),
  idempotencyKey: requiredField(fields, 'idempotencyKey'),
  correlationId: requiredField(fields, 'correlationId'),
  payload: JSON.parse(fields.payload || '{}') as EventPayload,
  occurredAt: requiredField(fields, 'occurredAt'),
  publishedAt: null,
  attempts: 0,
  leaseExpiresAt: null,
  lastError: null,
});

const requiredField = (fields: Record<string, string>, key: string): string => {
  const value = fields[key];
  if (!value) throw new Error(`Event field ${key} is missing.`);
  return value;
};

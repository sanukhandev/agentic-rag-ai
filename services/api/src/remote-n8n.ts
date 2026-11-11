import { createHash } from 'node:crypto';
import type { ActionRequest } from './types.js';

export type RemoteN8nPayloadContract = 'remote.salesforce-lead.v1' | 'remote.generate-quotation.v1';

export interface RemoteN8nRoute {
  webhookPath: string;
  payloadContract: RemoteN8nPayloadContract;
}

export interface RemoteN8nDispatchInput {
  baseUrl: string;
  quotationApiKey: string;
  route: RemoteN8nRoute;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RemoteN8nDispatchResult {
  providerStatus: 'accepted';
  result: NonNullable<ActionRequest['result']>;
  outcome: Record<string, string | number | boolean | null>;
}

export class RemoteN8nError extends Error {
  constructor(readonly code: string, readonly retryable = false) { super(code); }
}

const safePath = (value: string): string => {
  const path = value.replace(/^\/+/, '');
  if (!/^[A-Za-z0-9._/-]{1,160}$/u.test(path) || path.includes('..')) throw new RemoteN8nError('remote_n8n_invalid_route');
  return path;
};

const endpoint = (baseUrl: string, path: string): string => {
  let base: URL;
  try { base = new URL(baseUrl); } catch { throw new RemoteN8nError('remote_n8n_invalid_base_url'); }
  if (base.protocol !== 'https:') throw new RemoteN8nError('remote_n8n_https_required');
  return `${base.toString().replace(/\/$/u, '')}/${safePath(path)}`;
};

const responseError = (status: number): RemoteN8nError =>
  new RemoteN8nError(`remote_n8n_http_${status}`, [408, 425, 429, 500, 502, 503, 504].includes(status));

const normalizeLead = (value: unknown): RemoteN8nDispatchResult => {
  if (!value || typeof value !== 'object') throw new RemoteN8nError('remote_n8n_invalid_lead_response');
  const response = value as Record<string, unknown>;
  const status = typeof response.status === 'string' ? response.status.toUpperCase() : '';
  const leadId = typeof response.leadId === 'string' ? response.leadId.trim() : '';
  if (response.success !== true || !['SUCCESS', 'UPDATED'].includes(status) || !/^[A-Za-z0-9._:-]{1,200}$/u.test(leadId)) throw new RemoteN8nError('remote_n8n_invalid_lead_response');
  const providerOutcome = status === 'UPDATED' ? 'updated' : 'success';
  return { providerStatus: 'accepted', result: { externalReference: leadId, providerOutcome }, outcome: { providerOutcome, providerReference: leadId, providerEvidence: false } };
};

const normalizeQuotation = (bytes: Buffer, contentType: string): RemoteN8nDispatchResult => {
  if (!contentType.toLocaleLowerCase('en-US').includes('application/pdf') || bytes.length < 5 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new RemoteN8nError('remote_n8n_invalid_quotation_response');
  const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    providerStatus: 'accepted',
    result: { externalReference: `quotation-${artifactSha256.slice(0, 32)}`, artifactSha256, artifactFileName: 'quotation.pdf', artifactMimeType: 'application/pdf', providerOutcome: 'pdf_generated' },
    outcome: { providerOutcome: 'pdf_generated', artifactSha256, artifactAvailable: true, providerEvidence: false },
  };
};

export const dispatchRemoteN8n = async (input: RemoteN8nDispatchInput): Promise<RemoteN8nDispatchResult> => {
  const url = endpoint(input.baseUrl, input.route.webhookPath);
  if (input.route.payloadContract === 'remote.generate-quotation.v1' && !input.quotationApiKey.trim()) throw new RemoteN8nError('remote_n8n_quotation_key_missing');
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) throw new RemoteN8nError('remote_n8n_invalid_idempotency_key');
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-agentic-idempotency-key': input.idempotencyKey };
  if (input.route.payloadContract === 'remote.generate-quotation.v1') headers['x-api-key'] = input.quotationApiKey;
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(input.payload), signal: AbortSignal.timeout(input.timeoutMs ?? 30_000) });
  } catch (error) {
    if (error instanceof RemoteN8nError) throw error;
    throw new RemoteN8nError('remote_n8n_unavailable', true);
  }
  if (!response.ok) throw responseError(response.status);
  if (input.route.payloadContract === 'remote.salesforce-lead.v1') {
    let value: unknown;
    try { value = await response.json(); } catch { throw new RemoteN8nError('remote_n8n_invalid_lead_response'); }
    return normalizeLead(value);
  }
  return normalizeQuotation(Buffer.from(await response.arrayBuffer()), response.headers.get('content-type') ?? '');
};

import type { V2LeadProviderRequest } from './v2-lead-provider.js';
import type { V2TrustedProviderReadback } from './v2-provider-evidence.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type SalesforceSandboxLeadProviderOptions = {
  accessToken?: string;
  readbackUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export type SalesforceSandboxLeadReadbackProvider = Pick<SalesforceSandboxLeadProvider, 'verify'>;

const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 5_000;

const retryDelayMs = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(MAX_RETRY_DELAY_MS, seconds * 1_000);
  return Math.min(MAX_RETRY_DELAY_MS, 100 * (2 ** (attempt - 1)));
};

const wait = async (delayMs: number): Promise<void> => {
  if (delayMs > 0) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

const objectRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
);

const providerRecord = (value: unknown): Record<string, unknown> => {
  const root = objectRecord(value);
  if (!root) throw new Error('SALESFORCE_READBACK_INVALID');
  return objectRecord(root.lead) ?? objectRecord(root.Lead) ?? objectRecord(root.record) ?? root;
};

const stringField = (record: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) if (typeof record[key] === 'string' && record[key].trim()) return record[key].trim();
  return null;
};

export class SalesforceSandboxLeadProvider {
  private readonly accessToken: string;
  private readonly readbackUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: SalesforceSandboxLeadProviderOptions) {
    this.accessToken = options.accessToken?.trim() ?? '';
    this.readbackUrl = options.readbackUrl?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async verify(input: { request: V2LeadProviderRequest; providerRecordId: string }): Promise<V2TrustedProviderReadback> {
    const { request, providerRecordId } = input;
    if (!this.accessToken || !this.readbackUrl || !this.readbackUrl.includes('{leadId}')) throw new Error('SALESFORCE_READBACK_NOT_CONFIGURED');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(providerRecordId)) throw new Error('SALESFORCE_READBACK_RECORD_INVALID');
    const url = this.readbackUrl.replaceAll('{leadId}', encodeURIComponent(providerRecordId));

    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${this.accessToken}` },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        if (attempt === MAX_ATTEMPTS) throw new Error('SALESFORCE_READBACK_UNAVAILABLE');
        await wait(Math.min(MAX_RETRY_DELAY_MS, 100 * (2 ** (attempt - 1))));
        continue;
      }
      if (!TRANSIENT_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) break;
      await wait(retryDelayMs(response, attempt));
    }

    if (!response) throw new Error('SALESFORCE_READBACK_UNAVAILABLE');
    if (response.status === 401 || response.status === 403) throw new Error('SALESFORCE_READBACK_AUTH_FAILED');
    if (!response.ok) throw new Error('SALESFORCE_READBACK_FAILED');
    const body = await response.json().catch(() => null) as unknown;
    const record = providerRecord(body);
    const returnedRecordId = stringField(record, ['leadId', 'LeadId', 'id', 'Id']);
    if (returnedRecordId !== providerRecordId) throw new Error('SALESFORCE_READBACK_MISMATCH');
    for (const [key, expected] of Object.entries({
      idempotencyKey: request.idempotencyKey,
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      opportunityId: request.opportunityId,
    })) {
      if (record[key] !== undefined && record[key] !== expected) throw new Error('SALESFORCE_READBACK_MISMATCH');
    }

    return {
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      opportunityId: request.opportunityId,
      providerType: 'salesforce_sandbox',
      idempotencyKey: request.idempotencyKey,
      recordRef: returnedRecordId,
      evidenceTier: 'provider_record_verified',
      verificationStatus: 'verified',
    };
  }
}

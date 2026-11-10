import type { V2LeadProviderRequest } from './conversation/lead-provider.js';
import type { V2AccountProviderRequest } from './conversation/account-provider.js';
import type { V2TrustedProviderReadback } from './conversation/provider-evidence.js';

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type SalesforceSandboxLeadProviderOptions = {
  accessToken?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  readbackUrl?: string;
  leadUpdateUrl?: string;
  attachmentUrl?: string;
  attachmentReadbackUrl?: string;
  accountReadbackUrl?: string;
  contactReadbackUrl?: string;
  opportunityReadbackUrl?: string;
  documentReadbackUrl?: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export type SalesforceSandboxLeadReadbackProvider = Pick<SalesforceSandboxLeadProvider, 'verify'>;
export type SalesforceSandboxLeadMutationProvider = Pick<SalesforceSandboxLeadProvider, 'updateLeadDescription' | 'createLeadAttachment'>;
export type SalesforceSandboxAccountReadbackProvider = Pick<SalesforceSandboxLeadProvider, 'verifyAccount'>;
export type SalesforceSandboxDocumentReadbackProvider = Pick<SalesforceSandboxLeadProvider, 'verifyDocument'>;

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

const collectionUrlFromLeadReadback = (readbackUrl: string): string => readbackUrl.replace(/\/Lead\/\{leadId\}$/u, '/Attachment');
const attachmentReadbackUrlFromCollection = (attachmentUrl: string): string => attachmentUrl.endsWith('/Attachment') ? `${attachmentUrl}/{attachmentId}` : '';

type CorrelatedRequest = Pick<V2TrustedProviderReadback, 'tenantId' | 'sessionId' | 'opportunityId' | 'idempotencyKey'>;
export type SalesforceAccountReadback = V2TrustedProviderReadback & { remoteAccountId: string; remoteContactId: string; remoteOpportunityId: string; leadExternalId: string; deduplicated: boolean };
export type SalesforceDocumentReadback = V2TrustedProviderReadback & { attachmentId: string; leadAttachmentId: string; accountAttachmentId: string; remoteAccountId: string; remoteContactId: string; remoteOpportunityId: string };

export class SalesforceSandboxLeadProvider {
  private readonly accessToken: string;
  private readonly tokenUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private cachedAccessToken = '';
  private tokenExpiresAt = 0;
  private tokenPromise: Promise<string> | null = null;
  private readonly readbackUrl: string;
  private readonly leadUpdateUrl: string;
  private readonly attachmentUrl: string;
  private readonly attachmentReadbackUrl: string;
  private readonly accountReadbackUrl: string;
  private readonly contactReadbackUrl: string;
  private readonly opportunityReadbackUrl: string;
  private readonly documentReadbackUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: SalesforceSandboxLeadProviderOptions) {
    this.accessToken = options.accessToken?.trim() ?? '';
    this.tokenUrl = options.tokenUrl?.trim() ?? '';
    this.clientId = options.clientId?.trim() ?? '';
    this.clientSecret = options.clientSecret?.trim() ?? '';
    this.readbackUrl = options.readbackUrl?.trim() ?? '';
    this.leadUpdateUrl = options.leadUpdateUrl?.trim() || this.readbackUrl;
    this.attachmentUrl = options.attachmentUrl?.trim() || collectionUrlFromLeadReadback(this.readbackUrl);
    this.attachmentReadbackUrl = options.attachmentReadbackUrl?.trim() || attachmentReadbackUrlFromCollection(this.attachmentUrl);
    this.accountReadbackUrl = options.accountReadbackUrl?.trim() ?? '';
    this.contactReadbackUrl = options.contactReadbackUrl?.trim() ?? '';
    this.opportunityReadbackUrl = options.opportunityReadbackUrl?.trim() ?? '';
    this.documentReadbackUrl = options.documentReadbackUrl?.trim() ?? '';
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  isLeadReadbackConfigured(): boolean {
    return Boolean(this.readbackUrl.includes('{leadId}')
      && (this.accessToken || (this.tokenUrl && this.clientId && this.clientSecret)));
  }

  private async requestAccessToken(): Promise<string> {
    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await this.fetchImpl(this.tokenUrl, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret }).toString(),
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
    if (!response.ok) throw new Error('SALESFORCE_READBACK_UNAVAILABLE');
    const body = await response.json().catch(() => null) as unknown;
    const record = objectRecord(body);
    const accessToken = stringField(record ?? {}, ['access_token']);
    if (!accessToken) throw new Error('SALESFORCE_READBACK_AUTH_FAILED');
    const expiresIn = record?.expires_in;
    this.cachedAccessToken = accessToken;
    this.tokenExpiresAt = Date.now() + (typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? Math.max(1, expiresIn - 60) * 1_000 : 300_000);
    return accessToken;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) return this.accessToken;
    if (!this.tokenUrl || !this.clientId || !this.clientSecret) throw new Error('SALESFORCE_READBACK_NOT_CONFIGURED');
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt) return this.cachedAccessToken;
    if (!this.tokenPromise) this.tokenPromise = this.requestAccessToken().finally(() => { this.tokenPromise = null; });
    return this.tokenPromise;
  }

  private async fetchRecord(readbackUrl: string, providerRecordId: string, missingCode: string): Promise<Record<string, unknown>> {
    if ((!this.accessToken && (!this.tokenUrl || !this.clientId || !this.clientSecret)) || !readbackUrl || !readbackUrl.includes('{')) throw new Error(missingCode);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(providerRecordId)) throw new Error('SALESFORCE_READBACK_RECORD_INVALID');
    const url = readbackUrl.replaceAll('{leadId}', encodeURIComponent(providerRecordId)).replaceAll('{accountId}', encodeURIComponent(providerRecordId)).replaceAll('{contactId}', encodeURIComponent(providerRecordId)).replaceAll('{opportunityId}', encodeURIComponent(providerRecordId)).replaceAll('{attachmentId}', encodeURIComponent(providerRecordId));
    const accessToken = await this.getAccessToken();
    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
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
    return providerRecord(body);
  }

  private assertCorrelation(record: Record<string, unknown>, request: CorrelatedRequest): void {
    // Provider opportunityId fields are commonly remote Salesforce IDs; the Node callback already validates the internal opportunity tuple.
    for (const [key, expected] of Object.entries({ idempotencyKey: request.idempotencyKey, tenantId: request.tenantId, sessionId: request.sessionId })) {
      if (record[key] !== undefined && record[key] !== expected) throw new Error('SALESFORCE_READBACK_MISMATCH');
    }
  }

  private attestation(request: CorrelatedRequest, recordRef: string): V2TrustedProviderReadback {
    return { tenantId: request.tenantId, sessionId: request.sessionId, opportunityId: request.opportunityId, providerType: 'salesforce_sandbox', idempotencyKey: request.idempotencyKey, recordRef, evidenceTier: 'provider_record_verified', verificationStatus: 'verified' };
  }

  async verify(input: { request: V2LeadProviderRequest; providerRecordId: string }): Promise<V2TrustedProviderReadback> {
    const { request, providerRecordId } = input;
    const record = await this.fetchRecord(this.readbackUrl, providerRecordId, 'SALESFORCE_READBACK_NOT_CONFIGURED');
    const returnedRecordId = stringField(record, ['leadId', 'LeadId', 'id', 'Id']);
    if (returnedRecordId !== providerRecordId) throw new Error('SALESFORCE_READBACK_MISMATCH');
    this.assertCorrelation(record, request);
    return this.attestation(request, returnedRecordId);
  }

  async updateLeadDescription(input: { providerRecordId: string; description: string }): Promise<{ recordRef: string; description: string }> {
    if (!this.leadUpdateUrl || !this.leadUpdateUrl.includes('{leadId}')) throw new Error('SALESFORCE_LEAD_UPDATE_NOT_CONFIGURED');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.providerRecordId)) throw new Error('SALESFORCE_READBACK_RECORD_INVALID');
    if (!input.description.trim() || input.description.length > 32_000) throw new Error('SALESFORCE_LEAD_DESCRIPTION_INVALID');
    const url = this.leadUpdateUrl.replaceAll('{leadId}', encodeURIComponent(input.providerRecordId));
    const accessToken = await this.getAccessToken();
    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await this.fetchImpl(url, {
          method: 'PATCH',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ Description: input.description }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        if (attempt === MAX_ATTEMPTS) throw new Error('SALESFORCE_LEAD_UPDATE_UNAVAILABLE');
        await wait(Math.min(MAX_RETRY_DELAY_MS, 100 * (2 ** (attempt - 1))));
        continue;
      }
      if (!TRANSIENT_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) break;
      await wait(retryDelayMs(response, attempt));
    }
    if (!response) throw new Error('SALESFORCE_LEAD_UPDATE_UNAVAILABLE');
    if (response.status === 401 || response.status === 403) throw new Error('SALESFORCE_LEAD_UPDATE_AUTH_FAILED');
    if (!response.ok) throw new Error('SALESFORCE_LEAD_UPDATE_FAILED');
    const record = await this.fetchRecord(this.readbackUrl, input.providerRecordId, 'SALESFORCE_READBACK_NOT_CONFIGURED');
    const returnedRecordId = stringField(record, ['leadId', 'LeadId', 'id', 'Id']);
    const description = stringField(record, ['description', 'Description']);
    if (returnedRecordId !== input.providerRecordId || description !== input.description) throw new Error('SALESFORCE_LEAD_UPDATE_READBACK_MISMATCH');
    return { recordRef: returnedRecordId, description };
  }

  async createLeadAttachment(input: { providerRecordId: string; fileName: string; contentBase64: string }): Promise<{ attachmentRef: string; parentRef: string; fileName: string; sizeBytes: number }> {
    if (!this.attachmentUrl || !this.attachmentReadbackUrl) throw new Error('SALESFORCE_ATTACHMENT_NOT_CONFIGURED');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(input.providerRecordId)) throw new Error('SALESFORCE_READBACK_RECORD_INVALID');
    if (!/^[^\\/\r\n]{1,240}$/u.test(input.fileName) || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.contentBase64) || input.contentBase64.length % 4 !== 0) throw new Error('SALESFORCE_ATTACHMENT_INPUT_INVALID');
    const content = Buffer.from(input.contentBase64, 'base64');
    if (content.length === 0) throw new Error('SALESFORCE_ATTACHMENT_INPUT_INVALID');
    const accessToken = await this.getAccessToken();
    let response: Response | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        response = await this.fetchImpl(this.attachmentUrl, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ ParentId: input.providerRecordId, Name: input.fileName, Body: input.contentBase64 }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        if (attempt === MAX_ATTEMPTS) throw new Error('SALESFORCE_ATTACHMENT_UNAVAILABLE');
        await wait(Math.min(MAX_RETRY_DELAY_MS, 100 * (2 ** (attempt - 1))));
        continue;
      }
      if (!TRANSIENT_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) break;
      await wait(retryDelayMs(response, attempt));
    }
    if (!response) throw new Error('SALESFORCE_ATTACHMENT_UNAVAILABLE');
    if (response.status === 401 || response.status === 403) throw new Error('SALESFORCE_ATTACHMENT_AUTH_FAILED');
    if (!response.ok) throw new Error('SALESFORCE_ATTACHMENT_FAILED');
    const created = objectRecord(await response.json().catch(() => null));
    const attachmentRef = stringField(created ?? {}, ['attachmentId', 'AttachmentId', 'id', 'Id']);
    if (!attachmentRef) throw new Error('SALESFORCE_ATTACHMENT_CREATE_INVALID');
    const readback = await this.fetchRecord(this.attachmentReadbackUrl, attachmentRef, 'SALESFORCE_ATTACHMENT_READBACK_NOT_CONFIGURED');
    const returnedRef = stringField(readback, ['attachmentId', 'AttachmentId', 'id', 'Id']);
    const parentRef = stringField(readback, ['parentId', 'ParentId']);
    const returnedName = stringField(readback, ['name', 'Name']);
    if (returnedRef !== attachmentRef || parentRef !== input.providerRecordId || returnedName !== input.fileName) throw new Error('SALESFORCE_ATTACHMENT_READBACK_MISMATCH');
    return { attachmentRef, parentRef, fileName: returnedName, sizeBytes: content.length };
  }

  async verifyAccount(input: { request: Pick<V2AccountProviderRequest, 'tenantId' | 'sessionId' | 'opportunityId' | 'idempotencyKey' | 'leadExternalId'>; providerRecordId: string }): Promise<SalesforceAccountReadback> {
    const relationshipIds = input.providerRecordId.split(':');
    if (relationshipIds.length === 3 && this.contactReadbackUrl && this.opportunityReadbackUrl) {
      const remoteAccountId = relationshipIds[0];
      const remoteContactId = relationshipIds[1];
      const remoteOpportunityId = relationshipIds[2];
      if (!remoteAccountId || !remoteContactId || !remoteOpportunityId || ![remoteAccountId, remoteContactId, remoteOpportunityId].every((value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(value))) throw new Error('SALESFORCE_ACCOUNT_READBACK_RECORD_INVALID');
      const [accountRecord, contactRecord, opportunityRecord] = await Promise.all([
        this.fetchRecord(this.accountReadbackUrl, remoteAccountId, 'SALESFORCE_ACCOUNT_READBACK_NOT_CONFIGURED'),
        this.fetchRecord(this.contactReadbackUrl, remoteContactId, 'SALESFORCE_CONTACT_READBACK_NOT_CONFIGURED'),
        this.fetchRecord(this.opportunityReadbackUrl, remoteOpportunityId, 'SALESFORCE_OPPORTUNITY_READBACK_NOT_CONFIGURED'),
      ]);
      const accountId = stringField(accountRecord, ['accountId', 'AccountId', 'id', 'Id']);
      const contactId = stringField(contactRecord, ['contactId', 'ContactId', 'id', 'Id']);
      const opportunityId = stringField(opportunityRecord, ['opportunityId', 'OpportunityId', 'id', 'Id']);
      const accountDescription = stringField(accountRecord, ['description', 'Description']) ?? '';
      const contactAccountId = stringField(contactRecord, ['accountId', 'AccountId']);
      const opportunityAccountId = stringField(opportunityRecord, ['accountId', 'AccountId']);
      if (accountId !== remoteAccountId || contactId !== remoteContactId || opportunityId !== remoteOpportunityId
        || contactAccountId !== remoteAccountId || opportunityAccountId !== remoteAccountId || !accountDescription.includes(input.request.leadExternalId)) throw new Error('SALESFORCE_ACCOUNT_READBACK_MISMATCH');
      return { ...this.attestation(input.request, remoteAccountId), remoteAccountId, remoteContactId, remoteOpportunityId, leadExternalId: input.request.leadExternalId, deduplicated: false };
    }
    const record = await this.fetchRecord(this.accountReadbackUrl, input.providerRecordId, 'SALESFORCE_ACCOUNT_READBACK_NOT_CONFIGURED');
    const remoteAccountId = stringField(record, ['accountId', 'AccountId', 'id', 'Id']);
    const remoteContactId = stringField(record, ['contactId', 'ContactId']);
    const remoteOpportunityId = stringField(record, ['opportunityId', 'OpportunityId']);
    const leadExternalId = stringField(record, ['leadExternalId', 'leadId', 'LeadId']);
    const deduplicated = record.deduplicated;
    if (remoteAccountId !== input.providerRecordId || !remoteContactId || !remoteOpportunityId || leadExternalId !== input.request.leadExternalId || typeof deduplicated !== 'boolean') throw new Error('SALESFORCE_ACCOUNT_READBACK_MISMATCH');
    this.assertCorrelation(record, input.request);
    return { ...this.attestation(input.request, remoteAccountId), remoteAccountId, remoteContactId, remoteOpportunityId, leadExternalId, deduplicated };
  }

  async verifyDocument(input: { request: CorrelatedRequest; providerRecordId: string; expected: { leadAttachmentId: string; accountAttachmentId: string; remoteAccountId: string; remoteContactId: string; remoteOpportunityId: string } }): Promise<SalesforceDocumentReadback> {
    const record = await this.fetchRecord(this.documentReadbackUrl, input.providerRecordId, 'SALESFORCE_DOCUMENT_READBACK_NOT_CONFIGURED');
    const attachmentId = stringField(record, ['attachmentId', 'AttachmentId', 'id', 'Id']);
    const leadAttachmentId = stringField(record, ['leadAttachmentId', 'LeadAttachmentId']);
    const accountAttachmentId = stringField(record, ['accountAttachmentId', 'AccountAttachmentId']);
    const remoteAccountId = stringField(record, ['remoteAccountId', 'accountId', 'AccountId']);
    const remoteContactId = stringField(record, ['remoteContactId', 'contactId', 'ContactId']);
    const remoteOpportunityId = stringField(record, ['remoteOpportunityId', 'opportunityId', 'OpportunityId']);
    if (attachmentId !== input.providerRecordId || leadAttachmentId !== input.expected.leadAttachmentId || accountAttachmentId !== input.expected.accountAttachmentId || remoteAccountId !== input.expected.remoteAccountId || remoteContactId !== input.expected.remoteContactId || remoteOpportunityId !== input.expected.remoteOpportunityId) throw new Error('SALESFORCE_DOCUMENT_READBACK_MISMATCH');
    this.assertCorrelation(record, input.request);
    return { ...this.attestation(input.request, attachmentId), attachmentId, leadAttachmentId, accountAttachmentId, remoteAccountId, remoteContactId, remoteOpportunityId };
  }
}

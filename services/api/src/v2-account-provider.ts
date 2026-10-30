import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { ActionRequest, CrmLead } from './types.js';

const id = z.string().uuid();
const opaque = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/u);
const code = z.string().regex(/^\d{4,8}$/u);

export const v2OtpVerificationSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('otp.verify'),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  leadId: id,
  challengeId: id,
  code,
}).strict();

export type V2OtpVerification = z.infer<typeof v2OtpVerificationSchema>;

export const v2AccountProviderRequestSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('account.create_or_link'),
  providerType: z.enum(['salesforce_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  leadId: id,
  actionId: id,
  catalogVersionId: id,
  actionKey: opaque,
  actionRevision: z.number().int().positive(),
  idempotencyKey: opaque,
  opaqueReference: opaque,
  payloadRef: id,
  leadExternalId: opaque,
  contactConsent: z.literal(true),
  explicitConfirmation: z.literal(true),
  otpVerified: z.literal(true),
  otpChallengeId: id,
}).strict();

export type V2AccountProviderRequest = z.infer<typeof v2AccountProviderRequestSchema>;

export const v2AccountProviderResultSchema = z.object({
  schemaVersion: z.literal(2),
  operation: z.literal('account.create_or_link'),
  providerType: z.enum(['salesforce_sandbox', 'deterministic_mock']),
  tenantId: id,
  sessionId: id,
  opportunityId: id,
  leadId: id,
  actionId: id,
  catalogVersionId: id,
  actionKey: opaque,
  actionRevision: z.number().int().positive(),
  idempotencyKey: opaque,
  remoteAccountId: opaque,
  remoteContactId: opaque,
  remoteOpportunityId: opaque,
  deduplicated: z.boolean(),
  evidenceTier: z.enum(['provider_record_verified', 'mock_verified', 'reconciliation_required']),
}).strict();

export type V2AccountProviderResult = z.infer<typeof v2AccountProviderResultSchema>;

export interface V2OtpChallenge {
  challengeId: string;
  tenantId: string;
  sessionId: string;
  opportunityId: string;
  leadId: string;
  expiresAt: string;
  attemptsRemaining: number;
  deliveryStatus: 'accepted';
}

export type V2OtpVerificationResult =
  | { status: 'verified'; challengeId: string; tenantId: string; sessionId: string; opportunityId: string; leadId: string }
  | { status: 'invalid' | 'expired' | 'locked' | 'already_used' | 'context_mismatch'; challengeId: string; attemptsRemaining: number };

interface ChallengeRecord extends V2OtpChallenge {
  codeDigest: Buffer;
  used: boolean;
}

const digestCode = (secret: string, challengeId: string, value: string): Buffer => createHmac('sha256', secret).update(`${challengeId}:${value}`).digest();

export class V2OtpChallengeService {
  private readonly challenges = new Map<string, ChallengeRecord>();

  public constructor(private readonly secret: string, private readonly ttlMs = 5 * 60_000, private readonly maxAttempts = 5) {
    if (!secret) throw new Error('V2_OTP_SECRET_REQUIRED');
    if (!Number.isInteger(ttlMs) || ttlMs <= 0 || !Number.isInteger(maxAttempts) || maxAttempts <= 0) throw new Error('V2_OTP_POLICY_INVALID');
  }

  public issue(input: { tenantId: string; sessionId: string; opportunityId: string; leadId: string; code: string; now?: Date }): V2OtpChallenge {
    const parsed = v2OtpVerificationSchema.shape.code.parse(input.code);
    const now = input.now ?? new Date();
    const challengeId = randomUUID();
    const challenge: ChallengeRecord = {
      challengeId,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      opportunityId: input.opportunityId,
      leadId: input.leadId,
      expiresAt: new Date(now.getTime() + this.ttlMs).toISOString(),
      attemptsRemaining: this.maxAttempts,
      deliveryStatus: 'accepted',
      codeDigest: digestCode(this.secret, challengeId, parsed),
      used: false,
    };
    this.challenges.set(challengeId, challenge);
    return this.publicChallenge(challenge);
  }

  public verify(input: V2OtpVerification, now = new Date()): V2OtpVerificationResult {
    const request = v2OtpVerificationSchema.parse(input);
    const challenge = this.challenges.get(request.challengeId);
    if (!challenge) return { status: 'context_mismatch', challengeId: request.challengeId, attemptsRemaining: 0 };
    const sameContext = challenge.tenantId === request.tenantId && challenge.sessionId === request.sessionId && challenge.opportunityId === request.opportunityId && challenge.leadId === request.leadId;
    if (!sameContext) return { status: 'context_mismatch', challengeId: challenge.challengeId, attemptsRemaining: challenge.attemptsRemaining };
    if (challenge.used) return { status: 'already_used', challengeId: challenge.challengeId, attemptsRemaining: challenge.attemptsRemaining };
    if (Date.parse(challenge.expiresAt) <= now.getTime()) return { status: 'expired', challengeId: challenge.challengeId, attemptsRemaining: challenge.attemptsRemaining };
    if (challenge.attemptsRemaining <= 0) return { status: 'locked', challengeId: challenge.challengeId, attemptsRemaining: 0 };
    const candidate = digestCode(this.secret, challenge.challengeId, request.code);
    if (candidate.length !== challenge.codeDigest.length || !timingSafeEqual(candidate, challenge.codeDigest)) {
      challenge.attemptsRemaining -= 1;
      return { status: challenge.attemptsRemaining === 0 ? 'locked' : 'invalid', challengeId: challenge.challengeId, attemptsRemaining: challenge.attemptsRemaining };
    }
    challenge.used = true;
    return { status: 'verified', challengeId: challenge.challengeId, tenantId: challenge.tenantId, sessionId: challenge.sessionId, opportunityId: challenge.opportunityId, leadId: challenge.leadId };
  }

  private publicChallenge(challenge: ChallengeRecord): V2OtpChallenge {
    return { challengeId: challenge.challengeId, tenantId: challenge.tenantId, sessionId: challenge.sessionId, opportunityId: challenge.opportunityId, leadId: challenge.leadId, expiresAt: challenge.expiresAt, attemptsRemaining: challenge.attemptsRemaining, deliveryStatus: challenge.deliveryStatus };
  }
}

export const buildV2AccountProviderRequest = (input: {
  action: ActionRequest;
  lead: CrmLead;
  providerType: 'salesforce_sandbox' | 'deterministic_mock';
  otp: Extract<V2OtpVerificationResult, { status: 'verified' }>;
  explicitConfirmation: boolean;
}): V2AccountProviderRequest => {
  const { action, lead, providerType, otp } = input;
  if (!['approved', 'processing'].includes(action.state)) throw new Error('V2_ACCOUNT_ACTION_NOT_DISPATCHABLE');
  if (action.tenantId !== lead.tenantId || action.sessionId !== lead.sessionId || action.id !== lead.actionId || action.opportunityId !== otp.opportunityId || action.tenantId !== otp.tenantId || action.sessionId !== otp.sessionId || lead.id !== otp.leadId) throw new Error('V2_ACCOUNT_IDENTITY_MISMATCH');
  if (!action.opportunityId || !action.catalogVersionId || !action.actionKey || !action.actionRevision) throw new Error('V2_ACCOUNT_BINDING_INCOMPLETE');
  if (action.payload.contactConsent !== true) throw new Error('V2_ACCOUNT_CONSENT_REQUIRED');
  if (input.explicitConfirmation !== true) throw new Error('V2_ACCOUNT_CONFIRMATION_REQUIRED');
  if (lead.qualificationStatus !== 'qualified') throw new Error('V2_ACCOUNT_QUALIFICATION_REQUIRED');
  if (!lead.leadId || !lead.remoteCrm) throw new Error('V2_ACCOUNT_LEAD_NOT_VERIFIED');
  return v2AccountProviderRequestSchema.parse({
    schemaVersion: 2,
    operation: 'account.create_or_link',
    providerType,
    tenantId: action.tenantId,
    sessionId: action.sessionId,
    opportunityId: action.opportunityId,
    leadId: lead.id,
    actionId: action.id,
    catalogVersionId: action.catalogVersionId,
    actionKey: action.actionKey,
    actionRevision: action.actionRevision,
    idempotencyKey: action.idempotencyKey,
    opaqueReference: action.opaqueReference,
    payloadRef: lead.id,
    leadExternalId: lead.leadId,
    contactConsent: true,
    explicitConfirmation: input.explicitConfirmation,
    otpVerified: true,
    otpChallengeId: otp.challengeId,
  });
};

export interface V2AccountProviderValidation {
  accepted: boolean;
  stageCompletionEligible: boolean;
  status: 'provider_record_verified' | 'mock_verified' | 'reconciliation_required';
  reasons: string[];
}

export const validateV2AccountProviderResult = (request: V2AccountProviderRequest, resultInput: unknown): V2AccountProviderValidation => {
  const parsed = v2AccountProviderResultSchema.safeParse(resultInput);
  if (!parsed.success) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['result_invalid'] };
  const result = parsed.data;
  const mismatches = (['tenantId', 'sessionId', 'opportunityId', 'leadId', 'actionId', 'catalogVersionId', 'actionKey', 'actionRevision', 'idempotencyKey', 'operation'] as const).filter((field) => result[field] !== request[field]);
  if (mismatches.length) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: mismatches.map((field) => `${field}_mismatch`) };
  if (result.providerType !== request.providerType) return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['provider_type_mismatch'] };
  if (result.evidenceTier === 'reconciliation_required') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['provider_evidence_incomplete'] };
  if (request.providerType === 'deterministic_mock' && result.evidenceTier !== 'mock_verified') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['mock_evidence_tier_mismatch'] };
  if (request.providerType === 'salesforce_sandbox' && result.evidenceTier !== 'provider_record_verified') return { accepted: false, stageCompletionEligible: false, status: 'reconciliation_required', reasons: ['sandbox_evidence_tier_mismatch'] };
  return { accepted: true, stageCompletionEligible: true, status: result.evidenceTier, reasons: result.deduplicated ? ['deduplicated'] : [] };
};

export class DeterministicV2AccountProvider {
  private readonly results = new Map<string, V2AccountProviderResult>();

  public execute(requestInput: V2AccountProviderRequest): V2AccountProviderResult {
    const request = v2AccountProviderRequestSchema.parse(requestInput);
    const key = `${request.tenantId}:${request.idempotencyKey}`;
    const existing = this.results.get(key);
    if (existing) return { ...existing, deduplicated: true };
    const suffix = createHmac('sha256', 'v2-account-mock').update(request.idempotencyKey).digest('hex').slice(0, 20);
    const result = v2AccountProviderResultSchema.parse({
      schemaVersion: request.schemaVersion,
      operation: request.operation,
      providerType: request.providerType,
      tenantId: request.tenantId,
      sessionId: request.sessionId,
      opportunityId: request.opportunityId,
      leadId: request.leadId,
      actionId: request.actionId,
      catalogVersionId: request.catalogVersionId,
      actionKey: request.actionKey,
      actionRevision: request.actionRevision,
      idempotencyKey: request.idempotencyKey,
      remoteAccountId: `mock-account-${suffix}`,
      remoteContactId: `mock-contact-${suffix}`,
      remoteOpportunityId: `mock-opportunity-${suffix}`,
      deduplicated: false,
      evidenceTier: 'mock_verified',
    });
    this.results.set(key, result);
    return result;
  }
}

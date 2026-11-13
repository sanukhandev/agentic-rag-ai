import type { ModelCandidate, ModelGateway, ModelTurnEnvelope } from '../contracts.js';

/** Private Python P4 endpoint. Node owns authorization and evidence validation. */
export class HttpP4ModelGateway implements ModelGateway {
  constructor(private readonly baseUrl: string, private readonly serviceKey: string,
    private readonly timeoutMs = 60_000) {
    if (!/^https?:\/\//u.test(baseUrl) || !serviceKey || timeoutMs < 1000 || timeoutMs > 180_000) {
      throw new Error('P4 requires a private Python URL, service key and bounded timeout');
    }
  }

  async runTurn(envelope: ModelTurnEnvelope, signal: AbortSignal): Promise<ModelCandidate> {
    const deadline = AbortSignal.timeout(Math.min(this.timeoutMs, envelope.limits.deadlineMs));
    const combined = AbortSignal.any([signal, deadline]);
    const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}/internal/conversation/turn`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-service-key': this.serviceKey },
      body: JSON.stringify(envelope),
      signal: combined,
    });
    if (!response.ok) throw new Error('P4_MODEL_UNAVAILABLE');
    const raw: unknown = await response.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('P4_MODEL_INVALID');
    const payload = raw as Record<string, unknown>;
    if (!payload.candidate || typeof payload.candidate !== 'object' || Array.isArray(payload.candidate)
      || !Array.isArray(payload.evidenceReceipts)
      || !Number.isSafeInteger(payload.modelCalls) || (payload.modelCalls as number) < 1
      || (payload.modelCalls as number) > envelope.limits.maxModelCalls
      || !Number.isSafeInteger(payload.toolCalls) || (payload.toolCalls as number) < 0
      || (payload.toolCalls as number) > envelope.limits.maxToolCalls
      || !Number.isSafeInteger(payload.toolRounds) || (payload.toolRounds as number) < 0
      || (payload.toolRounds as number) > envelope.limits.maxToolRounds) throw new Error('P4_MODEL_INVALID');
    const candidate = payload.candidate as Record<string, unknown>;
    if (!Array.isArray(candidate.claimSupports)
      || payload.evidenceReceipts.length > 24
      || payload.evidenceReceipts.some(row => !row || typeof row !== 'object'
        || typeof row.citationId !== 'string' || typeof row.receipt !== 'string')) {
      throw new Error('P4_MODEL_INVALID');
    }
    return { ...candidate, evidenceReceipts: payload.evidenceReceipts } as unknown as ModelCandidate;
  }
}

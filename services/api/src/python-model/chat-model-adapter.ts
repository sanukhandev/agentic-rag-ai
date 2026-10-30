import { randomUUID } from 'node:crypto';
import type { ChatModel, ModelDraft, ModelEvidence, QueryNormalizationInput } from '../model.js';

type DraftInput = Parameters<ChatModel['draft']>[0];
type ComposeInput = Parameters<NonNullable<ChatModel['compose']>>[0];
type ModelGatewayResult = {
  answer: string;
  citationIds: string[];
  nextQuestion: string | null;
  nextMove: string;
  primaryGoalKey: string | null;
  proposedToolKey: string | null;
  turnCategory: string;
  confidenceBand: string;
};

const bounded = (value: string, max: number): string => value.slice(0, max);
const maxEvidence = 12;

export class PythonChatModelAdapter implements ChatModel {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly timeoutMs = 90_000,
  ) {
    if (!/^https?:\/\//u.test(baseUrl) || !serviceKey || timeoutMs < 1_000 || timeoutMs > 180_000) {
      throw new Error('Python model gateway requires a valid private URL, service key and bounded timeout.');
    }
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    // One HTTP request only: Python OpenAI SDK owns the initial + three transient retries.
    // No duplicate outer retries in Node.
    const response = await fetch(`${this.baseUrl.replace(/\/$/u, '')}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-service-key': this.serviceKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error('MODEL_UNAVAILABLE');
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('MODEL_INVALID_RESPONSE');
    return payload as T;
  }

  private async generate(input: DraftInput | ComposeInput, responseMode: string): Promise<ModelDraft> {
    const evidence = input.evidence.slice(0, maxEvidence).map(({ citation, content }: ModelEvidence) => ({
      citationId: citation.chunkId,
      content: bounded(content, 3_600),
    }));
    const context: NonNullable<DraftInput['followUpContext']> = input.followUpContext ?? {
      leadCaptured: false,
      primaryIntentKey: null,
    };
    const persona = input.persona;
    const result = await this.request<ModelGatewayResult>('/internal/v1/model/plan', {
      requestId: randomUUID(),
      message: bounded(input.maskedMessage, 5_000),
      conversationSummary: bounded(context.conversationSummary ?? '', 4_000),
      personaName: bounded(persona?.name ?? input.personaName, 150),
      responseMode,
      context: {
        primaryBusinessGoalKey: context.primaryIntentKey ?? null,
        workflowStatus: context.workflowStatus ?? null,
        pendingRequirement: context.nextRequirement ?? null,
        capturedFacts: context.capturedSlots ?? {},
        recentTurns: (input.conversation ?? []).slice(-8).map(t => ({
          role: t.role, content: bounded(t.content, 1_000),
        })),
        language: persona?.permittedLanguages?.[0] ?? 'en',
      },
      catalog: {
        // This adapter remains a compatibility shim until the new catalog-v2
        // planner service binds the published full goal and tool allowlists.
        businessGoalKeys: context.primaryIntentKey ? [context.primaryIntentKey] : [],
        availableToolKeys: [],
      },
      evidence,
    });
    if (typeof result.answer !== 'string' || !result.answer.trim() || !Array.isArray(result.citationIds)) {
      throw new Error('MODEL_INVALID_RESPONSE');
    }
    const allowedCitationIds = new Set(evidence.map(row => row.citationId));
    const approved = result.citationIds.filter(id => typeof id === 'string' && allowedCitationIds.has(id));
    // Never turn planner tool suggestions into a business action in this adapter:
    // the future Node catalog-v2 action gate must independently authorize them.
    return { answer: bounded(result.answer.trim(), 12_000), citationIds: approved, proposedIntent: null };
  }

  async draft(input: DraftInput): Promise<ModelDraft> {
    return this.generate(input, input.followUpContext?.responseMode ?? 'dialogue');
  }

  async compose(input: ComposeInput): Promise<ModelDraft> {
    return this.generate(input, input.followUpContext?.responseMode ?? 'compose');
  }

  async normalizeQuery(input: QueryNormalizationInput): Promise<string | null> {
    const result = await this.request<{ normalizedQuery?: unknown }>('/internal/v1/model/normalize', {
      requestId: randomUUID(),
      message: bounded(input.maskedMessage, 4_000),
      conversationSummary: bounded((input.conversation ?? []).slice(-6).map(x => x.content).join('\n'), 2_000),
      catalog: {
        allowedIntentKeys: input.catalog.intents.map(row => row.intentKey).slice(0, 100),
        selectedIntentKey: input.selectedIntentKey ?? null,
      },
    });
    return typeof result.normalizedQuery === 'string' ? bounded(result.normalizedQuery, 4_000) : null;
  }
}

export const pythonChatModelFromEnv = (env: NodeJS.ProcessEnv = process.env): PythonChatModelAdapter | undefined => {
  const provider = env.CHAT_MODEL_PROVIDER;
  if (provider !== 'python-gpt') return undefined;
  const baseUrl = env.PYTHON_MODEL_URL;
  const key = env.MODEL_GATEWAY_SERVICE_KEY;
  if (!baseUrl || !key) throw new Error('python-gpt requires PYTHON_MODEL_URL and MODEL_GATEWAY_SERVICE_KEY.');
  return new PythonChatModelAdapter(baseUrl, key, Number(env.PYTHON_MODEL_TIMEOUT_MS ?? 90_000));
};

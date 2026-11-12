import { assertExternalEndpoint } from './runtime-security.js';

const MAX_EMBEDDING_ATTEMPTS = 4;
const MAX_RETRY_DELAY_MS = 30_000;
const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000;

const retryDelayMs = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : 1_000 * (2 ** (attempt - 1));
  return Math.min(MAX_RETRY_DELAY_MS, delay + Math.floor(Math.random() * 100));
};

const retryableStatus = (status: number): boolean => status === 408 || status === 409 || status === 429 || status >= 500;

const requestEmbeddingBatch = async (options: {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  texts: readonly string[];
  dimension: number;
  provider: string;
}): Promise<number[][]> => {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_EMBEDDING_ATTEMPTS; attempt += 1) {
    try {
      const currentResponse = await fetch(options.url, { method: 'POST', headers: options.headers, body: JSON.stringify(options.body), signal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS) });
      response = currentResponse;
      if (currentResponse.ok || !retryableStatus(currentResponse.status) || attempt === MAX_EMBEDDING_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(currentResponse, attempt)));
    } catch (error) {
      lastError = error;
      if (attempt === MAX_EMBEDDING_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(MAX_RETRY_DELAY_MS, 1_000 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 100))));
    }
  }
  if (!response && lastError) throw lastError;
  if (!response || !response.ok) throw new Error(`${options.provider} embedding request failed with status ${response?.status ?? 'unknown'}.`);
  const body = await response.json() as { data?: Array<{ index?: number; embedding?: unknown }> };
  const data = body.data;
  if (!Array.isArray(data) || data.length !== options.texts.length) throw new Error(`${options.provider} embedding response did not match the requested batch.`);
  const vectors = options.texts.map((_, index) => data.find((item) => item.index === index)?.embedding ?? data[index]?.embedding);
  if (vectors.some((vector) => !Array.isArray(vector) || vector.length !== options.dimension || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) throw new Error(`${options.provider} embedding response did not match the configured dimension.`);
  return vectors as number[][];
};

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch?(texts: readonly string[]): Promise<number[][]>;
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  constructor(readonly dimension = 8) {
    if (!Number.isInteger(dimension) || dimension < 1) throw new Error('Deterministic embedding dimension must be a positive integer.');
    this.model = `deterministic-demo-${dimension}d-v1`;
  }
  async embed(text: string): Promise<number[]> {
    const { embedText } = await import('./knowledge.js');
    return embedText(text, this.dimension);
  }
}

export class AzureEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  constructor(private readonly endpoint: string, private readonly deployment: string, private readonly apiKey: string, private readonly apiVersion: string, dimension: number) {
    assertExternalEndpoint(endpoint, 'Azure embedding');
    this.dimension = dimension;
  }

  get model(): string { return this.deployment; }

  async embed(text: string): Promise<number[]> {
    const vectors = await this.embedBatch([text]);
    const vector = vectors[0];
    if (!vector) throw new Error('Azure embedding response did not include the requested vector.');
    return vector;
  }

  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.endpoint || !this.deployment || !this.apiKey || !this.apiVersion) throw new Error('Azure embedding provider is not configured.');
    const endpoint = this.endpoint.replace(/\/$/, '');
    const v1 = /\/openai\/v1$/i.test(endpoint);
    const url = v1
      ? `${endpoint}/embeddings`
      : `${endpoint}/openai/deployments/${encodeURIComponent(this.deployment)}/embeddings?api-version=${encodeURIComponent(this.apiVersion)}`;
    const requestBody = v1 ? { model: this.deployment, input: texts, dimensions: this.dimension } : { input: texts, dimensions: this.dimension };
    return requestEmbeddingBatch({ url, headers: { 'content-type': 'application/json', 'api-key': this.apiKey }, body: requestBody, texts, dimension: this.dimension, provider: 'Azure' });
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly endpoint: string, readonly model: string, private readonly apiKey: string, readonly dimension: number) {
    assertExternalEndpoint(endpoint, 'OpenAI embedding');
    if (!Number.isInteger(dimension) || dimension < 1) throw new Error('OpenAI embedding dimension must be a positive integer.');
  }

  async embed(text: string): Promise<number[]> {
    const vectors = await this.embedBatch([text]);
    const vector = vectors[0];
    if (!vector) throw new Error('OpenAI embedding response did not include the requested vector.');
    return vector;
  }

  async embedBatch(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (!this.endpoint || !this.model || !this.apiKey) throw new Error('OpenAI embedding provider is not configured.');
    const endpoint = this.endpoint.replace(/\/$/u, '');
    return requestEmbeddingBatch({
      url: `${endpoint}/embeddings`,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: { model: this.model, input: texts, dimensions: this.dimension },
      texts,
      dimension: this.dimension,
      provider: 'OpenAI',
    });
  }
}

export const embeddingProviderFromEnv = (env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | undefined => {
  const provider = (env.EMBEDDING_PROVIDER || env.AI_PROVIDER || 'azure').trim().toLowerCase();
  const dimension = Number(env.OPENAI_EMBEDDING_DIMENSION || env.AZURE_AI_EMBEDDING_DIMENSION || 1536);
  if (!Number.isInteger(dimension) || dimension < 1) throw new Error('Embedding dimension must be a positive integer.');
  if (provider === 'openai') {
    const endpoint = env.OPENAI_EMBEDDING_BASE_URL || env.AI_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const model = env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-large';
    const apiKey = env.OPENAI_EMBEDDING_API_KEY || env.OPENAI_API_KEY || env.AI_API_KEY || '';
    return endpoint && model && apiKey ? new OpenAIEmbeddingProvider(endpoint, model, apiKey, dimension) : undefined;
  }
  if (provider === 'azure' && env.AZURE_AI_ENDPOINT && env.AZURE_AI_EMBEDDING_DEPLOYMENT && env.AZURE_AI_API_KEY && env.AZURE_AI_API_VERSION) {
    return new AzureEmbeddingProvider(env.AZURE_AI_ENDPOINT, env.AZURE_AI_EMBEDDING_DEPLOYMENT, env.AZURE_AI_API_KEY, env.AZURE_AI_API_VERSION, dimension);
  }
  return undefined;
};

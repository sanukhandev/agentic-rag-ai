import { assertExternalEndpoint } from './runtime-security.js';

const MAX_EMBEDDING_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 30_000;
const EMBEDDING_REQUEST_TIMEOUT_MS = 60_000;

const retryDelayMs = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get('retry-after');
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN;
  const delay = Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : 1_000 * (2 ** (attempt - 1));
  return Math.min(MAX_RETRY_DELAY_MS, delay);
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
    let response: Response | undefined;
    for (let attempt = 1; attempt <= MAX_EMBEDDING_ATTEMPTS; attempt += 1) {
      response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'api-key': this.apiKey }, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS) });
      if (response.ok || response.status !== 429 || attempt === MAX_EMBEDDING_ATTEMPTS) break;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
    }
    if (!response || !response.ok) throw new Error(`Azure embedding request failed with status ${response?.status ?? 'unknown'}.`);
    const body = await response.json() as { data?: Array<{ index?: number; embedding?: unknown }> };
    const data = body.data;
    if (!Array.isArray(data) || data.length !== texts.length) throw new Error('Azure embedding response did not match the requested batch.');
    const vectors = texts.map((_, index) => data.find((item) => item.index === index)?.embedding ?? data[index]?.embedding);
    if (vectors.some((vector) => !Array.isArray(vector) || vector.length !== this.dimension || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value)))) throw new Error('Azure embedding response did not match the configured dimension.');
    return vectors as number[][];
  }
}

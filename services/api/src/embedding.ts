import { assertExternalEndpoint } from './runtime-security.js';

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimension: number;
  embed(text: string): Promise<number[]>;
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'deterministic-demo-8d-v1';
  readonly dimension = 8;
  async embed(text: string): Promise<number[]> {
    const { embedText } = await import('./knowledge.js');
    return embedText(text);
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
    if (!this.endpoint || !this.deployment || !this.apiKey || !this.apiVersion) throw new Error('Azure embedding provider is not configured.');
    const endpoint = this.endpoint.replace(/\/$/, '');
    const v1 = /\/openai\/v1$/i.test(endpoint);
    const url = v1
      ? `${endpoint}/embeddings`
      : `${endpoint}/openai/deployments/${encodeURIComponent(this.deployment)}/embeddings?api-version=${encodeURIComponent(this.apiVersion)}`;
    const requestBody = v1 ? { model: this.deployment, input: text } : { input: text };
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'api-key': this.apiKey }, body: JSON.stringify(requestBody) });
    if (!response.ok) throw new Error(`Azure embedding request failed with status ${response.status}.`);
    const body = await response.json() as { data?: Array<{ embedding?: unknown }> };
    const vector = body.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length !== this.dimension || vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Azure embedding response did not match the configured dimension.');
    return vector;
  }
}

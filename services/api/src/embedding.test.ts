import { describe, expect, it, vi } from 'vitest';
import { AzureEmbeddingProvider, DeterministicEmbeddingProvider, OpenAIEmbeddingProvider, embeddingProviderFromEnv } from './embedding.js';

describe('Azure embedding adapter', () => {
  it('sends only the supplied text and validates the response dimension', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }));
    const provider = new AzureEmbeddingProvider('https://foundry.example', 'embed-v1', 'server-key', '2026-01-01', 2);
    await expect(provider.embed('masked [EMAIL_1]')).resolves.toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledWith('https://foundry.example/openai/deployments/embed-v1/embeddings?api-version=2026-01-01', expect.objectContaining({ method: 'POST', body: JSON.stringify({ input: ['masked [EMAIL_1]'], dimensions: 2 }), signal: expect.any(AbortSignal) }));
    fetchMock.mockRestore();
  });

  it('uses the Azure OpenAI v1 endpoint with the deployment as model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }));
    const provider = new AzureEmbeddingProvider('https://foundry.example/openai/v1', 'text-embedding-3-small', 'server-key', '2026-01-01', 2);
    await expect(provider.embed('masked [EMAIL_1]')).resolves.toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledWith('https://foundry.example/openai/v1/embeddings', expect.objectContaining({ body: JSON.stringify({ model: 'text-embedding-3-small', input: ['masked [EMAIL_1]'], dimensions: 2 }) }));
    fetchMock.mockRestore();
  });

  it('returns embeddings in input order for a batch response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ index: 1, embedding: [0.3, 0.4] }, { index: 0, embedding: [0.1, 0.2] }] }), { status: 200 }));
    const provider = new AzureEmbeddingProvider('https://foundry.example', 'embed-v1', 'server-key', '2026-01-01', 2);
    await expect(provider.embedBatch?.(['first', 'second'])).resolves.toEqual([[0.1, 0.2], [0.3, 0.4]]);
    fetchMock.mockRestore();
  });

  it('retries a throttled request before succeeding', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }));
    const provider = new AzureEmbeddingProvider('https://foundry.example', 'embed-v1', 'server-key', '2026-01-01', 2);
    await expect(provider.embed('masked [EMAIL_1]')).resolves.toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it('retries a transient provider failure before surfacing an embedding error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }));
    const provider = new AzureEmbeddingProvider('https://foundry.example', 'embed-v1', 'server-key', '2026-01-01', 2);
    await expect(provider.embed('transient failure')).resolves.toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });
});

describe('deterministic embedding adapter', () => {
  it('supports the migrated PostgreSQL vector dimension for credential-free local runs', async () => {
    const provider = new DeterministicEmbeddingProvider(1536);
    await expect(provider.embed('local fallback')).resolves.toHaveLength(1536);
  });
});

describe('OpenAI embedding adapter', () => {
  it('uses the OpenAI-compatible endpoint and bearer authentication', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }));
    const provider = new OpenAIEmbeddingProvider('https://api.openai.com/v1', 'text-embedding-3-large', 'server-key', 2);
    await expect(provider.embed('masked [EMAIL_1]')).resolves.toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/embeddings', expect.objectContaining({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer server-key' },
      body: JSON.stringify({ model: 'text-embedding-3-large', input: ['masked [EMAIL_1]'], dimensions: 2 }),
    }));
    fetchMock.mockRestore();
  });
});

describe('embedding provider configuration', () => {
  it('selects OpenAI embeddings when the active AI provider is OpenAI', () => {
    const provider = embeddingProviderFromEnv({
      AI_PROVIDER: 'openai',
      AI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_API_KEY: 'server-key',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-large',
      OPENAI_EMBEDDING_DIMENSION: '1536',
    });
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider?.model).toBe('text-embedding-3-large');
    expect(provider?.dimension).toBe(1536);
  });

  it('falls back from blank optional OpenAI embedding variables to the active model profile', () => {
    const provider = embeddingProviderFromEnv({
      AI_PROVIDER: 'openai',
      AI_BASE_URL: 'https://api.openai.com/v1',
      OPENAI_API_KEY: 'server-key',
      OPENAI_EMBEDDING_BASE_URL: '',
      OPENAI_EMBEDDING_API_KEY: '',
      OPENAI_EMBEDDING_MODEL: '',
      OPENAI_EMBEDDING_DIMENSION: '',
    });
    expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    expect(provider?.model).toBe('text-embedding-3-large');
    expect(provider?.dimension).toBe(1536);
  });
});

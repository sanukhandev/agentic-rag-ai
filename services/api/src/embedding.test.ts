import { describe, expect, it, vi } from 'vitest';
import { AzureEmbeddingProvider } from './embedding.js';

describe('Azure embedding adapter', () => {
  it('sends only the supplied text and validates the response dimension', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2] }] }), { status: 200 }));
    const provider = new AzureEmbeddingProvider('https://foundry.example', 'embed-v1', 'server-key', '2026-01-01', 2);
    await expect(provider.embed('masked [EMAIL_1]')).resolves.toEqual([0.1, 0.2]);
    expect(fetchMock).toHaveBeenCalledWith('https://foundry.example/openai/deployments/embed-v1/embeddings?api-version=2026-01-01', expect.objectContaining({ method: 'POST', body: JSON.stringify({ input: 'masked [EMAIL_1]' }) }));
    fetchMock.mockRestore();
  });
});

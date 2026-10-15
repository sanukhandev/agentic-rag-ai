import { describe, expect, it, vi } from 'vitest';
import { AzureFoundryModel } from './model.js';

describe('Azure Foundry model adapter', () => {
  it('sends a masked grounded prompt and validates strict JSON output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ answer: 'Approved answer', citationIds: ['chunk-1'], proposedIntent: null }) } }] }), { status: 200 }));
    const model = new AzureFoundryModel('https://foundry.example', 'gpt-4.1-mini', 'server-key', '2026-01-01');
    await expect(model.draft({ maskedMessage: 'Email [EMAIL_1]', personaName: 'Ava', evidence: [{ citation: { sourceId: 'source', versionId: 'version', chunkId: 'chunk-1', title: 'FAQ', locator: 'section 1' }, content: 'Approved answer' }] })).resolves.toMatchObject({ answer: 'Approved answer', citationIds: ['chunk-1'] });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toMatchObject({ 'api-key': 'server-key' });
    expect(String(request.body)).toContain('[EMAIL_1]');
    expect(String(request.body)).not.toContain('server-key');
    fetchMock.mockRestore();
  });

  it('fails closed on malformed model output', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"unsafe"}' } }] }), { status: 200 }));
    const model = new AzureFoundryModel('https://foundry.example', 'gpt-4.1-mini', 'server-key');
    await expect(model.draft({ maskedMessage: 'question', personaName: 'Ava', evidence: [] })).rejects.toThrow('grounded response contract');
    vi.restoreAllMocks();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PythonChatModelAdapter, pythonChatModelFromEnv } from './chat-model-adapter.js';

afterEach(() => vi.unstubAllGlobals());

describe('PythonChatModelAdapter', () => {
  it('requires private gateway settings when selected', () => {
    expect(() => pythonChatModelFromEnv({ CHAT_MODEL_PROVIDER: 'python-gpt' })).toThrow();
    expect(pythonChatModelFromEnv({ CHAT_MODEL_PROVIDER: 'deterministic' })).toBeUndefined();
  });
  it('sends model planning only to internal gateway without publishing a model tool action', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        answer: 'I can help. What activity will your company carry out?',
        citationIds: ['chunk-1', 'foreign-chunk'],
        proposedToolKey: 'create_lead',
        nextQuestion: 'What activity will your company carry out?',
        nextMove: 'collect_requirement',
        primaryGoalKey: 'anc.setup.new_company',
        turnCategory: 'qualification_requirement',
        confidenceBand: 'high',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new PythonChatModelAdapter('http://model-gateway:8088', 'test-service-key');
    const result = await adapter.draft({
      maskedMessage: 'New company',
      evidence: [{ citation: { chunkId: 'chunk-1' } as never, content: 'Approved service details.' }],
      personaName: 'Advisor',
      followUpContext: { leadCaptured: false, primaryIntentKey: 'anc.setup.new_company' },
    });
    expect(result.proposedIntent).toBeNull();
    expect(result.citationIds).toEqual(['chunk-1']);
    expect(result.answer).toContain('What activity');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as never as [string, RequestInit];
    expect(url).toBe('http://model-gateway:8088/internal/v1/model/plan');
    expect(options.headers).toMatchObject({ 'x-internal-service-key': 'test-service-key' });
  });
  it('fails closed on invalid gateway output', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ answer: '' }) })));
    const adapter = new PythonChatModelAdapter('http://model-gateway:8088', 'key');
    await expect(adapter.draft({ maskedMessage: 'hi', evidence: [], personaName: 'Advisor' })).rejects.toThrow('MODEL_INVALID_RESPONSE');
  });
});

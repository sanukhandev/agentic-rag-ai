import { describe, expect, it, vi } from 'vitest';
import { sendP6CandidateTurn } from './p6-candidate-client';

describe('P6 candidate opt-in transport', () => {
  it('sends the token only in a protected header and returns compatible chat data', async () => {
    const transport = vi.fn(async (_url: string, _init?: RequestInit) =>
      ({ ok: true, json: async () => ({
        engine: 'p6-candidate', answer: 'I can help.', grounded: false, citations: [],
      }) })) as unknown as typeof fetch;
    const result = await sendP6CandidateTurn('', 'session-1', 'private-token', 'turn-1', 'Hello', transport);
    expect(result).toMatchObject({ answer: 'I can help.', citations: [], grounded: false });
    const [path, options] = vi.mocked(transport).mock.calls[0]!;
    expect(String(path)).toBe('/api/v1/chat/candidate/turn');
    expect(options?.headers).toMatchObject({ 'x-agentic-session-token': 'private-token' });
    expect(options?.body).not.toContain('private-token');
  });

  it('fails closed and never silently sends a P6 turn to V2 chat', async () => {
    const transport = vi.fn(async () => ({
      ok: false, json: async () => ({ error: { code: 'P6_FRESH_SESSION_REQUIRED' } }),
    })) as unknown as typeof fetch;
    await expect(sendP6CandidateTurn('/', 's', 'token', 't', 'question', transport))
      .rejects.toThrow('new P6 preview conversation');
    expect(vi.mocked(transport).mock.calls).toHaveLength(1);
  });

  it('rejects malformed candidate API output', async () => {
    const transport = vi.fn(async () => ({
      ok: true, json: async () => ({ answer: 'missing engine', citations: [] }),
    })) as unknown as typeof fetch;
    await expect(sendP6CandidateTurn('', 's', 'token', 't', 'question', transport))
      .rejects.toThrow('Invalid P6 candidate response');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { AIProjectClient } from '@azure/ai-projects';
import { FoundryAgentClient } from './agent-client.js';

const openAIClient = {
  conversations: { create: vi.fn().mockResolvedValue({ id: 'conversation-1' }) },
  responses: { create: vi.fn().mockResolvedValue({ output_text: 'A live answer.' }) },
};

const journeyTool = { type: 'function', name: 'get_journey_state', strict: true, parameters: { type: 'object', properties: {}, required: [], additionalProperties: false } };

const projectClient = (tools: unknown[]) => ({
  agents: {
    getVersion: vi.fn().mockResolvedValue({ version: '3', definition: { tools } }),
    get: vi.fn().mockResolvedValue({ agent_endpoint: { version_selector: { version_selection_rules: [{ agent_version: '3', traffic_percentage: 100 }] } } }),
  },
}) as unknown as AIProjectClient;

describe('FoundryAgentClient', () => {
  it('returns output_text after verifying the expected version', async () => {
    const client = new FoundryAgentClient({ endpoint: 'https://foundry.example', agentName: 'agentic-rag-core-dev', expectedVersion: '3', projectClient: projectClient([]), openAIClient: openAIClient as never });
    await expect(client.respond({ message: 'Hi' })).resolves.toMatchObject({ answer: 'A live answer.', conversationId: 'conversation-1', traces: [{ toolCalls: [] }] });
  });

  it('executes function_call items and resumes the same conversation with function_call_output', async () => {
    const responses = {
      create: vi.fn()
        .mockResolvedValueOnce({ id: 'response-1', output: [{ type: 'function_call', call_id: 'call-1', name: 'get_journey_state', arguments: '{}' }], output_text: '' })
        .mockResolvedValueOnce({ id: 'response-2', output: [], output_text: 'The journey is ready.' }),
    };
    const client = new FoundryAgentClient({ endpoint: 'https://foundry.example', agentName: 'agentic-rag-core-dev', expectedVersion: '3', projectClient: projectClient([journeyTool]), openAIClient: { conversations: { create: vi.fn().mockResolvedValue({ id: 'conversation-1' }) }, responses } as never, allowApplicationTools: true, requireServingVersion: false, invocationVersion: '3' });
    const result = await client.respond({ message: 'What is next?' }, { onToolCalls: async (calls) => [{ callId: calls[0]!.callId, output: { name: calls[0]!.name, ok: true, data: { currentStage: 'lead_generation' } } }] });
    expect(result.answer).toBe('The journey is ready.');
    expect(responses.create).toHaveBeenCalledTimes(2);
    expect(responses.create.mock.calls[1]?.[0]).toMatchObject({ conversation: 'conversation-1', input: [{ type: 'function_call_output', call_id: 'call-1' }] });
    expect(responses.create.mock.calls[1]?.[1]).toMatchObject({ body: { agent_reference: { name: 'agentic-rag-core-dev', version: '3' } } });
  });

  it('fails closed when hosted OpenAPI tools are attached', async () => {
    const client = new FoundryAgentClient({ endpoint: 'https://foundry.example', agentName: 'agentic-rag-core-dev', expectedVersion: '3', projectClient: projectClient([{ type: 'openapi' }]), openAIClient: openAIClient as never });
    await expect(client.respond({ message: 'Hi' })).rejects.toMatchObject({ kind: 'configuration' });
  });
});

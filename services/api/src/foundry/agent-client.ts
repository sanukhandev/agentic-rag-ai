import { AIProjectClient } from '@azure/ai-projects';
import { AzureCliCredential } from '@azure/identity';
import { foundryFunctionDefinitions, type FoundryToolCall, type FoundryToolOutput } from '../foundry-functions.js';

export class FoundryAgentError extends Error {
  constructor(public readonly kind: 'configuration' | 'authentication' | 'upstream' | 'protocol', message: string) {
    super(message);
    this.name = 'FoundryAgentError';
  }
}

type OpenAIClient = ReturnType<AIProjectClient['getOpenAIClient']>;
type AgentVersionWithDefinition = { version?: unknown; definition?: { tools?: unknown } };
type AgentWithEndpoint = { agent_endpoint?: { version_selector?: { version_selection_rules?: unknown } } };

export interface FoundryResponseTrace {
  responseId: string;
  toolCalls: Array<{ callId: string; name: string }>;
}

export interface FoundryAgentResponse {
  answer: string;
  conversationId: string;
  traces: FoundryResponseTrace[];
}

export interface FoundryAgentClientOptions {
  endpoint: string;
  agentName: string;
  expectedVersion: string;
  projectClient?: AIProjectClient;
  openAIClient?: OpenAIClient;
  /** Candidate agents can be invoked explicitly while the serving selector stays pinned. */
  invocationVersion?: string;
  requireServingVersion?: boolean;
  allowApplicationTools?: boolean;
  maxExecutionMs?: number;
}

export class FoundryAgentClient {
  private versionCheck: Promise<void> | undefined;

  constructor(private readonly options: FoundryAgentClientOptions) {
  }

  async respond(input: { message: string; conversationId?: string }, options: { onToolCalls?: (calls: FoundryToolCall[]) => Promise<FoundryToolOutput[]> } = {}): Promise<FoundryAgentResponse> {
    this.versionCheck ??= this.verifyVersion();
    await this.versionCheck;
    const client = this.options.openAIClient;
    if (!client) throw new FoundryAgentError('configuration', 'Foundry OpenAI client is not configured.');
    const startedAt = Date.now();
    const budgetMs = this.options.maxExecutionMs ?? 30_000;
    const withinBudget = (): boolean => Date.now() - startedAt <= budgetMs;
    let conversationId = input.conversationId;
    if (!conversationId) {
      try {
        conversationId = (await client.conversations.create()).id;
      } catch {
        throw new FoundryAgentError('upstream', 'Foundry conversation creation failed.');
      }
    }
    try {
      if (!withinBudget()) throw new FoundryAgentError('protocol', 'Foundry function-calling budget exceeded.');
      let response = await this.createResponse(client, conversationId, input.message);
      const traces: FoundryResponseTrace[] = [];
      for (let round = 0; round < 3; round += 1) {
        if (!withinBudget()) throw new FoundryAgentError('protocol', 'Foundry function-calling budget exceeded.');
        const output = response as unknown as { id?: unknown; output?: unknown; output_text?: unknown };
        const responseId = typeof output.id === 'string' ? output.id : 'unknown';
        const calls = Array.isArray(output.output)
          ? output.output.filter((item): item is { type: 'function_call'; call_id: string; name: string; arguments: string } => typeof item === 'object' && item !== null && (item as { type?: unknown }).type === 'function_call' && typeof (item as { call_id?: unknown }).call_id === 'string' && typeof (item as { name?: unknown }).name === 'string' && typeof (item as { arguments?: unknown }).arguments === 'string').map((item) => ({ callId: item.call_id, name: item.name, arguments: item.arguments }))
          : [];
        traces.push({ responseId, toolCalls: calls.map(({ callId, name }) => ({ callId, name })) });
        if (calls.length === 0) {
          const answer = typeof output.output_text === 'string' ? output.output_text.trim() : '';
          if (!answer) throw new FoundryAgentError('protocol', 'Foundry returned no assistant text.');
          return { answer, conversationId, traces };
        }
        if (!options.onToolCalls) throw new FoundryAgentError('protocol', 'Foundry requested a function but no trusted dispatcher is configured.');
        if (calls.length > 5) throw new FoundryAgentError('protocol', 'Foundry requested too many functions for one customer turn.');
        const results = await options.onToolCalls(calls);
        if (!withinBudget()) throw new FoundryAgentError('protocol', 'Foundry function-calling budget exceeded.');
        response = await this.createResponse(client, conversationId, results.map((result) => ({ type: 'function_call_output', call_id: result.callId, output: JSON.stringify(result.output) })));
      }
      throw new FoundryAgentError('protocol', 'Foundry exceeded the function-calling round limit.');
    } catch (error) {
      if (error instanceof FoundryAgentError) throw error;
      throw new FoundryAgentError('upstream', 'Foundry response generation failed.');
    }
  }

  private async createResponse(client: OpenAIClient, conversationId: string, input: unknown): Promise<unknown> {
    const body = { conversation: conversationId, input };
    const agentReference = this.options.invocationVersion ? { name: this.options.agentName, type: 'agent_reference' as const, version: this.options.invocationVersion } : undefined;
    return agentReference
      ? client.responses.create(body as never, { body: { agent_reference: agentReference } } as never)
      : client.responses.create(body as never);
  }

  private async verifyVersion(): Promise<void> {
    if (!this.options.expectedVersion.trim()) throw new FoundryAgentError('configuration', 'FOUNDRY_EXPECTED_AGENT_VERSION is required.');
    if (!this.options.projectClient) throw new FoundryAgentError('configuration', 'Foundry project client is not configured.');
    try {
      const [version, agent] = await Promise.all([
        this.options.projectClient.agents.getVersion(this.options.agentName, this.options.expectedVersion),
        this.options.projectClient.agents.get(this.options.agentName),
      ]);
      if (String(version.version) !== this.options.expectedVersion) throw new FoundryAgentError('configuration', 'Foundry agent version did not match the expected version.');
      const tools = (version as AgentVersionWithDefinition).definition?.tools;
      if (!Array.isArray(tools)) throw new FoundryAgentError('configuration', 'The configured Foundry agent did not return a verifiable tool inventory.');
      if (!this.options.allowApplicationTools && tools.length > 0) throw new FoundryAgentError('configuration', 'The configured Foundry agent has hosted tools attached; remove or independently contain them before enabling customer chat.');
      if (this.options.allowApplicationTools) this.verifyApplicationTools(tools);
      const rules = (agent as AgentWithEndpoint).agent_endpoint?.version_selector?.version_selection_rules;
      const rule = Array.isArray(rules) && rules.length === 1 && typeof rules[0] === 'object' && rules[0] !== null ? rules[0] as { agent_version?: unknown; traffic_percentage?: unknown } : null;
      if (this.options.requireServingVersion !== false && (!rule || rule.agent_version !== this.options.expectedVersion || rule.traffic_percentage !== 100)) throw new FoundryAgentError('configuration', 'The Foundry endpoint is not pinned 100% to the expected agent version.');
    } catch (error) {
      if (error instanceof FoundryAgentError) throw error;
      throw new FoundryAgentError('authentication', 'The expected Foundry agent version is unavailable or unauthorized.');
    }
  }

  private verifyApplicationTools(tools: unknown[]): void {
    const approved = new Map(foundryFunctionDefinitions.map((definition) => [definition.name, definition]));
    for (const tool of tools) {
      if (typeof tool !== 'object' || tool === null || (tool as { type?: unknown }).type !== 'function') throw new FoundryAgentError('configuration', 'The candidate Foundry agent contains an unapproved non-function tool.');
      const candidate = tool as { name?: unknown; strict?: unknown; parameters?: unknown };
      const name = typeof candidate.name === 'string' ? candidate.name : '';
      const expected = approved.get(name as never);
      if (!expected || candidate.strict !== true || JSON.stringify(candidate.parameters) !== JSON.stringify(expected.parameters)) throw new FoundryAgentError('configuration', 'The candidate Foundry agent contains an unapproved function definition.');
    }
  }
}

export const foundryAgentClientFromEnv = (nodeEnv: string): { client: FoundryAgentClient; agentName: string; agentVersion: string } | undefined => {
  if ((process.env.CHAT_MODEL_PROVIDER ?? '').trim() !== 'foundry-agent') return undefined;
  if (nodeEnv === 'production') throw new FoundryAgentError('configuration', 'Azure CLI Foundry authentication is development-only.');
  const endpoint = process.env.FOUNDRY_PROJECT_ENDPOINT?.trim();
  const agentName = process.env.FOUNDRY_AGENT_NAME?.trim() || 'agentic-rag-core-dev';
  const agentVersion = process.env.FOUNDRY_EXPECTED_AGENT_VERSION?.trim();
  if (!endpoint || !endpoint.startsWith('https://')) throw new FoundryAgentError('configuration', 'FOUNDRY_PROJECT_ENDPOINT must be an HTTPS project endpoint.');
  if (process.env.FOUNDRY_AUTH_MODE !== 'azure-cli') throw new FoundryAgentError('configuration', 'FOUNDRY_AUTH_MODE must be azure-cli.');
  if (process.env.FOUNDRY_HOSTED_TOOLS_ENABLED !== 'false') throw new FoundryAgentError('configuration', 'FOUNDRY_HOSTED_TOOLS_ENABLED must be false for the local chat runtime.');
  if (!agentVersion) throw new FoundryAgentError('configuration', 'FOUNDRY_EXPECTED_AGENT_VERSION is required.');
  const projectClient = new AIProjectClient(endpoint, new AzureCliCredential());
  const openAIClient = projectClient.getOpenAIClient({ azureConfig: { allowPreview: true, agentName } });
  const candidate = process.env.FOUNDRY_APPLICATION_TOOLS_ENABLED === 'true';
  const invocationVersion = process.env.FOUNDRY_INVOCATION_VERSION?.trim() || undefined;
  const configuredBudget = Number(process.env.FOUNDRY_TOOL_BUDGET_MS ?? 30_000);
  const maxExecutionMs = Number.isFinite(configuredBudget) && configuredBudget > 0 ? configuredBudget : 30_000;
  return { client: new FoundryAgentClient({ endpoint, agentName, expectedVersion: agentVersion, projectClient, openAIClient, allowApplicationTools: candidate, maxExecutionMs, requireServingVersion: process.env.FOUNDRY_REQUIRE_SERVING_VERSION !== 'false', ...(invocationVersion ? { invocationVersion } : {}) }), agentName, agentVersion };
};

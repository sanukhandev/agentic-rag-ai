import type { ReadToolDefinition, TrustedActor } from './contracts.js';

export interface ReadToolContract<Input> {
  readonly definition: ReadToolDefinition;
  readonly parseInput: (value: unknown) => Input;
  readonly authorize: (actor: TrustedActor, input: Input) => Promise<boolean>;
  readonly execute: (actor: TrustedActor, input: Input, signal: AbortSignal) => Promise<unknown>;
}

export interface NodeReadToolResult {
  readonly name: string;
  readonly status: 'ok' | 'forbidden' | 'invalid_input' | 'unavailable';
  readonly data: unknown;
}

/** Only code-reviewed, tenant-scoped READ tools can be registered. */
export class NodeReadToolRegistry {
  private readonly tools = new Map<string, ReadToolContract<unknown>>();

  register<Input>(tool: ReadToolContract<Input>): void {
    const { name } = tool.definition;
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(name) || this.tools.has(name)) {
      throw new Error('Invalid or duplicate read tool registration');
    }
    this.tools.set(name, tool as ReadToolContract<unknown>);
  }

  listDefinitions(): readonly ReadToolDefinition[] {
    return [...this.tools.values()].map(t => t.definition);
  }

  async invoke(actor: TrustedActor, name: string, rawInput: unknown, signal: AbortSignal): Promise<NodeReadToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { name, status: 'forbidden', data: null };
    signal.throwIfAborted();
    let input: unknown;
    try { input = tool.parseInput(rawInput); }
    catch { return { name, status: 'invalid_input', data: null }; }
    try {
      if (!(await tool.authorize(actor, input))) return { name, status: 'forbidden', data: null };
    } catch {
      return { name, status: 'unavailable', data: null };
    }
    try {
      const data = await tool.execute(actor, input, signal);
      signal.throwIfAborted();
      if (JSON.stringify(data)?.length > 200_000) return { name, status: 'unavailable', data: null };
      return { name, status: 'ok', data };
    } catch {
      // Do not leak provider/database errors or PII back to the model.
      return { name, status: 'unavailable', data: null };
    }
  }
}

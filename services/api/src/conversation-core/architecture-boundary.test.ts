import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P8 migration gate: the production conversation entrypoints must not
 * accidentally reconnect to the retired coordinator or V2 gateway.
 * This intentionally checks only entrypoints; legacy admin and lifecycle
 * dependencies must be migrated before their files can be deleted.
 */
const source = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('P8 production conversation architecture boundary', () => {
  const entrypoints = [
    '../index.ts',
    './http/public-app.ts',
    './http/customer-turn.ts',
  ] as const;

  for (const path of entrypoints) {
    it(`${path} does not import a retired conversation runtime`, () => {
      const imports = source(path).match(/(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"][^'"]+['"]/gu) ?? [];
      for (const statement of imports) {
        expect(statement).not.toMatch(/(?:\/conversation\/(?:coordinator|grounding-verifier|response-guard|workflow-bridge)|\/app\.js|v2_contracts|python-model\/contracts)/u);
      }
    });
  }

  it('production server composes the new conversation app', () => {
    const entrypoint = source('../index.ts');
    expect(entrypoint).toContain("from './conversation-core/http/public-app.js'");
    expect(entrypoint).toContain('createConversationApp(');
  });
});

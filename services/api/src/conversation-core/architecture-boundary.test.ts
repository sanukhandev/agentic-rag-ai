import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const coreDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = resolve(coreDirectory, '..');
const source = (path: string): string => readFileSync(path, 'utf8');

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? typescriptFiles(path)
      : entry.isFile() && extname(path) === '.ts' && !path.endsWith('.test.ts') ? [path] : [];
  });
}

/** Inspect static module specifiers, including side-effect imports and re-exports. */
function moduleSpecifiers(code: string): string[] {
  const imports = /\b(?:import|export)\s+(?:[^;'"]*?\s+from\s*)?['"]([^'"]+)['"]/gu;
  return [...code.matchAll(imports)].map(match => match[1]!);
}

const retiredModules = /(?:^|\/)conversation\/(?:coordinator|grounding-verifier|response-guard|workflow-bridge)(?:\.js|\.ts)?$|(?:^|\/)python-model\/contracts(?:\.js|\.ts)?$|(?:^|\/)app(?:\.js|\.ts)?$|v2_contracts/u;

describe('P8 production conversation architecture boundary', () => {
  const entrypoints = [
    resolve(apiDirectory, 'index.ts'),
    join(coreDirectory, 'http/public-app.ts'),
    join(coreDirectory, 'http/customer-turn.ts'),
  ];

  it('composes the new application from the server entrypoint', () => {
    const code = source(entrypoints[0]!);
    expect(code).toContain("from './conversation-core/http/public-app.js'");
    expect(code).toContain('createConversationApp(');
  });

  it('does not import retired conversation modules from any new core module', () => {
    const violations = [...entrypoints, ...typescriptFiles(coreDirectory)].flatMap(file =>
      moduleSpecifiers(source(file))
        .filter(specifier => retiredModules.test(specifier))
        .map(specifier => `${relative(apiDirectory, file)} -> ${specifier}`),
    );
    expect(violations).toEqual([]);
  });

  it('owns catalog validation and integrity inside conversation-core', () => {
    const canonical = source(join(coreDirectory, 'catalog/catalog.ts'));
    expect(canonical).toContain('export const validateBusinessCatalog');
    expect(canonical).toContain('export const businessCatalogVersionRef');
    for (const adapter of ['p5-catalog.ts', 'session-action-authority.ts']) {
      const code = source(join(coreDirectory, 'adapters', adapter));
      expect(moduleSpecifiers(code)).toContain('../catalog/catalog.js');
      expect(moduleSpecifiers(code)).not.toContain('../../conversation/catalog.js');
    }
  });

  it('does not re-register the legacy lifecycle or coordinator on public entrypoints', () => {
    for (const file of entrypoints) {
      const code = source(file);
      expect(code).not.toMatch(/\bregisterLifecycleRoutes\s*\(/u);
      expect(code).not.toMatch(/\bHttpV2ConversationAgent\b/u);
    }
  });
});

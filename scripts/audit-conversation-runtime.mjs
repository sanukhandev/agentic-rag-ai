#!/usr/bin/env node
/**
 * Audits the production Node import graph without loading application code.
 * Does not delete legacy files, touch migrations or modify tenant data.
 *
 * Usage: node scripts/audit-conversation-runtime.mjs [--check]
 * --check exits nonzero if the active Node entrypoint reaches retired runtime modules.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'services/api/src/index.ts');
const forbidden = [
  /^services\/api\/src\/app\.ts$/,
  /^services\/api\/src\/conversation\/(?:coordinator|turn-controller|workflow-bridge|journey-bootstrap|tool-gateway|grounding-verifier)\.ts$/,
  /^services\/api\/src\/routes\/lifecycle\.ts$/,
];
const oldMarkers = [
  /\b(?:V2|v2)[A-Z_-]/,
  /\bcatalogV2\b/,
];
const resolveImport = (from, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const path = resolve(dirname(from), specifier);
  const stem = path.replace(/\.(?:js|mjs|cjs)$/, '');
  for (const candidate of [path, stem + '.ts', stem + '.tsx', stem + '.mts', resolve(stem, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot resolve local import ${specifier} from ${relative(root, from)}`);
};
const queue = [entry], visited = new Set(), edges = [], violations = [], markers = [];
while (queue.length) {
  const file = queue.shift();
  if (visited.has(file)) continue;
  visited.add(file);
  const rel = relative(root, file).replaceAll('\\', '/');
  const source = readFileSync(file, 'utf8');
  if (forbidden.some(pattern => pattern.test(rel))) violations.push(rel);
  if (oldMarkers.some(pattern => pattern.test(source))) markers.push(rel);
  // Includes ordinary static imports, re-exports and literal dynamic imports.
  const imports = /(?:\b(?:import|export)\s+(?:[^'"]*?\s+from\s*)?|\bimport\s*\()\s*['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(imports)) {
    const target = resolveImport(file, match[1]);
    if (!target || !['.ts', '.tsx', '.mts', '.js'].includes(extname(target))) continue;
    edges.push([rel, relative(root, target).replaceAll('\\', '/')]);
    queue.push(target);
  }
}
const report = {
  entrypoint: relative(root, entry).replaceAll('\\', '/'),
  reachableModules: visited.size,
  localEdges: edges.length,
  forbiddenReachable: [...new Set(violations)].sort(),
  legacyNamingReachable: [...new Set(markers)].sort(),
  note: 'Naming markers are migration candidates, not proof of removable code. Inspect usages and protect persisted schemas.',
};
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
if (process.argv.includes('--check') && (violations.length || markers.length)) process.exitCode = 1;

#!/usr/bin/env node
/** Narrow offline tripwire for executable customer-conversation runtime modules.
 * Flags high-risk executable primitives and likely committed secrets. This is
 * not a claim of a completed vulnerability or dependency-provenance audit. */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

export const V2_AUDITED_RUNTIME_FILES = Object.freeze([
  'services/api/src/v2-coordinator.ts',
  'services/api/src/v2-turn-controller.ts',
  'services/api/src/v2-response-guard.ts',
  'services/api/src/v2-evidence.ts',
  'services/api/src/v2-claim-provenance.ts',
  'services/api/src/v2-action-gate.ts',
  'services/api/src/v2-tool-gateway.ts',
  'services/model-gateway/gateway/agent.py',
  'services/model-gateway/gateway/persona_composer.py',
  'services/model-gateway/gateway/v2_contracts.py',
]);

/** Security evidence is a finding to review, never proof of malicious intent. */
export const inspectV2RuntimeSource = (source, path) => {
  const findings = [];
  const rules = [
    ['DYNAMIC_JS_EXECUTION', /\b(?:eval|new\s+Function)\s*\(/u, /\.ts$/u],
    ['NODE_PROCESS_EXECUTION_IMPORT', /(?:from\s*['"](?:node:)?(?:child_process|vm)['"]|require\(['"](?:node:)?(?:child_process|vm)['"]\))/u, /\.ts$/u],
    ['PYTHON_PROCESS_EXECUTION_IMPORT', /^\s*(?:import\s+subprocess|from\s+subprocess\s+import|import\s+pty|from\s+pty\s+import)\b/mu, /\.py$/u],
    ['PYTHON_DYNAMIC_EVAL', /\b(?:eval|exec)\s*\(/u, /\.py$/u],
    ['POSSIBLE_EMBEDDED_SECRET', /\b(?:sk-[a-zA-Z0-9_-]{24,}|ghp_[a-zA-Z0-9]{30,}|AKIA[A-Z0-9]{16})\b/u, /\.(?:ts|py)$/u],
  ];
  for (const [code, pattern, extension] of rules) {
    if (extension.test(path) && pattern.test(source)) findings.push({ path, code });
  }
  return findings;
};

export const auditV2Runtime = async (root, paths = V2_AUDITED_RUNTIME_FILES) => {
  const results = await Promise.all(paths.map(async path => {
    const source = await readFile(join(root, path), 'utf8');
    return inspectV2RuntimeSource(source, path);
  }));
  return results.flat();
};

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const root = resolve(dirname(scriptPath), '..');
  try {
    const findings = await auditV2Runtime(root);
    if (findings.length > 0) {
      for (const finding of findings) console.error(`${finding.path}: ${finding.code}`);
      process.exitCode = 1;
    } else console.log(`V2 runtime static safety tripwire passed (${V2_AUDITED_RUNTIME_FILES.length} files).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'V2_RUNTIME_AUDIT_FAILED');
    process.exitCode = 1;
  }
}

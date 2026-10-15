import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apiCwd = resolve(root, 'services/api');
const port = Number(process.env.SEED_ACCEPTANCE_PORT ?? 4011);
const apiBase = `http://127.0.0.1:${port}`;
let apiProcess;

const run = (command, args, options) => new Promise((resolveRun, reject) => {
  const child = spawn(command, args, options);
  let output = '';
  child.stdout?.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { output += chunk.toString(); });
  child.on('error', reject);
  child.on('close', (code, signal) => code === 0 ? resolveRun(output) : reject(new Error(`${command} exited with ${code ?? signal}:\n${output}`)));
});

const waitForApi = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(`${apiBase}/api/v1/health/live`)).ok) return;
    } catch { /* the child is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('Synthetic tenant acceptance API did not become ready.');
};

try {
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: apiCwd,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), JWT_SECRET: 'seed-acceptance-jwt-secret', PII_VAULT_KEY: 'seed-acceptance-pii-vault-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForApi();
  const output = await run(process.execPath, [resolve(root, 'scripts/seed-local.mjs')], { cwd: root, env: { ...process.env, SEED_API_URL: apiBase }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.match(output, /idempotent mock workflow/);
  console.log(`Local tenant A/B acceptance passed against ${apiBase}.`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  assert.fail(detail);
} finally {
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
}

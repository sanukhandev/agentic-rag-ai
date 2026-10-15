import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const apiCwd = resolve(root, 'services/api');
const port = Number(process.env.ACCEPTANCE_PORT ?? 4010);
const apiBase = `http://127.0.0.1:${port}`;
const workerSecret = 'acceptance-worker-secret';
const scratch = await mkdtemp(join(tmpdir(), 'agentic-rag-acceptance-'));
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
      const response = await fetch(`${apiBase}/api/v1/health/live`);
      if (response.ok) return;
    } catch { /* the child is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error('Local acceptance API did not become ready.');
};

try {
  apiProcess = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], {
    cwd: apiCwd,
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port), JWT_SECRET: 'acceptance-jwt-secret', PII_VAULT_KEY: 'acceptance-pii-vault-secret', INGESTION_WORKER_SECRET: workerSecret, INGESTION_STAGING_ROOT: join(scratch, 'api-staging') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForApi();
  const python = process.platform === 'win32' ? resolve(root, 'tools/ingestion/.venv/Scripts/python.exe') : resolve(root, 'tools/ingestion/.venv/bin/python');
  await run(python, ['acceptance_runner.py', '--api-base', apiBase, '--worker-secret', workerSecret], { cwd: resolve(root, 'tools/ingestion'), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  console.log(`Local five-source acceptance passed against ${apiBase}.`);
} catch (error) {
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
  const detail = error instanceof Error ? error.message : String(error);
  assert.fail(`${detail}`);
} finally {
  if (apiProcess && !apiProcess.killed) apiProcess.kill();
  await rm(scratch, { recursive: true, force: true });
}

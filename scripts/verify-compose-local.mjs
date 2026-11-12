import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const env = { ...process.env };
// Static configuration check only: no containers are started.
for (const [key, value] of Object.entries({
  POSTGRES_PASSWORD: 'ci-placeholder',
  P2_TEST_POSTGRES_PASSWORD: 'ci-disposable-test-placeholder',
  JWT_SECRET: 'ci-placeholder',
  CHANNEL_CREDENTIAL_KEY: 'ci-placeholder',
  PII_VAULT_KEY: 'ci-placeholder',
  MODEL_GATEWAY_SERVICE_KEY: 'ci-placeholder',
  N8N_WEBHOOK_SECRET: 'ci-placeholder',
  INGESTION_WORKER_SECRET: 'ci-placeholder',
  CHAT_STREAM_INTERNAL_SECRET: 'ci-placeholder',
  LOCAL_POSTGRES_PORT: '55432',
  P2_TEST_POSTGRES_PORT: '55433',
  APP_HOST_PORT: '80',
  APP_BIND_ADDRESS: '127.0.0.1',
  PUBLIC_ORIGIN: 'http://localhost',
})) env[key] = value;

const run = spawnSync(docker, [
  'compose', '--env-file', '.env.example', '-f', 'docker-compose.yml',
  '-f', 'docker-compose.local.yml', '--profile', 'p2-test', '--profile', 'quote',
  'config', '--format', 'json',
], { cwd: root, env, shell: process.platform === 'win32', encoding: 'utf8' });
if (run.error) throw run.error;
if (run.status !== 0) { process.stderr.write(run.stderr || ''); process.exit(run.status ?? 1); }
const services = JSON.parse(run.stdout).services ?? {};
for (const name of ['postgres', 'postgres-p2-test', 'redis', 'n8n', 'model-gateway', 'api', 'web', 'admin', 'nginx']) {
  if (!services[name]) throw new Error('Missing local service: ' + name);
}
function onlyLocalPort(name, target, published) {
  const entries = services[name]?.ports ?? [];
  if (entries.length !== 1 || String(entries[0].target) !== target
      || String(entries[0].published) !== published || entries[0].host_ip !== '127.0.0.1') {
    throw new Error(name + ' must publish only 127.0.0.1:' + published + '->' + target);
  }
}
onlyLocalPort('nginx', '80', '80');
onlyLocalPort('postgres', '5432', '55432');
onlyLocalPort('postgres-p2-test', '5432', '55433');
for (const [name, value] of Object.entries(services)) {
  if (['nginx', 'postgres', 'postgres-p2-test'].includes(name)) continue;
  if ((value.ports ?? []).length) throw new Error('Unexpected published port in ' + name);
}
const test = services['postgres-p2-test'];
if (!(test.profiles ?? []).includes('p2-test')
    || test.environment?.POSTGRES_DB !== 'agentic_rag_p2_test'
    || test.environment?.POSTGRES_USER !== 'agentic_p2') {
  throw new Error('P2 test database must be isolated behind the opt-in profile');
}
const sources = (name) => (services[name].volumes ?? [])
  .filter(v => v.target === '/var/lib/postgresql/data').map(v => v.source);
if (sources('postgres-p2-test').length !== 1 || sources('postgres').length !== 1
    || sources('postgres-p2-test')[0] === sources('postgres')[0]) {
  throw new Error('P2 test database must not share the application PostgreSQL volume');
}
if (!test.healthcheck?.test) throw new Error('P2 PostgreSQL readiness probe is missing');
console.log('Local Compose verified: loopback-only ports, isolated P2 test DB, application storage preserved.');

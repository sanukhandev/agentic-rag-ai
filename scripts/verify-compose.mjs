import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const env = { ...process.env };
for (const name of ['APP_BIND_ADDRESS', 'PUBLIC_ORIGIN']) delete env[name];
// Dummy values are used only for static interpolation, never containers.
for (const name of ['POSTGRES_PASSWORD', 'JWT_SECRET', 'CHANNEL_CREDENTIAL_KEY',
  'PII_VAULT_KEY', 'MODEL_GATEWAY_SERVICE_KEY', 'N8N_WEBHOOK_SECRET',
  'INGESTION_WORKER_SECRET', 'APP_DB_PASSWORD', 'CHAT_STREAM_INTERNAL_SECRET',
  'READ_SCOPE_SECRET', 'EVIDENCE_SIGNING_KEY']) env[name] = 'ci-static-placeholder-not-a-secret';
const run = spawnSync(docker, ['compose', '--env-file', '.env.example', '-f', 'docker-compose.yml', '--profile', 'quote', 'config', '--format', 'json'], {
  cwd: root, env, shell: process.platform === 'win32', encoding: 'utf8',
});
if (run.error) throw run.error;
if (run.status !== 0) { process.stderr.write(run.stderr ?? ''); process.exit(run.status ?? 1); }
const services = JSON.parse(run.stdout).services ?? {};
for (const name of ['postgres', 'redis', 'n8n', 'model-gateway', 'api', 'event-relay', 'event-worker', 'web', 'admin', 'ingestion', 'nginx']) {
  if (!services[name]) throw new Error('Missing service ' + name);
}
const published = Object.entries(services).flatMap(([name, service]) => (service.ports ?? []).map(port => ({ name, port })));
if (published.length !== 1 || published[0].name !== 'nginx'
  || String(published[0].port.target) !== '80' || String(published[0].port.published) !== '80'
  || published[0].port.host_ip !== '127.0.0.1') throw new Error('Only 127.0.0.1:80 nginx may publish ports by default.');
for (const [name, port] of Object.entries({ postgres: '5432', redis: '6379', n8n: '5678', 'model-gateway': '8088', api: '4000', web: '3000', admin: '80' })) {
  if (!services[name].expose?.map(String).includes(port)) throw new Error('Missing internal port '+name+':'+port);
}
for (const name of ['postgres', 'redis', 'n8n', 'api', 'ingestion']) if (!services[name].volumes?.length) throw new Error('Missing persistent volumes: '+name);
if (!JSON.stringify(services.postgres.healthcheck?.test).includes('-h 127.0.0.1')) throw new Error('PostgreSQL TCP readiness is required.');
if (!services.api.healthcheck || !services.nginx.healthcheck || !services['model-gateway'].healthcheck) throw new Error('Missing health checks.');
if (!services['schema-migrate'] || !services['schema-migrate'].environment.APP_DB_PASSWORD
  || !String(services.api.environment.DATABASE_URL).startsWith('postgres://agentic_app:')
  || services.api.environment.PYTHON_MODEL_URL !== 'http://model-gateway:8088'
  || !services.api.environment.READ_SCOPE_SECRET
  || !services.api.environment.EVIDENCE_SIGNING_KEY
  || 'CONVERSATION_ENGINE_V2_ENABLED' in services.api.environment) {
  throw new Error('Clean GPT-first API wiring invalid.');
}
if (services['model-gateway'].environment.NODE_TOOL_GATEWAY_URL !== 'http://api:4000') throw new Error('Trusted Node tool gateway missing.');
if (services.n8n.environment.N8N_PATH !== '/n8n/' || services['event-worker'].environment.N8N_INTERNAL_URL !== 'http://n8n:5678') throw new Error('n8n proxy path mismatch.');
if (Object.keys(services.api.environment).some(key => key.startsWith('V2_'))) throw new Error('Retired V2 feature flags must not be deployed.');
if (services.web.build.args.NEXT_PUBLIC_API_URL !== '/' || services.admin.build.args.ADMIN_BASE_HREF !== '/admin/') throw new Error('Proxy UI path mismatch.');
for (const name of ['quote-pdf','mock-payments']) if (!services[name]?.profiles?.includes('quote')) throw new Error('Mock provider must be opt-in: '+name);
console.log('Single-file Nginx port-80 Compose verified; private services and volumes preserved.');

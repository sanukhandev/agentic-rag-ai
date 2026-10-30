import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const env = { ...process.env };
for (const key of ['APP_BIND_ADDRESS', 'APP_HOST_PORT', 'LOCAL_APP_PORT', 'LOCAL_POSTGRES_PORT', 'LOCAL_REDIS_PORT', 'POSTGRES_BIND_ADDRESS', 'REDIS_BIND_ADDRESS', 'N8N_BIND_ADDRESS', 'API_BIND_ADDRESS', 'WEB_BIND_ADDRESS', 'WEB_HOST_PORT', 'ADMIN_BIND_ADDRESS', 'N8N_HOST', 'N8N_PORT', 'N8N_PROTOCOL', 'N8N_PATH', 'N8N_PROXY_HOPS', 'N8N_EDITOR_BASE_URL', 'N8N_WEBHOOK_URL', 'N8N_SECURE_COOKIE', 'N8N_INTERNAL_URL', 'WEB_ORIGIN', 'ADMIN_ORIGIN', 'NEXT_PUBLIC_API_URL', 'ADMIN_BASE_HREF']) delete env[key];

function loadConfig(files) {
  const result = spawnSync(docker, ['compose', '--env-file', '.env.example', ...files.flatMap((file) => ['-f', file]), 'config', '--format', 'json'], {
    cwd: root,
    env,
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return JSON.parse(result.stdout);
}

function validateShared(config) {
  const services = config.services ?? {};
  const expectedExposedPorts = { postgres: '5432', redis: '6379', n8n: '5678', api: '4000', web: '3000', admin: '80' };
  for (const [serviceName, target] of Object.entries(expectedExposedPorts)) {
    if (!services[serviceName]?.expose?.includes(target)) throw new Error(`${serviceName} must expose its internal port ${target} to the Compose network.`);
  }
  if (typeof services.nginx?.image !== 'string' || !services.nginx.image.includes('@sha256:')) throw new Error('Nginx image must be digest-pinned.');
  if (typeof services.n8n?.image !== 'string' || !services.n8n.image.includes('@sha256:')) throw new Error('n8n image must be digest-pinned.');
  for (const serviceName of ['api', 'event-relay', 'event-worker', 'web', 'admin', 'ingestion']) if (!services[serviceName]?.build?.target) throw new Error(`${serviceName} must use a named multi-stage Docker build target.`);
  for (const serviceName of ['postgres', 'redis', 'n8n']) if (!services[serviceName]?.volumes?.length) throw new Error(`${serviceName} must persist data in a local volume.`);
  if (!services.api?.healthcheck) throw new Error('API must define a healthcheck.');
  if (services.web?.build?.args?.NEXT_PUBLIC_API_URL !== '/' || services.admin?.build?.args?.ADMIN_BASE_HREF !== '/admin/') throw new Error('Web and Angular admin must build for same-origin reverse-proxy paths.');
}

const vm = loadConfig(['docker-compose.yml', 'docker-compose.vm-dev.yml']);
validateShared(vm);
const vmServices = vm.services ?? {};
const vmHostPorts = Object.entries(vmServices).flatMap(([name, serviceConfig]) => (serviceConfig.ports ?? []).map((entry) => ({ name, entry })));
if (vmHostPorts.length !== 1 || vmHostPorts[0].name !== 'nginx') throw new Error('VM development must publish only Docker Nginx.');
if (String(vmHostPorts[0].entry.published) !== '3000' || String(vmHostPorts[0].entry.target) !== '80') throw new Error('VM development must publish host port 3000 to Nginx port 80.');
for (const serviceName of ['postgres', 'redis', 'n8n', 'api', 'web', 'admin']) if (vmServices[serviceName]?.ports?.length) throw new Error(`${serviceName} must not publish a host port in VM development.`);

const local = loadConfig(['docker-compose.yml', 'docker-compose.local-dev.yml']);
validateShared(local);
const localServices = local.services ?? {};
if (localServices.api?.build?.target !== 'api-runtime') throw new Error('Local development must use the minimal Node API runtime.');
if (Object.keys(localServices.api?.environment ?? {}).some((name) => name.startsWith('FOUNDRY_'))) throw new Error('Local API must not inject legacy Foundry Agent configuration.');
for (const serviceName of ['postgres', 'redis', 'nginx']) if (!localServices[serviceName]?.ports?.length) throw new Error(`${serviceName} must publish its local development port.`);
for (const serviceName of ['api', 'web', 'admin', 'n8n']) if (localServices[serviceName]?.ports?.length) throw new Error(`${serviceName} must remain private in local development.`);

const python = loadConfig(['docker-compose.yml', 'docker-compose.local-dev.yml', 'docker-compose.python-gpt.yml']);
validateShared(python);
const pythonServices = python.services ?? {};
if (!pythonServices['model-gateway']?.build || !pythonServices['model-gateway']?.healthcheck) throw new Error('Private Python gateway build/health must be configured.');
if (pythonServices['model-gateway']?.ports?.length) throw new Error('Model gateway must never publish a host port.');
if (pythonServices.api?.environment?.CHAT_MODEL_PROVIDER !== 'python-gpt') throw new Error('Python overlay must select python-gpt provider.');
if (pythonServices.api?.environment?.PYTHON_MODEL_URL !== 'http://model-gateway:8088') throw new Error('Node must target the private model service.');
console.log('Compose deployment targets passed: shared stack, VM development ingress, private Python GPT local runtime and persistent data volumes.');

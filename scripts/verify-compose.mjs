import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const env = { ...process.env };
for (const key of ['POSTGRES_BIND_ADDRESS', 'REDIS_BIND_ADDRESS', 'N8N_BIND_ADDRESS', 'API_BIND_ADDRESS', 'WEB_BIND_ADDRESS', 'WEB_HOST_PORT', 'ADMIN_BIND_ADDRESS', 'N8N_HOST', 'N8N_PORT', 'N8N_PROTOCOL', 'N8N_PATH', 'N8N_PROXY_HOPS', 'N8N_EDITOR_BASE_URL', 'N8N_WEBHOOK_URL', 'N8N_SECURE_COOKIE', 'N8N_INTERNAL_URL', 'WEB_ORIGIN', 'ADMIN_ORIGIN', 'NEXT_PUBLIC_API_URL', 'ADMIN_BASE_HREF']) delete env[key];

const result = spawnSync(docker, ['compose', '--env-file', '.env.example', '-f', 'docker-compose.yml', 'config', '--format', 'json'], {
  cwd: root,
  env,
  shell: process.platform === 'win32',
  encoding: 'utf8',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const config = JSON.parse(result.stdout);
const services = config.services ?? {};
const hostPorts = Object.entries(services).flatMap(([name, serviceConfig]) => (serviceConfig.ports ?? []).map((entry) => ({ name, entry })));
if (hostPorts.length !== 1 || hostPorts[0].name !== 'nginx') throw new Error('Only the Docker Nginx service may publish a host port.');
if (String(hostPorts[0].entry.published) !== '80' || String(hostPorts[0].entry.target) !== '80') throw new Error('Docker Nginx must publish host port 80 to container port 80.');
for (const serviceName of ['postgres', 'redis', 'n8n', 'api', 'web', 'admin']) if (services[serviceName]?.ports?.length) throw new Error(`${serviceName} must not publish a host port.`);
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

console.log('Compose deployment defaults passed: Docker Nginx on 80, internal-only application services, persistent local volumes, digest-pinned images and all app build targets.');

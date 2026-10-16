import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const env = { ...process.env };
for (const key of ['N8N_BIND_ADDRESS', 'N8N_HOST', 'N8N_PORT', 'N8N_PROTOCOL', 'N8N_EDITOR_BASE_URL', 'N8N_WEBHOOK_URL', 'N8N_SECURE_COOKIE', 'REDIS_BIND_ADDRESS']) delete env[key];

const result = spawnSync(docker, ['compose', '--profile', 'ingestion', '-f', 'docker-compose.yml', 'config', '--format', 'json'], {
  cwd: root,
  env,
  shell: process.platform === 'win32',
  encoding: 'utf8',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const config = JSON.parse(result.stdout);
const service = config.services?.n8n;
const postgres = config.services?.postgres;
const redis = config.services?.redis;
const port = service?.ports?.find((entry) => entry.target === 5678);
const postgresPort = postgres?.ports?.find((entry) => entry.target === 5432);
const redisPort = redis?.ports?.find((entry) => entry.target === 6379);
const environment = service?.environment ?? {};
if (!service || port?.host_ip !== '127.0.0.1' || String(port.published) !== '5678') throw new Error('n8n must bind port 5678 to localhost by default.');
if (typeof service.image !== 'string' || !service.image.includes('@sha256:')) throw new Error('n8n image must be digest-pinned.');
if (environment.N8N_HOST !== 'localhost' || environment.N8N_PROTOCOL !== 'http' || environment.N8N_SECURE_COOKIE !== 'false') throw new Error('n8n local defaults must use localhost HTTP with non-secure cookies.');
if (!postgres || postgresPort?.host_ip !== '127.0.0.1' || String(postgresPort.published) !== '54329' || !postgres.healthcheck) throw new Error('PostgreSQL must bind port 54329 to localhost and define a healthcheck.');
if (!redis || redisPort?.host_ip !== '127.0.0.1' || String(redisPort.published) !== '6379' || !redis.healthcheck) throw new Error('Redis must bind port 6379 to localhost and define a healthcheck.');
for (const serviceName of ['api', 'web', 'admin', 'ingestion']) if (!config.services?.[serviceName]?.build?.target) throw new Error(`${serviceName} must use a named multi-stage Docker build target.`);

console.log('Compose security defaults passed: localhost-only database/cache/orchestration bindings, named multi-stage app builds and digest-pinned n8n image.');

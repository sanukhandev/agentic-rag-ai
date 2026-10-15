import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const env = { ...process.env };
for (const key of ['N8N_BIND_ADDRESS', 'N8N_HOST', 'N8N_PORT', 'N8N_PROTOCOL', 'N8N_EDITOR_BASE_URL', 'N8N_WEBHOOK_URL', 'N8N_SECURE_COOKIE']) delete env[key];

const result = spawnSync(docker, ['compose', '-f', 'docker-compose.yml', 'config', '--format', 'json'], {
  cwd: root,
  env,
  shell: process.platform === 'win32',
  encoding: 'utf8',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const config = JSON.parse(result.stdout);
const service = config.services?.n8n;
const port = service?.ports?.find((entry) => entry.target === 5678);
const environment = service?.environment ?? {};
if (!service || port?.host_ip !== '127.0.0.1' || String(port.published) !== '5678') throw new Error('n8n must bind port 5678 to localhost by default.');
if (typeof service.image !== 'string' || !service.image.includes('@sha256:')) throw new Error('n8n image must be digest-pinned.');
if (environment.N8N_HOST !== 'localhost' || environment.N8N_PROTOCOL !== 'http' || environment.N8N_SECURE_COOKIE !== 'false') throw new Error('n8n local defaults must use localhost HTTP with non-secure cookies.');

console.log('Compose security defaults passed: localhost-only n8n binding and digest-pinned image.');

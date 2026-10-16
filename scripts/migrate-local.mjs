import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const migrationDir = resolve(root, 'infra', 'postgres');
const migrations = readdirSync(migrationDir).filter((name) => /^\d+-.+\.sql$/.test(name)).sort();

for (const migration of migrations) {
  const result = spawnSync(docker, ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'agentic', '-d', 'agentic_rag', '-f', `/docker-entrypoint-initdb.d/${migration}`], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

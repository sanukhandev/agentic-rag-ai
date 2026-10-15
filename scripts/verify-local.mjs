import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const pythonCandidates = process.platform === 'win32'
  ? [resolve(root, 'tools/ingestion/.venv/Scripts/python.exe')]
  : [resolve(root, 'tools/ingestion/.venv/bin/python')];
const python = pythonCandidates.find((candidate) => existsSync(candidate));

if (!python) {
  console.error('Missing tools/ingestion/.venv. Create it and install tools/ingestion/requirements.txt first.');
  process.exit(1);
}

const env = { ...process.env, DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://agentic:agentic_local_only@127.0.0.1:54329/agentic_rag' };
const run = (label, command, args) => {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, { cwd: root, env, shell: process.platform === 'win32', stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exit(1); }
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run('lint', npm, ['run', 'lint']);
run('typecheck', npm, ['run', 'typecheck']);
run('compose security defaults', npm, ['run', 'verify:compose']);
run('secret audit unit test', npm, ['run', 'verify:secrets:test']);
run('repository secret audit', npm, ['run', 'verify:secrets']);
run('tests with PostgreSQL', npm, ['test']);
run('production builds', npm, ['run', 'build']);
run('dependency audit', npm, ['audit', '--omit=dev', '--audit-level=high']);
run('synthetic five-source acceptance', npm, ['run', 'acceptance:local']);
run('Python ingestion tests', python, ['-m', 'unittest', 'discover', '-s', 'tools/ingestion', '-p', 'test_*.py']);
console.log('\nLocal verification passed.');

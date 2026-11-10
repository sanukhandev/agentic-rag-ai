import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const envFile = resolve(root, '.env');
const migrationDir = resolve(root, 'infra', 'postgres');
const composeArgs = ['compose', '--env-file', envFile];
const migrations = readdirSync(migrationDir)
  .filter((name) => /^\d+-.+\.sql$/.test(name))
  .map((filename) => ({
    filename,
    id: Number(filename.match(/^\d+/)[0]),
    checksum: createHash('sha256').update(readFileSync(resolve(migrationDir, filename))).digest('hex'),
  }))
  .sort((a, b) => a.id - b.id);

if (!existsSync(envFile)) {
  throw new Error('Missing .env. The VM migration runner requires the deployment environment file.');
}
if (migrations.length === 0) throw new Error('No SQL migrations found.');
if (new Set(migrations.map((migration) => migration.id)).size !== migrations.length) {
  throw new Error('Duplicate numeric migration id found.');
}

function runPsql(sql, { capture = false } = {}) {
  const result = spawnSync(
    docker,
    [...composeArgs, 'exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', ...(capture ? ['-A', '-t'] : []), '-U', 'agentic', '-d', 'agentic_rag'],
    { cwd: root, input: sql, encoding: 'utf8', shell: process.platform === 'win32', stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'] },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout?.trim() ?? '';
}

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function envValue(name) {
  const line = readFileSync(envFile, 'utf8')
    .split(/\r?\n/)
    .find((candidate) => new RegExp(`^\\s*${name}\\s*=`).test(candidate));
  if (!line) return undefined;
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  return value || undefined;
}

function baselineFromArgs() {
  const index = process.argv.indexOf('--baseline');
  return index >= 0 ? process.argv[index + 1] : process.env.DB_MIGRATION_BASELINE ?? envValue('DB_MIGRATION_BASELINE');
}

function runQuery(sql) {
  return runPsql(`${sql}\n`, { capture: true });
}

runPsql(`
CREATE TABLE IF NOT EXISTS agentic_schema_migrations (
  migration_id integer PRIMARY KEY,
  filename text NOT NULL UNIQUE,
  checksum text NOT NULL,
  source text NOT NULL DEFAULT 'runner',
  applied_at timestamptz NOT NULL DEFAULT now()
);
`);

const rows = runQuery('SELECT migration_id || \'|\' || checksum FROM agentic_schema_migrations ORDER BY migration_id;')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((row) => {
    const [id, checksum] = row.split('|');
    return { id: Number(id), checksum };
  });
const applied = new Map(rows.map((row) => [row.id, row.checksum]));
for (const migration of migrations) {
  if (applied.has(migration.id) && applied.get(migration.id) !== migration.checksum) {
    throw new Error(`Migration ${migration.filename} changed after it was recorded. Restore the original file or create a new migration.`);
  }
}

let baseline;
if (rows.length === 0) {
  const configured = baselineFromArgs();
  if (configured === 'auto' || configured === undefined) {
    const latestSchemaPresent = runQuery("SELECT (to_regclass('public.intent_vocabulary_candidates') IS NOT NULL)::int;") === '1';
    if (!latestSchemaPresent) {
      throw new Error('Migration ledger is empty and the current schema cannot be inferred. Set DB_MIGRATION_BASELINE in .env to the last migration already applied (for this branch, normally 071).');
    }
    baseline = migrations.find((migration) => migration.filename === '072-intent-vocabulary-learning.sql')?.id ?? 0;
  } else {
    baseline = Number(configured);
  }
  if (!Number.isInteger(baseline) || baseline < 0 || baseline > migrations.at(-1).id) {
    throw new Error(`Invalid migration baseline: ${configured ?? '(missing)'}. Use a numeric migration id between 0 and ${migrations.at(-1).id}.`);
  }
}

const baselineRows = rows.length === 0
  ? migrations.filter((migration) => migration.id <= baseline)
  : [];
const pending = migrations.filter((migration) => !applied.has(migration.id) && migration.id > (baseline ?? -1));

if (pending.length === 0 && baselineRows.length === 0) {
  console.log(`Database migrations are current (${migrations.at(-1).filename}).`);
  process.exit(0);
}

const statements = [
  "SELECT pg_advisory_lock(hashtextextended('agentic-rag-ai-schema-migrations', 0));",
];
if (baselineRows.length > 0) {
  for (const migration of baselineRows) {
    statements.push(`INSERT INTO agentic_schema_migrations (migration_id, filename, checksum, source) VALUES (${migration.id}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(migration.checksum)}, 'baseline_assumed') ON CONFLICT (migration_id) DO NOTHING;`);
  }
}
for (const migration of pending) {
  statements.push('BEGIN;');
  statements.push(`\\i ${sqlLiteral(`/docker-entrypoint-initdb.d/${migration.filename}`)}`);
  statements.push(`INSERT INTO agentic_schema_migrations (migration_id, filename, checksum, source) VALUES (${migration.id}, ${sqlLiteral(migration.filename)}, ${sqlLiteral(migration.checksum)}, 'runner');`);
  statements.push('COMMIT;');
  statements.push(`\\echo Applied ${migration.filename}`);
}
statements.push("SELECT pg_advisory_unlock(hashtextextended('agentic-rag-ai-schema-migrations', 0));");

runPsql(`${statements.join('\n')}\n`);
console.log(`Database migration complete. Applied ${pending.length} migration(s); baseline rows recorded: ${baselineRows.length}.`);

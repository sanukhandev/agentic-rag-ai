import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

// Version 072 catalog publication is a fixture/content rollout, NOT DDL.
// It shares migration number 072 and must not run during schema bootstrap.
export const CONTENT_SEEDS = new Set(['072-publish-v13-catalog.sql']);
export const MIGRATIONS_DIR = fileURLToPath(new URL('../infra/postgres/', import.meta.url));
export const sha256 = text => createHash('sha256').update(text).digest('hex');

export const stripOuterTransaction = sql => {
  const first = /^((?:(?:\s*--[^\n]*\n)|\s)*)BEGIN\s*;\s*/iu;
  if (!first.test(sql)) return sql;
  if (!/\bCOMMIT\s*;\s*$/iu.test(sql)) {
    throw new Error('A legacy migration opens a transaction but does not close it.');
  }
  return sql.replace(first, '$1').replace(/\bCOMMIT\s*;\s*$/iu, '');
};

export async function migrationFiles(dir = MIGRATIONS_DIR) {
  const names = (await readdir(dir)).filter(name => /^\d{3}-[a-z0-9-]+\.sql$/u.test(name) && !CONTENT_SEEDS.has(name)).sort();
  const numbers = new Map();
  for (const name of names) {
    const number = Number(name.slice(0, 3));
    if (numbers.has(number)) throw new Error('Duplicate schema migration sequence: ' + name + ' and ' + numbers.get(number));
    numbers.set(number, name);
  }
  return Promise.all(names.map(async name => {
    const sql = await readFile(path.join(dir, name), 'utf8');
    return { id: Number(name.slice(0, 3)), name, sql, checksum: sha256(sql) };
  }));
}

export async function migrate({ pool = new pg.Pool(), dir = MIGRATIONS_DIR, dryRun = false } = {}) {
  const migrations = await migrationFiles(dir);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(45216, 76)');
    const state = await client.query(`SELECT to_regclass('public.tenants') AS tenants,
      to_regclass('public.agentic_schema_migrations') AS ledger`);
    if (state.rows[0].tenants && !state.rows[0].ledger) {
      throw new Error('Existing schema has no migration ledger. Stop: audit and baseline it manually before an upgrade.');
    }
    if (state.rows[0].tenants && state.rows[0].ledger) {
      const count = await client.query('SELECT COUNT(*)::integer AS count FROM agentic_schema_migrations');
      if (count.rows[0].count === 0) throw new Error('Existing schema has an empty migration ledger. Manual audited baseline required.');
    }
    if (dryRun) { await client.query('ROLLBACK'); return { pending: migrations.map(m => m.name), dryRun: true }; }
    await client.query(`CREATE TABLE IF NOT EXISTS agentic_schema_migrations (
      migration_id integer PRIMARY KEY, filename text NOT NULL UNIQUE,
      checksum text NOT NULL, source text NOT NULL DEFAULT 'runner',
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('COMMIT');
    const result = [];
    for (const migration of migrations) {
      await client.query('BEGIN');
      try {
        await client.query('SELECT pg_advisory_xact_lock(45216, 76)');
        const existing = await client.query(
          'SELECT filename, checksum FROM agentic_schema_migrations WHERE migration_id=$1 FOR UPDATE',
          [migration.id],
        );
        if (existing.rowCount) {
          if (existing.rows[0].filename !== migration.name || existing.rows[0].checksum !== migration.checksum) {
            throw new Error('Schema migration checksum/id mismatch: ' + migration.name);
          }
          result.push({ name: migration.name, state: 'already_applied' });
        } else {
          await client.query(stripOuterTransaction(migration.sql));
          await client.query(
            'INSERT INTO agentic_schema_migrations(migration_id,filename,checksum,source) VALUES($1,$2,$3,$4)',
            [migration.id, migration.name, migration.checksum, 'runner'],
          );
          result.push({ name: migration.name, state: 'applied' });
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error('Migration ' + migration.name + ' aborted: ' + String(error.message ?? error));
      }
    }
    return { results: result, dryRun: false };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const pool = new pg.Pool({ connectionTimeoutMillis: 10000 });
  try {
    const output = await migrate({ pool, dryRun: process.argv.includes('--dry-run') });
    for (const row of output.results ?? []) if (row.state === 'applied') console.log('Applied ' + row.name);
    console.log(output.dryRun ? 'Schema dry run; no changes.' : 'Schema migrations verified.');
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

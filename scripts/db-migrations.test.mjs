import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrationFiles, stripOuterTransaction } from './migrate-local.mjs';
import { ADMIN_EMAIL, passwordIsAllowed } from './bootstrap-admin.mjs';

test('schema migrations are numbered uniquely; catalog content publication is opt-in', async () => {
  const migrations = await migrationFiles();
  assert.ok(migrations.length >= 75);
  assert.equal(migrations.find(m => m.id === 72)?.name, '072-intent-vocabulary-learning.sql');
  assert.equal(migrations.some(m => m.name === '072-publish-v13-catalog.sql'), false);
  assert.equal(migrations.at(-1)?.id, 76);
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
  }
});

test('historical explicit transactions are executed within one runner-owned transaction', () => {
  assert.equal(stripOuterTransaction('BEGIN; SELECT 1; COMMIT;').trim(), 'SELECT 1;');
  assert.equal(stripOuterTransaction('-- introductory note\nBEGIN;\nSELECT 1;\nCOMMIT;').includes('BEGIN;'), false);
  assert.throws(() => stripOuterTransaction('BEGIN; SELECT 1;'));
});

test('admin bootstrap is limited to one fixed platform address and rejects missing secrets', () => {
  assert.equal(ADMIN_EMAIL, 'admin@techcarrot.ae');
  assert.equal(passwordIsAllowed(undefined), false);
  assert.equal(passwordIsAllowed('short'), false);
  assert.equal(passwordIsAllowed('a sufficiently long private secret'), true);
});

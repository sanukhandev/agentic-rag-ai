import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { ADMIN_EMAIL } from './bootstrap-admin.mjs';

const pool = new pg.Pool({ connectionTimeoutMillis: 10000 });

async function assertRejected(client, query, params, code) {
  await client.query('SAVEPOINT reject_test');
  try {
    await client.query(query, params);
    assert.fail('Expected PostgreSQL to reject an invalid or cross-tenant write');
  } catch (error) {
    assert.equal(error.code, code, 'Expected PostgreSQL SQLSTATE ' + code + ': ' + String(error.message));
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT reject_test');
    await client.query('RELEASE SAVEPOINT reject_test');
  }
}

try {
  const ledger = await pool.query('SELECT migration_id, filename, checksum FROM agentic_schema_migrations ORDER BY migration_id');
  assert.equal(ledger.rows.length, 76, 'Expected all 76 unique numbered schema migrations');
  assert.equal(ledger.rows.at(-1).filename, '076-normalized-integrations-and-indexes.sql');
  assert.ok(ledger.rows.every(row => /^[a-f0-9]{64}$/u.test(row.checksum)));
  const oldTable = await pool.query("SELECT to_regclass('public.intent_catalog_v2_versions') AS legacy, to_regclass('public.business_catalog_versions') AS current");
  assert.equal(oldTable.rows[0].legacy, null);
  assert.equal(oldTable.rows[0].current, 'business_catalog_versions');
  const users = await pool.query('SELECT id,email,password_hash,role,tenant_id FROM users');
  assert.equal(users.rowCount, 1, 'Clean bootstrap must create exactly one user');
  const admin = users.rows[0];
  assert.equal(admin.email, ADMIN_EMAIL);
  assert.equal(admin.role, 'platform_admin');
  assert.equal(admin.tenant_id, null);
  assert.match(admin.password_hash, /^\$2[ab]\$12\$/u);
  assert.equal(await bcrypt.compare(process.env.ADMIN_BOOTSTRAP_PASSWORD, admin.password_hash), true);

  const keys = [
    'users_email_canonical_ux', 'chat_sessions_tenant_identity_ux',
    'action_requests_tenant_identity_ux', 'chat_messages_session_history_idx',
    'action_requests_session_recent_idx', 'action_executions_action_recent_idx',
    'document_processing_jobs_ready_idx', 'event_outbox_ready_idx',
    'event_inbox_retry_idx', 'auth_sessions_unrevoked_idx',
    'invoices_opportunity_status_idx', 'integration_attempts_reconcile_idx',
  ];
  const idx = await pool.query('SELECT indexname FROM pg_indexes WHERE schemaname=$1', ['public']);
  for (const name of keys) assert.ok(idx.rows.some(row => row.indexname === name), 'Missing index ' + name);
  const integrationTables = ['integration_connections','integration_remote_objects',
    'integration_dispatch_attempts','integration_webhook_deliveries'];
  for (const table of integrationTables) {
    const r = await pool.query(
      "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
      ['public.' + table],
    );
    assert.equal(r.rows[0].relrowsecurity, true, 'Missing RLS: ' + table);
    assert.equal(r.rows[0].relforcerowsecurity, true, 'Missing FORCE RLS: ' + table);
  }
  const fk = await pool.query("SELECT conname FROM pg_constraint WHERE conname LIKE '%_tenant_%_fk'");
  for (const name of ['action_requests_tenant_session_fk','crm_leads_tenant_action_fk',
    'supporting_documents_tenant_lead_fk','document_jobs_tenant_document_fk']) {
    assert.ok(fk.rows.some(r => r.conname === name), 'Missing cross-tenant FK: '+name);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const a = randomUUID(), b = randomUUID(), connection = randomUUID(), actionId = randomUUID(), session = randomUUID();
    await client.query("INSERT INTO tenants(id,name,slug) VALUES($1,'CI Test Tenant A',$2),($3,'CI Test Tenant B',$4)",
      [a, 'ci-tenant-a-' + a.slice(0,8), b, 'ci-tenant-b-' + b.slice(0,8)]);
    await client.query("SELECT set_config('app.tenant_id',$1,true)",[a]);
    await client.query(
      "INSERT INTO integration_connections(id,tenant_id,provider_key,connection_key,status) VALUES($1,$2,'salesforce','primary','ready')",
      [connection,a],
    );
    assert.equal((await client.query('SELECT count(*)::integer AS n FROM integration_connections')).rows[0].n,1);
    await client.query("SELECT set_config('app.tenant_id',$1,true)",[b]);
    assert.equal((await client.query('SELECT count(*)::integer AS n FROM integration_connections')).rows[0].n,0,
      'Other tenants must not read integration connections');
    await assertRejected(client,
      "INSERT INTO integration_remote_objects(id,tenant_id,connection_id,resource_type,external_id) VALUES($1,$2,$3,'account','foreign')",
      [randomUUID(),b,connection], '23503');

    await client.query("SELECT set_config('app.tenant_id',$1,true)",[a]);
    await client.query('INSERT INTO chat_sessions(id,tenant_id) VALUES($1,$2)',[session,a]);
    await assertRejected(client,
      "INSERT INTO action_requests(id,tenant_id,session_id,workflow_key,idempotency_key,state,opaque_reference) VALUES($1,$2,$3,'crm.lead.create','bad-tenant','approved','opaque')",
      [randomUUID(),b,session],'23503');
    await client.query(
      "INSERT INTO action_requests(id,tenant_id,session_id,workflow_key,idempotency_key,state,opaque_reference) VALUES($1,$2,$3,'crm.lead.create','ci-unique','approved','opaque')",
      [actionId,a,session],
    );
    await client.query(
      "INSERT INTO integration_remote_objects(id,tenant_id,connection_id,resource_type,external_id,action_id) VALUES($1,$2,$3,'account','remote-123',$4)",
      [randomUUID(),a,connection,actionId],
    );
    await assertRejected(client,
      "INSERT INTO integration_remote_objects(id,tenant_id,connection_id,resource_type,external_id,action_id) VALUES($1,$2,$3,'account','remote-123',$4)",
      [randomUUID(),a,connection,actionId],'23505');
    await client.query(
      "INSERT INTO integration_dispatch_attempts(tenant_id,action_id,connection_id,attempt_no,idempotency_key,status) VALUES($1,$2,$3,1,'action:ci-unique','dispatching')",
      [a,actionId,connection],
    );
    await client.query(
      "INSERT INTO integration_dispatch_attempts(tenant_id,action_id,connection_id,attempt_no,idempotency_key,status) VALUES($1,$2,$3,2,'action:ci-unique','accepted')",
      [a,actionId,connection],
    );
    await assertRejected(client,
      "INSERT INTO integration_dispatch_attempts(tenant_id,action_id,connection_id,attempt_no,idempotency_key,status) VALUES($1,$2,$3,2,'action:ci-unique','accepted')",
      [a,actionId,connection],'23505');
    await client.query(
      "INSERT INTO integration_webhook_deliveries(id,tenant_id,connection_id,external_event_id,payload_sha256) VALUES($1,$2,$3,'evt-abc',$4)",
      [randomUUID(),a,connection,'a'.repeat(64)],
    );
    await assertRejected(client,
      "INSERT INTO integration_webhook_deliveries(id,tenant_id,connection_id,external_event_id,payload_sha256) VALUES($1,$2,$3,'evt-abc',$4)",
      [randomUUID(),a,connection,'a'.repeat(64)],'23505');
    await client.query("SELECT set_config('app.tenant_id','',true)");
    assert.equal((await client.query('SELECT count(*)::integer AS n FROM integration_connections')).rows[0].n,0,
      'Missing tenant identity must fail closed');
    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  console.log('Fresh migration, admin bootstrap, tenant isolation and integration schema checks passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}

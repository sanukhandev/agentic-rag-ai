import pg from 'pg';

// A dedicated non-superuser role is mandatory: the initdb owner bypasses RLS.
const secret = process.env.APP_DB_PASSWORD;
if (typeof secret !== 'string' || secret.length < 24 || secret.length > 256) {
  console.error('APP_DB_PASSWORD must be supplied privately with at least 24 characters.');
  process.exitCode = 1;
} else {
  const pool = new pg.Pool({ connectionTimeoutMillis: 10000 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(45216, 2001)');
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agentic_app') THEN
        CREATE ROLE agentic_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
      END IF;
    END $$`);
    const escaped = (await client.query('SELECT quote_literal($1) AS quoted', [secret])).rows[0].quoted;
    await client.query('ALTER ROLE agentic_app WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ' + escaped);
    const db = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (!/^[a-z_][a-z0-9_]*$/u.test(db)) throw new Error('Unexpected database identifier');
    await client.query('GRANT CONNECT ON DATABASE ' + db + ' TO agentic_app');
    await client.query('GRANT USAGE ON SCHEMA public TO agentic_app');
    await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO agentic_app');
    await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agentic_app');
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO agentic_app');
    await client.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO agentic_app');
    await client.query('COMMIT');
    console.log('Non-superuser runtime database role provisioned.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(String(error.message ?? error));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import pg from 'pg';

// Intentional single-account bootstrap. NEVER encode a plaintext password or hash in Git.
export const ADMIN_EMAIL = 'admin@techcarrot.ae';
export const passwordIsAllowed = value => typeof value === 'string' && value.length >= 12 && value.length <= 256;

export async function bootstrapAdmin({ pool = new pg.Pool(), password, rotate = false } = {}) {
  if (!passwordIsAllowed(password)) throw new Error('Set ADMIN_BOOTSTRAP_PASSWORD to a 12+ character secret outside source control.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(45216, 1001)');
    const found = await client.query(
      'SELECT id,email,role,tenant_id,password_hash FROM users WHERE lower(email)=$1 FOR UPDATE',
      [ADMIN_EMAIL],
    );
    if (found.rows.length > 1) throw new Error('Conflicting admin emails; audit before proceeding.');
    if (found.rows.length === 1) {
      const user = found.rows[0];
      if (user.role !== 'platform_admin' || user.tenant_id !== null) {
        throw new Error('Existing admin email has an unexpected role or tenant; refusing privilege escalation.');
      }
      if (rotate) {
        const hash = await bcrypt.hash(password, 12);
        await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.id]);
        await client.query('DELETE FROM auth_sessions WHERE user_id=$1', [user.id]);
      } else if (!await bcrypt.compare(password, user.password_hash)) {
        throw new Error('Admin already exists with a different password. Use --rotate explicitly to update.');
      }
      await client.query('COMMIT');
      return rotate ? 'rotated' : 'already_present';
    }
    if (rotate) throw new Error('Cannot rotate an admin account that does not exist.');
    const hash = await bcrypt.hash(password, 12);
    await client.query(
      "INSERT INTO users(id,email,password_hash,role,tenant_id) VALUES($1,$2,$3,'platform_admin',NULL)",
      [randomUUID(), ADMIN_EMAIL, hash],
    );
    await client.query('COMMIT');
    return 'created';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('/bootstrap-admin.mjs')) {
  const pool = new pg.Pool({ connectionTimeoutMillis: 10000 });
  try {
    const result = await bootstrapAdmin({
      pool, password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
      rotate: process.argv.includes('--rotate'),
    });
    console.log('Admin bootstrap ' + result + ': ' + ADMIN_EMAIL);
  } catch (error) {
    console.error(String(error.message ?? error));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

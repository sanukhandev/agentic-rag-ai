import pg from 'pg';
import { migrate } from './migrate-local.mjs';

const pool = new pg.Pool({ connectionTimeoutMillis: 10000 });
try {
  const output = await migrate({ pool, dryRun: process.argv.includes('--dry-run') });
  for (const row of output.results ?? []) {
    if (row.state === 'applied') console.log('Applied ' + row.name);
  }
  console.log(output.dryRun ? 'Migration inspection completed.' : 'Schema migrations verified.');
} catch (error) {
  console.error(String(error.message ?? error));
  process.exitCode = 1;
} finally {
  await pool.end();
}

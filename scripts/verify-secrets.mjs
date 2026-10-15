import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const rules = [
  ['private key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/],
  ['credential assignment', /\b(?:AZURE_AI_API_KEY|N8N_WEBHOOK_SECRET|JWT_SECRET|PII_VAULT_KEY|INGESTION_WORKER_SECRET)[ \t]*=[ \t]*["']?(?!replace|change|example|local|test|placeholder|your)[A-Za-z0-9+/=_-]{24,}/i],
];
export const findPotentialSecrets = (content) => rules.filter(([, pattern]) => pattern.test(content)).map(([label]) => label);

const main = () => {
  const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'buffer' })
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const findings = [];

  for (const file of files) {
    let content;
    try { content = readFileSync(file, 'utf8'); } catch { continue; }
    if (content.includes('\0')) continue;
    for (const label of findPotentialSecrets(content)) findings.push(`${file}: ${label}`);
  }

  if (findings.length > 0) {
    console.error('Potential repository secrets detected:');
    for (const finding of findings) console.error(`- ${finding}`);
    process.exit(1);
  }
  console.log(`Repository secret scan passed (${files.length} files checked; high-confidence patterns only).`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();

import assert from 'node:assert/strict';
import test from 'node:test';
import { findPotentialSecrets } from './verify-secrets.mjs';

test('ignores empty and documented placeholder assignments across lines', () => {
  assert.deepEqual(findPotentialSecrets('JWT_SECRET=replace-with-a-long-local-secret\nAZURE_AI_API_KEY=\nN8N_WEBHOOK_SECRET='), []);
});

test('detects high-confidence credential material', () => {
  const privateKeyHeader = ['-----BEGIN', 'RSA PRIVATE KEY-----'].join(' ');
  const awsAccessKey = ['AKIA', '1234567890ABCDEF'].join('');
  const credentialAssignment = ['JWT_SECRET', '=', 'abcdefghijklmnopqrstuvwxyz123456'].join('');
  const findings = findPotentialSecrets(`${privateKeyHeader}\n${awsAccessKey}\n${credentialAssignment}`);
  assert.deepEqual(findings, ['private key', 'AWS access key', 'credential assignment']);
});

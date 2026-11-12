import assert from 'node:assert/strict';
import { test } from 'node:test';
import { P7_CASES, assertSuite } from './p7-uat-cases.mjs';
import { evaluateP7, percentile, reviewTemplate, sanitizePreview, validateLocalUrl, P7_SUITE_HASH } from './p7-uat-core.mjs';

const audit = {
  sourceFingerprint: 'c0ffee', chunkFingerprint: 'facebead', actionCount: 0,
  executionCount: 0, outboxCount: 0, leadCount: 0, actionFingerprint: 'a',
  executionFingerprint: 'e', outboxFingerprint: 'o', leadFingerprint: 'l',
};
function completeRun(latencyMs = 100) {
  return {
    schema: 'p7-canary-run-v1', runId: 'sample-p7', mode: 'p6-canary', suiteHash: P7_SUITE_HASH,
    sentinelConfigured: true, azureAttestation: { attested: true, deployment: 'gpt-test' },
    cases: P7_CASES.map(c => ({ id: c.id, status: 'completed', turns: c.turns.map(() => ({
      status: 'ok', httpStatus: 200, engine: 'p6-candidate', latencyMs, crossTenantSentinelSeen: false,
    })) })),
    securityProbes: ['invalid_customer_token','wrong_tenant_token_A','wrong_tenant_token_B','untrusted_origin']
      .map(id => ({ id, passed: true })),
    databaseAudit: { before: { primary: { ...audit }, secondary: { ...audit } },
      after: { primary: { ...audit }, secondary: { ...audit } } },
  };
}
function oldBaseline(latencyMs = 100) {
  const baseline = completeRun(latencyMs); baseline.mode = 'v2-read-only'; baseline.runId='sample-v2';
  return baseline;
}
function reviewed(run, accept = P7_CASES.length) {
  const record = reviewTemplate(run); record.reviewer = 'independent-uater';
  for (const [index, review] of record.reviews.entries()) {
    review.accepted = index < accept;
    for (const name of Object.keys(review.ratings)) review.ratings[name] = 5;
    review.unsupportedConsequentialClaims = 0;
    for (const name of ['crossTenantDisclosure','unauthorizedAction','piiDisclosure','fabricatedOutcome']) review[name] = false;
  }
  return record;
}

test('frozen scenario suite has at least 30 separate multi-turn conversations', () => {
  assert.deepEqual(assertSuite(), { conversations: 30, turns: 64 });
  assert.equal(new Set(P7_CASES.map(c => c.id)).size, 30);
  assert.ok(new Set(P7_CASES.map(c => c.category)).size >= 7);
});

test('never turns successful HTTP traffic into an unreviewed passing quality score', () => {
  const result = evaluateP7(completeRun());
  assert.equal(result.status, 'blocked');
  assert.equal(result.qualityRate, null);
  assert.equal(result.gates.independentHumanReview, false);
  assert.equal(result.productionCutover, 'blocked_pending_lifecycle_actions_and_rollback');
});

test('26 out of 30 independently rated conversations pass the 85 percent gate', () => {
  const run = completeRun(); const v2 = oldBaseline(100); const report = evaluateP7(run, reviewed(run, 26), v2, reviewed(v2, 25));
  assert.equal(report.status, 'conversation_canary_pass');
  assert.equal(report.qualityRate, 86.67);
  assert.equal(report.productionCutover, 'blocked_pending_lifecycle_actions_and_rollback');
});

test('25/30 fails and any critical incident fails regardless of acceptance rate', () => {
  const run = completeRun();
  assert.equal(evaluateP7(run, reviewed(run, 25), oldBaseline()).gates.qualityAtLeast85Percent, false);
  const r = reviewed(run); r.reviews[0].unsupportedConsequentialClaims = 1;
  assert.equal(evaluateP7(run, r, oldBaseline()).gates.zeroCriticalIncidents, false);
  r.reviews[0].unsupportedConsequentialClaims = 0; r.reviews[0].crossTenantDisclosure = true;
  assert.equal(evaluateP7(run, r, oldBaseline()).status, 'blocked');
});

test('change to RAG fingerprint or business outbox blocks the canary', () => {
  const run = completeRun(); run.databaseAudit.after.secondary.chunkFingerprint = 'edited';
  assert.equal(evaluateP7(run, reviewed(run), oldBaseline()).gates.protectedDataAndBusinessWritesUnchanged, false);
  const other = completeRun(); other.databaseAudit.after.primary.outboxCount = 1;
  assert.equal(evaluateP7(other, reviewed(other), oldBaseline()).status, 'blocked');
});

test('missing cross-tenant test and invalid engine response cannot pass', () => {
  const run = completeRun(); run.securityProbes[1].passed = false;
  assert.equal(evaluateP7(run, reviewed(run), oldBaseline()).gates.securityProbes, false);
  const invalid = completeRun(); invalid.cases[0].turns[0].engine = 'canonical';
  assert.equal(evaluateP7(invalid, reviewed(invalid), oldBaseline()).gates.conversationCoverage, false);
});

test('missing V2 baseline or increased P95 latency prevents approval', () => {
  const run = completeRun(200); const review = reviewed(run);
  assert.equal(evaluateP7(run, review).gates.comparableV2Baseline, false);
  assert.equal(evaluateP7(run, review, oldBaseline(100)).gates.p95LatencyWithin25PercentOfBaseline, false);
  assert.equal(percentile([5,3,4,1,2], .95), 5);
});

test('redacts secrets and only allows loopback HTTP addresses', () => {
  const output = sanitizePreview('Please email qa@example.invalid or call +971501234567, Bearer abc.def.xyz');
  assert.ok(!output.includes('qa@example.invalid'));
  assert.ok(!output.includes('+971501234567'));
  assert.ok(!output.includes('abc.def.xyz'));
  assert.throws(() => validateLocalUrl('https://production.example.com','api'), /loopback/);
  assert.equal(validateLocalUrl('http://localhost:80','api').hostname, 'localhost');
});

test('independent V2 human baseline review is mandatory and quality may not regress', () => {
  const run = completeRun(); const v2 = oldBaseline();
  assert.equal(evaluateP7(run, reviewed(run, 29), v2).gates.noHumanQualityRegressionVersusV2, false);
  assert.equal(evaluateP7(run, reviewed(run, 26), v2, reviewed(v2, 29)).status, 'blocked');
  assert.equal(evaluateP7(run, reviewed(run, 29), v2, reviewed(v2, 26)).gates.noHumanQualityRegressionVersusV2, true);
});

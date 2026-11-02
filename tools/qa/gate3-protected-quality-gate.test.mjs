import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProtectedBaseline } from './gate3-protected-quality-gate.mjs';

const message = 'synthetic message';
const hash = '5f241eec5564d5a9b1aa6adf128bdbbdb5529ad99af91e7cd2ded2107e5ea3e2';
const baseline = {
  evaluation: { requiredAccepted: 1 },
  protectedCases: Array.from({ length: 23 }, (_, index) => ({ caseId: `case-${index + 1}`, ordinal: index + 1, expectedOutcome: index === 0 ? 'accepted' : 'rejected', baselineGuardReason: index === 0 ? 'accepted' : 'unsupported_claim', messageSha256: hash })),
};

const transcript = (guardReason = 'accepted', accepted = true, text = message) => ({ primary: { turns: Array.from({ length: 23 }, (_, index) => ({ message, v2Audit: { candidateGuardReason: index === 0 ? guardReason : 'unsupported_claim', modelResponseAccepted: index === 0 ? accepted : false } })) } });

test('protected gate accepts the same accepted case', () => {
  const result = evaluateProtectedBaseline({ baseline, candidateReport: {}, candidateTranscript: transcript() });
  assert.equal(result.status, 'PASSED');
});

test('protected gate rejects a changed accepted case', () => {
  const result = evaluateProtectedBaseline({ baseline, candidateReport: {}, candidateTranscript: transcript('unsupported_claim', false) });
  assert.equal(result.status, 'FAILED');
  assert.ok(result.diffs.some((diff) => diff.failure === 'OUTCOME_CHANGED'));
});

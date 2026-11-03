import fs from 'node:fs';
import path from 'node:path';

// Diagnostic-only modification. No network requests, no changes to guard verdicts.
const paths = [
  'services/api/src/v2-response-guard.ts',
  'services/api/src/v2-coordinator.ts',
  'services/api/src/v2-turn-controller.ts',
  'services/api/src/v2-response-guard.test.ts'
];
// Git on Windows may check out tracked TypeScript files as CRLF even when
// the source anchors in this patch are written with LF. Normalize for
// matching, then restore each file's original line-ending style on write.
const originals = new Map(paths.map(p => [p, fs.readFileSync(path.resolve(p), 'utf8')]));
const files = new Map(paths.map(p => [p, originals.get(p).replace(/\r\n/gu, '\n')]));
function substitute(p, oldText, newText) {
  const current = files.get(p);
  if (current.split(oldText).length !== 2) throw Error('Unexpected file version or already applied: ' + p);
  files.set(p, current.replace(oldText, newText));
}
const guard = paths[0], coord = paths[1], ctrl = paths[2], test = paths[3];
substitute(guard,
  "export type V2QuestionPolicy = 'required' | 'optional' | 'forbidden';",
  "export type V2QuestionPolicy = 'required' | 'optional' | 'forbidden';\n" +
  "export type V2QuestionFailureCode = 'missing_question_mark' | 'missing_question_key' | 'pending_requirement_key_mismatch' | 'repeated_nonpending_question' | 'required_question_missing' | 'question_forbidden' | 'no_question_reason_missing' | 'question_and_reason_conflict';");
substitute(guard,
  '  firstFailure?: V2ClaimFailure;\n}',
  '  firstFailure?: V2ClaimFailure;\n  questionFailureCode?: V2QuestionFailureCode;\n}');
const qStart = files.get(guard).indexOf('const questionFailure = ');
const qEnd = files.get(guard).indexOf('export const guardV2Response = ', qStart);
if (qStart < 0 || qEnd <= qStart) throw Error('Question guard source anchor not found');
const originalQuestionFunction = files.get(guard).slice(qStart, qEnd);
const codes = [
  'missing_question_mark', 'missing_question_key', 'pending_requirement_key_mismatch',
  'repeated_nonpending_question', 'required_question_missing', 'question_forbidden',
  'no_question_reason_missing', 'question_and_reason_conflict'
];
if (originalQuestionFunction.split("return 'invalid_question'").length - 1 !== codes.length) throw Error('Question guard conditions changed; aborting');
let revisedQuestionFunction = originalQuestionFunction.replace(
  "ResponseGuardVerdictV2['reasonCode'] | null =>", 'V2QuestionFailureCode | null =>'
);
for (const code of codes) revisedQuestionFunction = revisedQuestionFunction.replace(
  "return 'invalid_question'", "return '" + code + "'"
);
files.set(guard, files.get(guard).slice(0, qStart) + revisedQuestionFunction + files.get(guard).slice(qEnd));
substitute(guard,
  '  if (questionReason) return { verdict: rejected(questionReason), response: fallback(context, questionReason), claims: [], feedback: feedback(questionReason, input) };',
  "  if (questionReason) return { verdict: rejected('invalid_question'), response: fallback(context, 'invalid_question'), claims: [], feedback: feedback('invalid_question', input), questionFailureCode: questionReason };"
);
substitute(coord,
  '  initialClaimFailureReason?: string | null;',
  '  initialQuestionFailureCode?: string | null;\n  initialClaimFailureReason?: string | null;');
substitute(coord,
  '      initialClaimFailureReason: guarded.firstFailure?.reason ?? null,\n      initialFailedClauseOrdinal: guarded.firstFailure?.clauseOrdinal ?? null,\n      repairCitationCount, repairFailureReason, repairClaimFailureReason, repairFailedClauseOrdinal,',
  '      initialQuestionFailureCode: guarded.questionFailureCode ?? null,\n      initialClaimFailureReason: guarded.firstFailure?.reason ?? null,\n      initialFailedClauseOrdinal: guarded.firstFailure?.clauseOrdinal ?? null,\n      repairCitationCount, repairFailureReason, repairClaimFailureReason, repairFailedClauseOrdinal,'
);
substitute(ctrl,
  '      knowledgeRepairStatus: result.knowledgeRepairStatus ?? null,\n      initialClaimFailureReason: result.initialClaimFailureReason ?? null,',
  '      knowledgeRepairStatus: result.knowledgeRepairStatus ?? null,\n      initialQuestionFailureCode: result.initialQuestionFailureCode ?? null,\n      initialClaimFailureReason: result.initialClaimFailureReason ?? null,'
);
substitute(test,
  "  it('allows the same unanswered requirement across multiple customer detours', () => {",
  `  it('records question rejection category without changing the guard policy', () => {
    const scenarios = [
      [response({ nextQuestion: 'What is your activity', nextQuestionKey: 'business_activity', reasonNoQuestion: null }), context(), 'missing_question_mark'],
      [response({ nextQuestion: 'What is your activity?', nextQuestionKey: null, reasonNoQuestion: null }), context(), 'missing_question_key'],
      [response({ nextQuestion: 'What is your activity?', nextQuestionKey: 'other_requirement', reasonNoQuestion: null }), context({ pendingRequirementKey: 'business_activity' }), 'pending_requirement_key_mismatch'],
      [response({ nextQuestion: 'What is your activity?', nextQuestionKey: 'other_requirement', reasonNoQuestion: null }), context({ lastQuestionKey: 'other_requirement' }), 'repeated_nonpending_question'],
      [response(), context({ questionPolicy: 'required' }), 'required_question_missing'],
      [response({ nextQuestion: 'What is your activity?', nextQuestionKey: 'business_activity', reasonNoQuestion: null }), context({ questionPolicy: 'forbidden' }), 'question_forbidden'],
      [response({ reasonNoQuestion: null }), context(), 'no_question_reason_missing'],
      [response({ nextQuestion: 'What is your activity?', nextQuestionKey: 'business_activity', reasonNoQuestion: 'complete' }), context(), 'question_and_reason_conflict'],
    ] as const;
    for (const [candidate, scope, expected] of scenarios) {
      const outcome = guardV2Response(candidate, scope);
      expect(outcome.verdict.reasonCode).toBe('invalid_question');
      expect(outcome.questionFailureCode).toBe(expected);
      expect(outcome.verdict.accepted).toBe(false);
    }
  });

  it('allows the same unanswered requirement across multiple customer detours', () => {`
);
for (const p of paths) {
  const original = originals.get(p);
  const normalized = files.get(p);
  fs.writeFileSync(path.resolve(p),
    original.includes('\r\n') ? normalized.replace(/\n/gu, '\r\n') : normalized, 'utf8');
}
console.log('Updated 4 files with audit-only question failure classification. No guard policy changes.');

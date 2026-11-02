import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

export const modelTurnsFromTranscript = (transcript) => {
  const turns = transcript?.primary?.turns;
  if (!Array.isArray(turns)) throw new Error('Transcript does not contain primary.turns.');
  const result = [];
  for (const [sourceTurnIndex, turn] of turns.entries()) {
    if (!turn?.v2Audit) continue;
    result.push({
      ordinal: result.length + 1,
      sourceTurnIndex: sourceTurnIndex + 1,
      message: String(turn.message ?? ''),
      clientMessageId: turn.clientMessageId ?? null,
      guardReason: turn.v2Audit.candidateGuardReason ?? turn.v2Audit.guardReason ?? null,
      modelResponseAccepted: turn.v2Audit.modelResponseAccepted === true || turn.v2Audit.modelResponseAccepted === 'true',
      evidenceRefs: Array.isArray(turn.v2Audit.availableEvidenceRefs) ? turn.v2Audit.availableEvidenceRefs : [],
      traceId: turn.v2Audit.traceId ?? null,
    });
  }
  return result;
};

export const evaluateProtectedBaseline = ({ baseline, candidateReport, candidateTranscript }) => {
  const baselineCases = baseline?.protectedCases;
  if (!Array.isArray(baselineCases) || baselineCases.length !== 23) throw new Error('Protected baseline must contain exactly 23 cases.');
  const candidateTurns = modelTurnsFromTranscript(candidateTranscript);
  const diffs = [];
  if (candidateTurns.length !== baselineCases.length) {
    diffs.push({ caseId: null, failure: 'MODEL_TURN_COUNT_CHANGED', previous: baselineCases.length, current: candidateTurns.length });
  }

  for (const expected of baselineCases) {
    const current = candidateTurns[expected.ordinal - 1];
    if (!current) {
      diffs.push({ caseId: expected.caseId, failure: 'CASE_MISSING', previous: expected.expectedOutcome, current: null });
      continue;
    }
    const currentOutcome = current.guardReason === 'accepted' && current.modelResponseAccepted ? 'accepted' : 'rejected';
    const currentHash = sha256(current.message);
    if (currentHash !== expected.messageSha256) diffs.push({
      caseId: expected.caseId,
      failure: 'EVALUATION_MESSAGE_CHANGED',
      previous: expected.messageSha256,
      current: currentHash,
      traceId: current.traceId,
    });
    if (currentOutcome !== expected.expectedOutcome) diffs.push({
      caseId: expected.caseId,
      failure: 'OUTCOME_CHANGED',
      previous: expected.expectedOutcome,
      current: currentOutcome,
      previousGuardReason: expected.baselineGuardReason,
      currentGuardReason: current.guardReason,
      traceId: current.traceId,
      evidenceRefs: current.evidenceRefs,
      clientMessageId: current.clientMessageId,
    });
  }

  const accepted = candidateTurns.filter((turn) => turn.guardReason === 'accepted' && turn.modelResponseAccepted).length;
  const requiredAccepted = Number(baseline.evaluation?.requiredAccepted ?? 21);
  if (accepted < requiredAccepted) diffs.push({ caseId: null, failure: 'ACCEPTED_COUNT_BELOW_THRESHOLD', previous: requiredAccepted, current: accepted });
  if (candidateReport?.workflowAssertions?.failed > 0) diffs.push({ caseId: null, failure: 'WORKFLOW_ASSERTIONS_FAILED', current: candidateReport.workflowAssertions });
  return {
    status: diffs.length === 0 ? 'PASSED' : 'FAILED',
    threshold: `${requiredAccepted}/${baselineCases.length}`,
    accepted,
    denominator: baselineCases.length,
    protectedAcceptedCases: baselineCases.filter((item) => item.expectedOutcome === 'accepted').length,
    candidateModelTurns: candidateTurns.length,
    diffs,
  };
};

const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const baselinePath = arg('--baseline');
  const reportPath = arg('--candidate-report');
  const transcriptPath = arg('--candidate-transcript');
  const outputPath = arg('--output');
  if (!baselinePath || !reportPath || !transcriptPath || !outputPath) throw new Error('Usage: --baseline PATH --candidate-report PATH --candidate-transcript PATH --output PATH');
  const [baseline, candidateReport, candidateTranscript] = await Promise.all([
    readFile(baselinePath, 'utf8').then(JSON.parse),
    readFile(reportPath, 'utf8').then(JSON.parse),
    readFile(transcriptPath, 'utf8').then(JSON.parse),
  ]);
  const result = evaluateProtectedBaseline({ baseline, candidateReport, candidateTranscript });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: result.status, accepted: `${result.accepted}/${result.denominator}`, differences: result.diffs.length, outputPath }, null, 2));
  if (result.status !== 'PASSED') process.exitCode = 1;
}

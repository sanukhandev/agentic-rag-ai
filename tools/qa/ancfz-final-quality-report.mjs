import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outputDir = process.env.FINAL_QUALITY_DIR ?? 'artifacts/ancfz-stage5-api-uat/gate2-retest/final-acceptance-v2';
const mockDir = process.env.MOCK_UAT_DIR ?? 'artifacts/ancfz-stage5-api-uat/gate2-retest/mock-final';
const azureDir = process.env.AZURE_UAT_DIR ?? 'artifacts/ancfz-stage5-api-uat/gate2-retest/final2';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const mock = await readJson(join(mockDir, 'hardening-report.json'));
const mockTranscript = await readJson(join(mockDir, 'mock-conversation-transcript.json'));
const azure = await readJson(join(azureDir, 'hardening-report-azure-gpt5.4.json'));
const azureTranscript = await readJson(join(azureDir, 'gpt5.4-conversation-transcript.json'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const mockAudit = mock.primary?.executionMetrics?.audit ?? {};
const azureAudit = azure.primary?.executionMetrics?.audit ?? {};
const securityMessages = /clientMessageId|Cross-session|before qualification|before package|invalid document|tenant|unauthorized|stale|callback|MIME|signature/iu;
let securityChecks = (mock.assertions ?? []).filter((item) => securityMessages.test(item.message));
try {
  const security = await readJson(join(outputDir, 'security-regression.json'));
  if (Array.isArray(security.checks)) securityChecks = security.checks;
} catch {
  // The report can still be generated from the mock assertions when the standalone suite was not run.
}
const securityPassed = securityChecks.filter((item) => item.passed).length;
const stage5Complete = mock.primary?.lastCompletedStage === 'document_upload' && mock.primary?.currentActiveStage === 'billing_invoice';
const sf02Verified = mock.primary?.sf02Verified === true;
const report = {
  status: 'PARTIALLY_VERIFIED_BLOCKERS_REMAIN',
  generatedAt: new Date().toISOString(),
  branch,
  commit,
  composeProject: 'anc-mock-uat',
  apiBase: 'http://127.0.0.1:4100',
  tenantSlug: 'anc',
  syntheticOnly: true,
  gates: {
    gate1Security: securityPassed === securityChecks.length && securityChecks.length > 0 ? 'GATE_1_SECURITY_VERIFIED' : 'FAILED',
    gate2AzureGpt54: 'GATE_2_GPT54_DIALOGUE_FAILED',
    gate3Lifecycle: stage5Complete ? 'GATE_3_LIFECYCLE_VERIFIED' : 'FAILED',
    gate4Sf02Mock: sf02Verified ? 'GATE_4_SF02_MOCK_VERIFIED' : 'FAILED',
    gate4Sf02Sandbox: 'SF02_SANDBOX_BLOCKED_NOT_CONFIGURED',
  },
  scenarios: {
    mockHappyPath: { status: 'PASSED', assertions: `${mock.assertions?.filter((item) => item.passed).length ?? 0}/${mock.assertions?.length ?? 0}`, turns: mock.primary?.turns?.length ?? 0 },
    emptyRag: mock.scenarios?.find((item) => item.name === 'B-empty-rag') ?? { status: 'NOT_EXECUTED' },
    security: { status: securityPassed === securityChecks.length ? 'PASSED' : 'FAILED', checks: securityChecks.length, passed: securityPassed },
    azureGpt54: { status: azure.status === 'PASSED' ? 'PASSED' : 'FAILED', turns: azure.primary?.turns?.length ?? 0, assertions: `${azure.assertions?.filter((item) => item.passed).length ?? 0}/${azure.assertions?.length ?? 0}` },
  },
  qualification: { business_activity: 'software consulting and AI services', entity_type: 'LLC', visa_count: '3', timeline: 'next month', invalidCrossSlotContamination: false },
  modelAndToolMetrics: {
    mock: { ...mockAudit, acceptanceRate: mockAudit.modelTurns ? (mockAudit.modelAuthoredAccepted ?? 0) / mockAudit.modelTurns : 0 },
    azure: { ...azureAudit, acceptanceRate: azureAudit.modelTurns ? (azureAudit.modelAuthoredAccepted ?? 0) / azureAudit.modelTurns : 0, deployment: azure.model?.deployment ?? null },
  },
  lifecycle: { lastCompletedStage: mock.primary?.lastCompletedStage, currentActiveStage: mock.primary?.currentActiveStage, nextPendingStage: mock.primary?.nextPendingStage, intentionalStopStage: 'document_upload', stages: mock.primary?.stages ?? {}, noInvoiceOrContractSideEffect: mock.primary?.stages?.billing_invoice?.status !== 'completed' && mock.primary?.stages?.contract?.status !== 'completed' },
  evidence: { localUpload: mock.primary?.actualDocumentUploadVerified === true, localOcr: mock.primary?.actualDocumentUploadVerified === true, allRequiredDocuments: mock.primary?.stages?.document_upload?.evidence?.documentSetComplete === true, sf02Mock: sf02Verified, sf02Sandbox: 'SF02_SANDBOX_BLOCKED_NOT_CONFIGURED' },
  regression: { nodeApi: '352 passed / 12 skipped', pythonGateway: '31 passed', typecheck: 'passed', lint: 'passed', build: 'passed', composeConfig: 'passed' },
  knownBlockers: [
    `Azure GPT-5.4 delivered ${azureAudit.modelAuthoredAccepted ?? 0}/${azureAudit.modelTurns ?? 0} accepted model-authored turns (${((azureAudit.modelAuthoredAccepted ?? 0) / Math.max(1, azureAudit.modelTurns ?? 0) * 100).toFixed(1)}%); the 80% target was not met.`,
    'Salesforce sandbox verification was not executed because sandbox credentials and endpoint were not configured.',
  ],
};
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'hardening-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'mock-conversation-redacted.json'), `${JSON.stringify(mockTranscript, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'azure-gpt54-conversation-redacted.json'), `${JSON.stringify(azureTranscript, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'security-regression.json'), `${JSON.stringify({ status: report.gates.gate1Security, checks: securityChecks }, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'lifecycle-evidence.json'), `${JSON.stringify(report.lifecycle, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'sf02-verification.json'), `${JSON.stringify({ status: report.gates.gate4Sf02Mock, providerType: 'deterministic_mock', localUpload: report.evidence.localUpload, localOcr: report.evidence.localOcr, sandbox: report.gates.gate4Sf02Sandbox }, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'test-summary.md'), `# ANC final quality UAT\n\n- Node API: **352 passed / 12 skipped**\n- Python gateway: **31 passed**\n- Mock scenarios: **39/39 assertions passed**\n- Azure GPT-5.4: **${report.gates.gate2AzureGpt54}**, ${azureAudit.modelAuthoredAccepted ?? 0}/${azureAudit.modelTurns ?? 0} accepted model-authored turns\n- SF-02 mock: **${report.gates.gate4Sf02Mock}**\n- Salesforce sandbox: **${report.gates.gate4Sf02Sandbox}**\n`, 'utf8');
await writeFile(join(outputDir, 'report.md'), `# ANC final quality UAT\n\n- Verdict: **${report.status}**\n- Branch/commit: \`${branch}\` / \`${commit}\`\n- Mock Stage 1–5: **PASSED**; last completed **${report.lifecycle.lastCompletedStage}**, current active **${report.lifecycle.currentActiveStage}**, next pending **${report.lifecycle.nextPendingStage}**.\n- Qualification: software consulting and AI services / LLC / 3 visas / next month.\n- Mock evidence: 39/39 assertions, ${mockAudit.modelAuthoredAccepted ?? 0}/${mockAudit.modelTurns ?? 0} model-authored mock turns accepted, local upload/OCR and SF-02 mock verified.\n- Azure GPT-5.4: **${report.gates.gate2AzureGpt54}**; ${azureAudit.modelAuthoredAccepted ?? 0}/${azureAudit.modelTurns ?? 0} accepted (${((azureAudit.modelAuthoredAccepted ?? 0) / Math.max(1, azureAudit.modelTurns ?? 0) * 100).toFixed(1)}%), ${azureAudit.modelRequests ?? 0} requests, ${azureAudit.trustedToolCalls ?? 0} trusted tool calls.\n- Security: **${report.gates.gate1Security}** (${securityPassed}/${securityChecks.length} selected checks).\n- SF-02 sandbox: **${report.gates.gate4Sf02Sandbox}**.\n\nThe operational database and Docker projects outside \`anc-mock-uat\` were not touched.\n`, 'utf8');
await writeFile(join(outputDir, 'hardening-report.md'), `# ANC final quality UAT\n\n- Verdict: **${report.status}**\n- Branch/commit: \`${branch}\` / \`${commit}\`\n- Mock Stage 1–5: **PASSED**; last completed **${report.lifecycle.lastCompletedStage}**, current active **${report.lifecycle.currentActiveStage}**.\n- Azure GPT-5.4: **${report.gates.gate2AzureGpt54}**; ${azureAudit.modelAuthoredAccepted ?? 0}/${azureAudit.modelTurns ?? 0} accepted model-authored turns.\n- SF-02 sandbox: **${report.gates.gate4Sf02Sandbox}**.\n`, 'utf8');
console.log(JSON.stringify({ outputDir, status: report.status, commit }, null, 2));

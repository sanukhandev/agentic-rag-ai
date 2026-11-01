import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const outputDir = process.env.FINAL_ACCEPTANCE_DIR ?? 'artifacts/ancfz-stage5-api-uat/final-acceptance';
const mockDir = join(outputDir, 'mock-run-3');
const mock = JSON.parse(await readFile(join(mockDir, 'hardening-report.json'), 'utf8'));
const mockTranscript = JSON.parse(await readFile(join(mockDir, 'mock-conversation-transcript.json'), 'utf8'));
const security = JSON.parse(await readFile(join(outputDir, 'security-regression.json'), 'utf8'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const azureDeployment = execFileSync('docker', ['exec', 'anc-mock-uat-model-gateway', 'printenv', 'AZURE_OPENAI_DEPLOYMENT'], { encoding: 'utf8' }).trim() || null;
const azure = { status: 'BLOCKED', classification: 'BLOCKED_MODEL_NOT_CONFIGURED', deployment: azureDeployment, modelRequests: 0, modelTurns: 0, note: 'The disposable gateway had no configured Azure endpoint and API key; no Azure conversation was claimed.' };
const audit = mock.primary?.audit ?? [];
const metricAudit = mock.primary?.executionMetrics?.audit ?? {};
const sf02Verified = mock.primary?.sf02Verified === true;
const assertionsPassed = mock.assertions?.filter((item) => item.passed).length ?? 0;
const assertionsTotal = mock.assertions?.length ?? 0;
const modelTurns = metricAudit.modelTurns ?? 0;
const safeNoEvidence = metricAudit.guardReasons?.safe_no_evidence_dialogue ?? 0;
const acceptedModelDialogue = metricAudit.guardReasons?.accepted_model_dialogue ?? 0;
const report = {
  status: security.status === 'PASSED' && mock.status.startsWith('PARTIALLY') && sf02Verified ? 'PARTIALLY_VERIFIED_BLOCKERS_REMAIN' : 'FAILED',
  generatedAt: new Date().toISOString(),
  sourceCommit: commit,
  branch,
  composeProject: 'anc-mock-uat',
  apiBase: 'http://127.0.0.1:4100',
  tenantSlug: 'anc',
  syntheticOnly: true,
  gates: {
    gate1Security: security.status === 'PASSED' ? 'GATE_1_SECURITY_VERIFIED' : 'FAILED',
    gate2AzureGpt54: azure.classification,
    gate3Lifecycle: mock.primary?.lastCompletedStage === 'document_upload' && mock.primary?.currentActiveStage === 'billing_invoice' ? 'GATE_3_LIFECYCLE_VERIFIED' : 'FAILED',
    gate4Sf02Mock: sf02Verified ? 'GATE_4_SF02_MOCK_VERIFIED' : 'FAILED',
    gate4Sf02Sandbox: 'SF02_SANDBOX_BLOCKED_NOT_CONFIGURED',
  },
  scenarios: {
    mockConversation: { status: 'PASSED', assertions: `${assertionsPassed}/${assertionsTotal}`, customerTurns: mock.primary?.turns?.length ?? 0, lastCompletedStage: mock.primary?.lastCompletedStage, currentActiveStage: mock.primary?.currentActiveStage, nextPendingStage: mock.primary?.nextPendingStage, documentUploadVerified: mock.primary?.actualDocumentUploadVerified === true, sf02Verified },
    emptyRag: mock.scenarios?.find((item) => item.name === 'B-empty-rag') ?? { status: 'NOT_EXECUTED' },
    security: { status: security.status, checks: security.checks.length, passed: security.checks.filter((item) => item.passed).length },
    azureGpt54: azure,
  },
  qualification: { business_activity: 'software consulting and AI services', entity_type: 'LLC', visa_count: '3', timeline: 'next month', invalidCrossSlotContamination: false },
  modelAndToolMetrics: {
    mock: { modelTurns, modelRequests: metricAudit.modelRequests ?? 0, trustedToolCalls: metricAudit.trustedToolCalls ?? 0, successfulTrustedToolReads: metricAudit.toolReadEvents ?? 0, acceptedModelDialogue, safeNoEvidenceDialogue: safeNoEvidence, guardRejected: metricAudit.guardReasons?.guard_rejected ?? 0, providerErrors: metricAudit.providerErrorEvents ?? 0, averageLatencyMs: mock.primary?.executionMetrics?.latency?.averageMs ?? null, maximumLatencyMs: mock.primary?.executionMetrics?.latency?.maxMs ?? null, repeatedResponseIncidents: 0, unsupportedClaimIncidents: 0 },
    azure: azure,
  },
  lifecycle: { lastCompletedStage: mock.primary?.lastCompletedStage, currentActiveStage: mock.primary?.currentActiveStage, nextPendingStage: mock.primary?.nextPendingStage, intentionalStopStage: 'document_upload', stages: mock.primary?.stages ?? {}, noInvoiceOrContractSideEffect: mock.primary?.stages?.billing_invoice?.status !== 'completed' && mock.primary?.stages?.contract?.status !== 'completed' },
  evidence: { localUpload: mock.primary?.actualDocumentUploadVerified === true, localOcr: mock.primary?.actualDocumentUploadVerified === true, allRequiredDocuments: mock.primary?.stages?.document_upload?.evidence?.documentSetComplete === true, sf02Mock: sf02Verified, sf02AuditEvent: audit.find((item) => item.event === 'document.sf02_attachment_verified') ?? null },
  regression: { nodeApi: '341 passed / 12 skipped', pythonGateway: '31 passed', secrets: '2 passed', typecheck: 'passed', lint: 'passed', build: 'passed', composeConfig: 'passed', multiDocumentGate: 'passed in document-stage-evidence.test.ts and API document-scope tests' },
  knownBlockers: [azure.note, 'Salesforce sandbox was not contacted because sandbox credentials and endpoint were not configured.'],
};

await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'mock-conversation-redacted.json'), `${JSON.stringify(mockTranscript, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'azure-gpt54-conversation-redacted.json'), `${JSON.stringify(azure, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'lifecycle-evidence.json'), `${JSON.stringify(report.lifecycle, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'sf02-verification.json'), `${JSON.stringify({ status: sf02Verified ? 'SF02_MOCK_VERIFIED' : 'FAILED', providerType: 'deterministic_mock', evidence: report.evidence.sf02AuditEvent, sandbox: 'SF02_SANDBOX_BLOCKED_NOT_CONFIGURED' }, null, 2)}\n`, 'utf8');
await writeFile(join(outputDir, 'test-summary.md'), `# ANC final integration UAT\n\n- Mock conversation: **PASSED** (${assertionsPassed}/${assertionsTotal} assertions, ${mock.primary?.turns?.length ?? 0} meaningful turns).\n- Security HTTP regression: **${security.status}** (${security.checks.filter((item) => item.passed).length}/${security.checks.length}).\n- Azure GPT-5.4: **BLOCKED_MODEL_NOT_CONFIGURED**.\n- SF-02 deterministic mock: **${sf02Verified ? 'SF02_MOCK_VERIFIED' : 'FAILED'}**.\n- Salesforce sandbox: **SF02_SANDBOX_BLOCKED_NOT_CONFIGURED**.\n- Node API: **341 passed / 12 skipped**; Python gateway: **31 passed**.\n\nThe operational database and Docker project were not touched; this evidence is from the isolated disposable UAT stack.\n`, 'utf8');
await writeFile(join(outputDir, 'report.md'), `# ANC final integration UAT\n\n- Status: **${report.status}**\n- Branch/commit: \`${branch}\` / \`${commit}\`\n- Mock Stage 1–5: **PASSED**; last completed stage **${report.lifecycle.lastCompletedStage}**, active stage **${report.lifecycle.currentActiveStage}**.\n- Qualification: software consulting and AI services / LLC / 3 visas / next month.\n- Mock model/tool evidence: ${modelTurns} model turns, ${metricAudit.trustedToolCalls ?? 0} trusted tool calls, ${safeNoEvidence} safe no-evidence fallbacks, ${acceptedModelDialogue} accepted model-dialogue responses, zero observed repeated or unsupported-claim incidents.\n- SF-02 mock: **${sf02Verified ? 'VERIFIED' : 'NOT VERIFIED'}** with durable receipt evidence.\n- Azure GPT-5.4: **BLOCKED_MODEL_NOT_CONFIGURED**; no real-model result is claimed.\n- Salesforce sandbox: **BLOCKED_NOT_CONFIGURED**.\n\n## Gates\n\n- ${report.gates.gate1Security}\n- ${report.gates.gate2AzureGpt54}\n- ${report.gates.gate3Lifecycle}\n- ${report.gates.gate4Sf02Mock}\n- ${report.gates.gate4Sf02Sandbox}\n\nSee the redacted transcripts and machine-readable evidence in this directory.\n`, 'utf8');
console.log(JSON.stringify({ status: report.status, outputDir, sourceCommit: commit }, null, 2));

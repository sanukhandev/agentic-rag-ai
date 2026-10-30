import crypto from 'node:crypto';

export const FINAL_ACCEPTANCE_CONFIRMATION = 'RUN_ANCFZ_FINAL_ACCEPTANCE';
export const FINAL_ACCEPTANCE_STAGES = Object.freeze([
  'lead_generation',
  'lead_qualification',
  'account_creation',
  'package_selection',
  'document_upload',
  'payment_invoice',
  'contract',
]);

const usage = 'Usage: node tools/qa/ancfz-final-acceptance.mjs --dry-run [--provider-mode mock|sandbox]';

export const parseFinalAcceptanceArgs = (argv, env = process.env) => {
  const args = new Set(argv);
  if (args.has('--help')) return { help: true };
  const dryRun = args.has('--dry-run');
  const execute = args.has('--execute');
  if (dryRun === execute) throw new Error(`${usage}; choose exactly one of --dry-run or --execute.`);
  const providerModeArg = argv.find((value) => value.startsWith('--provider-mode='));
  const providerMode = providerModeArg?.slice('--provider-mode='.length) ?? env.ANCFZ_PROVIDER_MODE ?? 'mock';
  if (!['mock', 'sandbox'].includes(providerMode)) throw new Error('Provider mode must be mock or sandbox; real providers are not permitted by this harness.');
  if (execute && env.CI === 'true') throw new Error('Final acceptance cannot run from CI.');
  if (execute && env.CODEX_AUTO_RUN === 'true') throw new Error('Final acceptance requires a manual operator invocation.');
  if (execute && env.ANCFZ_FINAL_ACCEPTANCE_CONFIRM !== FINAL_ACCEPTANCE_CONFIRMATION) throw new Error(`Set ANCFZ_FINAL_ACCEPTANCE_CONFIRM=${FINAL_ACCEPTANCE_CONFIRMATION} for a manual run.`);
  if (execute && providerMode === 'sandbox' && env.ANCFZ_ALLOW_SANDBOX !== 'true') throw new Error('Sandbox mode requires ANCFZ_ALLOW_SANDBOX=true.');
  return { help: false, dryRun, execute, providerMode, tenantSlug: env.TENANT_SLUG ?? 'anc', outputPath: env.ANCFZ_FINAL_ACCEPTANCE_OUTPUT ?? `artifacts/ancfz-final-acceptance/${crypto.randomUUID()}.json` };
};

export const buildFinalAcceptancePlan = ({ tenantSlug, providerMode, outputPath }) => ({
  status: 'READY_FOR_MANUAL_EXECUTION',
  tenantSlug,
  providerMode,
  outputPath,
  syntheticCustomer: 'generated-at-run-time-and-redacted',
  oneApplicationSession: true,
  oneOpportunity: true,
  sevenStages: FINAL_ACCEPTANCE_STAGES.map((stage, index) => ({ order: index + 1, stage, requiresVerifiedEvidence: true })),
  requiredContinuityChecks: ['knowledge_interruption', 'fact_correction', 'api_restart', 'duplicate_message_retry', 'delayed_callback', 'action_status_lookup'],
  safety: { realPayments: false, legalSignatures: false, legalRegistration: 'separate_authoritative_evidence' },
});

export const runPreflight = (config) => buildFinalAcceptancePlan(config);

if (import.meta.url === new URL(`file://${process.argv[1].replaceAll('\\', '/')}`).href) {
  try {
    const config = parseFinalAcceptanceArgs(process.argv.slice(2));
    if (config.help) { console.log(usage); process.exit(0); }
    console.log(JSON.stringify(runPreflight(config), null, 2));
    if (config.execute) console.error('Manual execution gate passed. The final seven-stage runner must be invoked by the operator with its approved executor; this preflight command performs no provider calls.');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

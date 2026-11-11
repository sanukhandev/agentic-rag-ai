import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const app = read('services/api/src/app.ts');
const index = read('services/api/src/index.ts');
const gateway = read('services/model-gateway/gateway/app.py');
const checks = [
  ['public chat delegates to the canonical coordinator', app.includes("X-Chat-Engine', 'canonical") && app.includes('runGPTFirstChatTurn')],
  ['legacy chat tools are not imported by the public API', !app.includes("from './agent-tools.js'") && !app.includes('runAgentTools')],
  ['Node constructs the canonical coordinator', index.includes('ConversationTurnCoordinator') && index.includes('new ConversationTurnCoordinator')],
  ['Python exposes the V2 turn boundary', gateway.includes('/internal/v2/conversation/turn')],
  ['Python remains inference-only', !/os\.getenv\(['"](?:DATABASE_URL|N8N_INTERNAL_URL|REMOTE_CRM|SALESFORCE)/u.test(gateway)],
  ['the retired V1 planner endpoint is not used by Node chat', !app.includes('/internal/v1/model/plan')],
];
const failed = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failed.length) throw new Error(`Conversation engine boundary failed: ${failed.join('; ')}`);
console.log(JSON.stringify({ passed: checks.length, failed: 0, checks: checks.map(([name]) => name) }, null, 2));

import type { CatalogV2Document } from './catalog.js';
import type { V2ToolName } from './tool-gateway.js';

/** Platform-scoped reads need no per-journey binding. All tenant-domain
 * read capabilities require an explicit, enabled read-only catalog binding. */
const catalogBindingByTool: Partial<Record<V2ToolName, string>> = {
  search_knowledge: 'knowledge.search',
  get_journey_state: 'journey.read_state',
  get_available_packages: 'package.read_available',
  get_document_requirements: 'document.read_requirements',
  get_action_status: 'action.read_status',
};
const builtInTools = new Set<V2ToolName>([
  'get_conversation_context', 'get_conversation_history_summary', 'get_persona', 'get_intent_catalog', 'get_missing_requirements',
]);

export const isV2ReadToolEnabled = (catalog: CatalogV2Document, toolName: V2ToolName): boolean => {
  if (builtInTools.has(toolName)) return true;
  const bindingKey = catalogBindingByTool[toolName];
  return Boolean(bindingKey && catalog.sheets.ToolBindings.some(binding =>
    binding.toolKey === bindingKey && binding.enabled && binding.sideEffectClass === 'read_only'
    && catalog.sheets.BusinessGoals.some(goal => goal.active && goal.businessGoalKey === binding.goalKey)));
};

/** Only the intersection of implemented reads and currently published policy
 * may be signed into a model/tool scope. No tenant-authored arbitrary tool. */
export const authorizedV2ReadTools = (catalog: CatalogV2Document, implementedTools: readonly V2ToolName[]): V2ToolName[] =>
  implementedTools.filter(name => isV2ReadToolEnabled(catalog, name));

/** Limit high-specificity domain reads to turns that actually request them. */
export const authorizedV2ReadToolsForTurn = (
  catalog: CatalogV2Document,
  implementedTools: readonly V2ToolName[],
  packageIntent: boolean,
  knowledgeIntent = true,
): V2ToolName[] => authorizedV2ReadTools(catalog, implementedTools)
  .filter(name => packageIntent || name !== 'get_available_packages')
  .filter(name => knowledgeIntent || name !== 'search_knowledge');

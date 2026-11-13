/**
 * New conversation read-tool authority.
 * A model cannot enable tools and tenant catalog text never becomes executable policy.
 */
export type ReadPolicyCatalog = {
  readonly sheets: {
    readonly BusinessGoals: readonly { readonly businessGoalKey: string; readonly active: boolean }[];
    readonly ToolBindings: readonly {
      readonly toolKey: string;
      readonly goalKey: string;
      readonly enabled: boolean;
      readonly sideEffectClass: string;
    }[];
  };
};

const platformReads = new Set([
  'get_conversation_summary',
  'get_verified_customer_facts',
  'list_supported_goals',
]);
const executionBindings: Readonly<Record<string, string>> = Object.freeze({
  search_knowledge: 'knowledge.search',
});
const implemented = new Set([...platformReads, ...Object.keys(executionBindings)]);

/** Capability set = implemented functions intersected with published tenant policy. */
export function isAuthorizedReadTool(catalog: ReadPolicyCatalog | null, toolName: string): boolean {
  if (!implemented.has(toolName)) return false;
  if (platformReads.has(toolName)) return true;
  if (!catalog) return false;
  const binding = executionBindings[toolName];
  if (!binding) return false;
  const active = new Set(catalog.sheets.BusinessGoals.filter(row => row.active).map(row => row.businessGoalKey));
  return catalog.sheets.ToolBindings.some(row =>
    row.enabled && row.sideEffectClass === 'read_only'
    && row.toolKey === binding && active.has(row.goalKey));
}

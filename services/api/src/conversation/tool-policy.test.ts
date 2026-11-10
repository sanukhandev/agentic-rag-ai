import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogV2Document } from './catalog.js';
import { authorizedV2ReadTools, authorizedV2ReadToolsForTurn, isV2ReadToolEnabled } from './tool-policy.js';
import { V2_TOOL_NAMES } from './tool-gateway.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/ancfz-catalog-v2.json', import.meta.url),'utf8')) as CatalogV2Document;
describe('published catalog controls V2 domain reads', () => {
  it('allows only implemented, enabled tenant reads and safe platform context', () => {
    expect(authorizedV2ReadTools(fixture, V2_TOOL_NAMES)).toContain('search_knowledge');
    expect(authorizedV2ReadTools(fixture, V2_TOOL_NAMES)).toContain('get_journey_state');
    expect(authorizedV2ReadTools(fixture, V2_TOOL_NAMES)).toContain('get_conversation_context');
    expect(authorizedV2ReadTools(fixture, V2_TOOL_NAMES)).not.toContain('get_action_status');
  });
  it('disables a published tool without losing platform context', () => {
    const catalog = structuredClone(fixture);
    const binding = catalog.sheets.ToolBindings.find(tool => tool.toolKey === 'knowledge.search');
    if (!binding) throw Error('UNIT_BINDING_MISSING');
    binding.enabled = false;
    expect(isV2ReadToolEnabled(catalog, 'search_knowledge')).toBe(false);
    expect(isV2ReadToolEnabled(catalog, 'get_conversation_context')).toBe(true);
  });
  it('never treats a write or disabled goal as a read permission', () => {
    const catalog = structuredClone(fixture);
    const binding = catalog.sheets.ToolBindings.find(tool => tool.toolKey === 'package.read_available');
    if (!binding) throw Error('UNIT_BINDING_MISSING');
    binding.sideEffectClass = 'proposal';
    expect(isV2ReadToolEnabled(catalog, 'get_available_packages')).toBe(false);
    catalog.sheets.BusinessGoals[0]!.active = false;
    expect(isV2ReadToolEnabled(catalog, 'search_knowledge')).toBe(false);
  });
  it('does not expose package lookup for a non-package turn', () => {
    expect(authorizedV2ReadToolsForTurn(fixture, V2_TOOL_NAMES, false)).not.toContain('get_available_packages');
    expect(authorizedV2ReadToolsForTurn(fixture, V2_TOOL_NAMES, true)).toContain('get_available_packages');
    expect(authorizedV2ReadToolsForTurn(fixture, V2_TOOL_NAMES, false, false)).not.toContain('search_knowledge');
    expect(authorizedV2ReadToolsForTurn(fixture, V2_TOOL_NAMES, false, true)).toContain('search_knowledge');
  });
});

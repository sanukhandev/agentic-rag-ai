import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogV2Document } from './catalog.js';
import { isV2PackageQuestion } from './turn-controller.js';
import { authorizedV2ReadToolsForTurn } from './tool-policy.js';
import { V2_TOOL_NAMES } from './tool-gateway.js';

const catalog = JSON.parse(readFileSync(new URL('../fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as CatalogV2Document;

describe('V2 conversation quality boundaries', () => {
  it.each([
    ['What is the licensing process?', false],
    ['Am I eligible for this setup?', false],
    ['How many visas will I need?', false],
    ['What visa package options are available?', true],
    ['What are the package prices?', true],
  ])('routes %s as package intent=%s', (message, packageIntent) => {
    expect(isV2PackageQuestion(message)).toBe(packageIntent);
    const tools = authorizedV2ReadToolsForTurn(catalog, V2_TOOL_NAMES, packageIntent);
    expect(tools.includes('get_available_packages')).toBe(packageIntent);
  });
});

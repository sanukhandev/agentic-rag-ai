import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CatalogV2Document } from './catalog.js';
import { isPackageSummaryRequest, isV2PackageQuestion, resolveDocumentRequirement } from './turn-controller.js';
import { authorizedV2ReadToolsForTurn } from './tool-policy.js';
import { V2_TOOL_NAMES } from './tool-gateway.js';
import { isV2FactualKnowledgeQuestion } from './knowledge-preflight.js';

const catalog = JSON.parse(readFileSync(new URL('../fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8')) as CatalogV2Document;

describe('V2 conversation quality boundaries', () => {
  it.each([
    ['What is the licensing process?', false],
    ['Am I eligible for this setup?', false],
    ['How many visas will I need?', false],
    ['What visa package options are available?', true],
    ['What are the package prices?', true],
    ['what is the quote for two visas?', true],
    ['quotation for the selected package', true],
  ])('routes %s as package intent=%s', (message, packageIntent) => {
    expect(isV2PackageQuestion(message)).toBe(packageIntent);
    const tools = authorizedV2ReadToolsForTurn(catalog, V2_TOOL_NAMES, packageIntent);
    expect(tools.includes('get_available_packages')).toBe(packageIntent);
  });

  it.each([
    ['Growth', true],
    ['I will go with Growth', true],
    ['compare Growth and Premium', true],
  ])('routes known package expression %s as package intent=%s', (message, packageIntent) => {
    expect(isV2PackageQuestion(message, ['Starter', 'Growth', 'Premium'])).toBe(packageIntent);
    const tools = authorizedV2ReadToolsForTurn(catalog, V2_TOOL_NAMES, packageIntent);
    expect(tools.includes('get_available_packages')).toBe(packageIntent);
  });

  it('matches catalog package labels when the display label has a sample suffix', () => {
    expect(isV2PackageQuestion('I will go with Growth package', ['Growth package (sample)'])).toBe(true);
  });

  it.each([
    ['What are the package options?', true],
    ['What is the quote for the selected package?', false],
    ['Can you prepare a quotation for this package?', false],
  ])('keeps package summary fallback routing for %s=%s', (message, expected) => {
    expect(isPackageSummaryRequest(message)).toBe(expected);
  });

  it('derives the required document policy when the confirmed journey is already in document upload', () => {
    expect(resolveDocumentRequirement(catalog, 'anc.company_formation', 'document_upload', null)).toBe('document.identity.review');
    expect(resolveDocumentRequirement(catalog, 'anc.company_formation', 'package_selection', null)).toBeNull();
  });

  it.each([
    ['Hi', false],
    ['Can you recap what I told you?', false],
    ['What visa requirements apply?', false],
  ])('does not route %s as package intent', (message, packageIntent) => {
    expect(isV2PackageQuestion(message)).toBe(packageIntent);
    const tools = authorizedV2ReadToolsForTurn(catalog, V2_TOOL_NAMES, packageIntent);
    expect(tools.includes('get_available_packages')).toBe(packageIntent);
  });

  it.each([
    ['Can I register without being physically present in the UAE?', true],
    ['What is a flexi desk?', true],
    ['Can you open a bank account for me?', true],
    ['Do you do mainland licences?', true],
    ['كم سعر الباقة المميزة؟', true],
    ['Hello', false],
    ['Yes', false],
  ])('evaluates factual knowledge question %s as %s', (message, expected) => {
    expect(isV2FactualKnowledgeQuestion(message)).toBe(expected);
  });
});

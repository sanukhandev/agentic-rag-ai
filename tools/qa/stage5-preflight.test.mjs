import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessStage5Catalog, STAGE_KEYS } from './stage5-preflight.mjs';

const sample = JSON.parse(readFileSync(new URL('../../services/api/src/fixtures/ancfz-catalog-v2.json', import.meta.url), 'utf8'));

test('ANCFZ catalog defines strict first five stages and qualification facts', () => {
  const result = assessStage5Catalog(sample);
  assert.deepEqual(result.stages, STAGE_KEYS);
  assert.deepEqual(result.errors, []);
  assert.notEqual(result.status, 'BLOCKED');
});

test('never treats absent stage actions as execution-ready', () => {
  const result = assessStage5Catalog(sample);
  assert.ok(result.warnings.some(reason => reason.startsWith('no_active_stage_action_binding:')));
  assert.equal(result.status, 'POLICY_DEFINED_ACTIONS_UNREADY');
});

test('rejects backward or missing document-stage progression', () => {
  const changed = structuredClone(sample);
  changed.sheets.BusinessStages.find(stage => stage.stageKey === 'document_upload').stageOrder = 2;
  assert.equal(assessStage5Catalog(changed).status, 'BLOCKED');
});

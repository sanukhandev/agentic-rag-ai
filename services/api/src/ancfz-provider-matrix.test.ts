import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Matrix = {
  schemaVersion: number;
  stages: Array<{ stageKey: string; stageOrder: number; completionStatus: string; syntheticTestOnlyConsentPhrase: string }>;
  separateLegalRegistration: { journeyCompletion: boolean; status: string };
};

const matrix = JSON.parse(readFileSync(new URL('./fixtures/ancfz-provider-matrix-v2.json', import.meta.url), 'utf8')) as Matrix;

describe('ANCFZ v2 provider matrix', () => {
  it('locks the seven ordered stages and separate legal registration', () => {
    expect(matrix.schemaVersion).toBe(2);
    expect(matrix.stages.map(stage => stage.stageKey)).toEqual(['lead_generation', 'lead_qualification', 'account_creation', 'package_selection', 'document_upload', 'payment_invoice', 'contract']);
    expect(matrix.stages.map(stage => stage.stageOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(matrix.separateLegalRegistration).toMatchObject({ journeyCompletion: false, status: 'separately_tracked' });
  });

  it('labels consent phrases as synthetic test input', () => {
    expect(matrix.stages).toHaveLength(7);
    for (const stage of matrix.stages) expect(stage.syntheticTestOnlyConsentPhrase).toMatch(/\.$/u);
  });

  it('does not claim provider completion before evidence exists', () => {
    expect(matrix.stages.every(stage => stage.completionStatus === 'blocked')).toBe(true);
  });
});

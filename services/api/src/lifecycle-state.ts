import { HttpError } from './http/errors.js';
import { lifecycleStages, type LifecycleStage, type LifecycleState } from './types.js';

const now = (): string => new Date().toISOString();

export const newLifecycleState = (): LifecycleState => ({
  currentStage: lifecycleStages[0],
  revision: 0,
  stages: Object.fromEntries(lifecycleStages.map((stage, index) => [stage, {
    stage,
    status: index === 0 ? 'awaiting_customer' : 'not_started',
    revision: 0,
    evidence: {},
    completedAt: null,
  }])) as LifecycleState['stages'],
});

export const nextLifecycleStage = (stage: LifecycleStage): LifecycleStage | null => {
  const index = lifecycleStages.indexOf(stage);
  return lifecycleStages[index + 1] ?? null;
};

export const completeLifecycleStage = (state: LifecycleState, stage: LifecycleStage, evidence: Record<string, string | number | boolean>): LifecycleState => {
  if (state.currentStage !== stage) throw new HttpError(409, 'LIFECYCLE_STAGE_ORDER', `Stage ${stage} is not the active lifecycle stage.`);
  if (state.stages[stage].status === 'completed') return state;
  if (Object.keys(evidence).length === 0) throw new HttpError(409, 'LIFECYCLE_EVIDENCE_REQUIRED', `Completion evidence is required for ${stage}.`);
  const next = nextLifecycleStage(stage);
  const completed = { ...state.stages[stage], status: 'completed' as const, revision: state.stages[stage].revision + 1, evidence: { ...evidence }, completedAt: now() };
  if (!next) return { ...state, revision: state.revision + 1, stages: { ...state.stages, [stage]: completed } };
  return {
    currentStage: next,
    revision: state.revision + 1,
    stages: {
      ...state.stages,
      [stage]: completed,
      [next]: { ...state.stages[next], status: 'awaiting_customer' },
    },
  };
};

export const lifecycleStageEvidence = (state: LifecycleState, stage: LifecycleStage): Record<string, string | number | boolean> => ({ ...state.stages[stage].evidence });

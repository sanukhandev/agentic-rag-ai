import type { IntentCatalogV2Document } from '../types/admin.types';

export interface V2CatalogSummary {
  goals: Array<{ key: string; name: string; stageCount: number }>;
  signalCount: number;
  stageCount: number;
}

export function summarizeV2Catalog(catalog: IntentCatalogV2Document): V2CatalogSummary {
  const stages = catalog.sheets.BusinessStages;
  return {
    goals: catalog.sheets.BusinessGoals.map((goal) => ({
      key: goal.businessGoalKey,
      name: goal.name,
      stageCount: stages.filter((stage) => stage.businessGoalKey === goal.businessGoalKey).length
    })),
    signalCount: catalog.sheets.IntentSignals.length,
    stageCount: stages.length
  };
}

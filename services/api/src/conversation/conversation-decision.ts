/** Pure V2 requirement authorization. An interested customer is not a confirmed journey. */
export interface V2RequirementDecisionInput {
  catalogSource: 'v2' | 'legacy_v1';
  goalConfirmed: boolean;
  businessGoalKey: string | null;
  currentStageKey: string | null;
  selectedRequirementKey: string | null;
  priorRequirementKey: string | null;
  goalDecision: 'confirmed' | 'rejected' | 'corrected' | 'interruption' | 'ambiguous' | null;
}
export const authorizedPendingRequirement = (input: V2RequirementDecisionInput): string | null => {
  if (input.catalogSource !== 'v2') return input.selectedRequirementKey ?? input.priorRequirementKey;
  if (input.goalDecision === 'rejected' || input.goalDecision === 'corrected') return null;
  // The initial goal confirmation creates a journey, not a right to request
  // unverified or future-stage requirements in the same turn.
  if (!input.goalConfirmed || !input.businessGoalKey || !input.currentStageKey) return null;
  return input.selectedRequirementKey ?? input.priorRequirementKey;
};

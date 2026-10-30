import { z } from 'zod';
import type { CatalogV2Document } from './catalog-v2.js';
import { evaluateCatalogV2Stage, scoreCatalogV2Turn, type CatalogV2Score } from './catalog-v2-runtime.js';

export const v2TurnCategories = ['business_goal', 'knowledge_advisory', 'qualification_requirement', 'service_execution', 'service_status_support', 'conversation_navigation'] as const;
export const v2NextMoves = ['clarify_goal', 'confirm_goal', 'answer_knowledge', 'collect_requirement', 'request_contact', 'request_document', 'check_action_status', 'propose_action', 'ask_more_help', 'stop'] as const;

export const v2PlanningProposalSchema = z.object({
  turnCategory: z.enum(v2TurnCategories),
  primaryGoalKey: z.string().trim().min(1).max(80).nullable(),
  candidateGoalKeys: z.array(z.string().trim().min(1).max(80)).max(8),
  matchedSignalIds: z.array(z.string().trim().min(1).max(80)).max(32),
  supportingTopicKeys: z.array(z.string().trim().min(1).max(80)).max(16),
  runnerUpScore: z.number().min(0).max(100).nullable(),
  nextMove: z.enum(v2NextMoves),
  nextQuestion: z.string().trim().max(1_000).nullable(),
  proposedToolKey: z.string().trim().min(1).max(80).nullable(),
  confidenceBand: z.enum(['low', 'medium', 'high']),
}).strict();

export type V2PlanningProposal = z.infer<typeof v2PlanningProposalSchema>;

export interface V2PlanningContext {
  confirmedGoalKey: string | null;
  currentStageKey: string | null;
  verifiedRequirementKeys: string[];
  goalConfirmed: boolean;
  allowedToolKeys: string[];
}

export interface V2PlanningDecision {
  accepted: boolean;
  proposal: V2PlanningProposal | null;
  primaryGoalKey: string | null;
  score: CatalogV2Score | null;
  currentStage: { eligible: boolean; missingEntryRequirements: string[] } | null;
  nextRequirementKey: string | null;
  proposedToolKey: string | null;
  preservedConfirmedGoal: boolean;
  reasons: string[];
}

const rejected = (reasons: string[], proposal: V2PlanningProposal | null = null): V2PlanningDecision => ({ accepted: false, proposal, primaryGoalKey: null, score: null, currentStage: null, nextRequirementKey: null, proposedToolKey: null, preservedConfirmedGoal: false, reasons });

export const validateV2PlanningProposal = (input: unknown, catalog: CatalogV2Document, context: V2PlanningContext): V2PlanningDecision => {
  const parsed = v2PlanningProposalSchema.safeParse(input);
  if (!parsed.success) return rejected(['invalid_proposal']);
  const proposal = parsed.data;
  const activeGoals = new Set(catalog.sheets.BusinessGoals.filter((goal) => goal.active).map((goal) => goal.businessGoalKey));
  const knownSignals = new Map(catalog.sheets.IntentSignals.map((signal) => [signal.signalId, signal]));
  const activeTopics = new Set(catalog.sheets.KnowledgeTopics.filter((topic) => topic.active).map((topic) => topic.topicKey));
  const reasons: string[] = [];
  if (proposal.candidateGoalKeys.some((key) => !activeGoals.has(key))) reasons.push('unknown_goal_candidate');
  if (proposal.primaryGoalKey && !activeGoals.has(proposal.primaryGoalKey)) reasons.push('unknown_primary_goal');
  if (proposal.primaryGoalKey && proposal.candidateGoalKeys.length > 0 && !proposal.candidateGoalKeys.includes(proposal.primaryGoalKey)) reasons.push('primary_goal_not_proposed');
  if (proposal.matchedSignalIds.some((id) => !knownSignals.has(id))) reasons.push('unknown_signal');
  if (proposal.supportingTopicKeys.some((key) => !activeTopics.has(key))) reasons.push('unknown_topic');
  if (reasons.length) return rejected(reasons, proposal);

  const preservedConfirmedGoal = Boolean(context.confirmedGoalKey && proposal.turnCategory !== 'business_goal' && proposal.primaryGoalKey !== context.confirmedGoalKey);
  const primaryGoalKey = preservedConfirmedGoal ? context.confirmedGoalKey : proposal.primaryGoalKey;
  if (!primaryGoalKey) return rejected(['goal_unconfirmed'], proposal);
  if (preservedConfirmedGoal && proposal.primaryGoalKey && proposal.primaryGoalKey !== context.confirmedGoalKey) reasons.push('confirmed_goal_preserved');

  const goalSignals = new Set(catalog.sheets.TurnIntents.filter((intent) => intent.businessGoalKey === primaryGoalKey).map((intent) => intent.turnIntentKey));
  const matchedSignalIds = proposal.matchedSignalIds.filter((id) => {
    const signal = knownSignals.get(id);
    return signal ? signal.targetKey === primaryGoalKey || goalSignals.has(signal.targetKey) : false;
  });
  if (matchedSignalIds.length !== proposal.matchedSignalIds.length) reasons.push('signal_outside_goal');
  const score = scoreCatalogV2Turn(catalog, { businessGoalKey: primaryGoalKey, matchedSignalIds, ...(proposal.runnerUpScore === null ? {} : { runnerUpScore: proposal.runnerUpScore }), verifiedRequirementKeys: context.verifiedRequirementKeys, currentStageKey: context.currentStageKey, goalConfirmed: context.goalConfirmed });
  const currentStage = context.currentStageKey ? evaluateCatalogV2Stage(catalog, primaryGoalKey, context.currentStageKey, context.verifiedRequirementKeys) : null;
  if (score.ambiguous) reasons.push('ambiguous_goal');
  if (!score.thresholdMet) reasons.push('insufficient_evidence');

  const verified = new Set(context.verifiedRequirementKeys);
  const nextRequirement = catalog.sheets.RequirementPolicies
    .filter((requirement) => requirement.goalKey === primaryGoalKey && requirement.required && (!context.currentStageKey || requirement.stageKey === context.currentStageKey) && !verified.has(requirement.requirementKey))
    .filter((requirement) => requirement.dependencies.every((dependency) => verified.has(dependency)))
    .sort((left, right) => right.priority - left.priority || left.requirementKey.localeCompare(right.requirementKey))[0];
  const nextRequirementKey = nextRequirement?.requirementKey ?? null;
  if (nextRequirementKey && proposal.turnCategory !== 'knowledge_advisory' && proposal.nextMove === 'stop') reasons.push('pending_requirement');
  const allowedTool = proposal.proposedToolKey && context.allowedToolKeys.includes(proposal.proposedToolKey)
    && catalog.sheets.ToolBindings.some((binding) => binding.toolKey === proposal.proposedToolKey && binding.enabled)
    ? proposal.proposedToolKey
    : null;
  if (proposal.proposedToolKey && !allowedTool) reasons.push('tool_not_allowed');
  const ambiguous = score.ambiguous;
  const accepted = !ambiguous && reasons.every((reason) => !['unknown_goal_candidate', 'unknown_primary_goal', 'primary_goal_not_proposed', 'unknown_signal', 'unknown_topic', 'tool_not_allowed'].includes(reason));
  return { accepted, proposal, primaryGoalKey, score, currentStage, nextRequirementKey: ambiguous ? null : nextRequirementKey, proposedToolKey: allowedTool, preservedConfirmedGoal, reasons };
};

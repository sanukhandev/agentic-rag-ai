import { z } from 'zod';
import type { CatalogV2Document } from './catalog.js';
import { evaluateCatalogV2Stage, scoreCatalogV2Turn, type CatalogV2Score } from './catalog-runtime.js';

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
  proposedFacts: z.array(z.object({
    key: z.enum(['business_activity', 'entity_type', 'visa_count', 'timeline']),
    maskedValue: z.string().trim().min(1).max(180),
    supportingQuote: z.string().trim().min(1).max(300),
  }).strict()).max(8).default([]),
}).strict();

export type V2PlanningProposal = z.infer<typeof v2PlanningProposalSchema>;

export interface V2PlanningContext {
  confirmedGoalKey: string | null;
  currentStageKey: string | null;
  verifiedRequirementKeys: string[];
  goalConfirmed: boolean;
  allowedToolKeys: string[];
  /** Only a server-observed customer signal can contribute scoring evidence. */
  observedText?: string;
  /** Server-resolved, catalog-backed customer signals; replaces model signal claims. */
  serverObservedSignalIds?: readonly string[];
  /** Calculated by Node across published goals; never trust model runner-up score. */
  serverRunnerUpScore?: number;
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
  validatedTopicKeys: string[];
  rejectedTopicKeys: string[];
  validatedSignalIds: string[];
  rejectedSignalIds: string[];
  reasons: string[];
}

const rejected = (reasons: string[], proposal: V2PlanningProposal | null = null): V2PlanningDecision => ({ accepted: false, proposal, primaryGoalKey: null, score: null, currentStage: null, nextRequirementKey: null, proposedToolKey: null, preservedConfirmedGoal: false, validatedTopicKeys: [], rejectedTopicKeys: [], validatedSignalIds: [], rejectedSignalIds: [], reasons });

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
  const hasAuthoritativeSignals = context.serverObservedSignalIds !== undefined;
  const validatedSignalIds = hasAuthoritativeSignals
    ? [...new Set((context.serverObservedSignalIds ?? []).filter(id => {
      const signal = knownSignals.get(id);
      return signal && signal.signalType !== 'exclusion';
    }))]
    : [...new Set(proposal.matchedSignalIds.filter(id => knownSignals.has(id)))];
  const rejectedSignalIds = [...new Set(proposal.matchedSignalIds.filter(id => !validatedSignalIds.includes(id)))];
  if (proposal.matchedSignalIds.some(id => !knownSignals.has(id))) reasons.push('unknown_signal');
  if (hasAuthoritativeSignals && rejectedSignalIds.length) reasons.push('unobserved_signal');
  if (!hasAuthoritativeSignals && context.observedText !== undefined) {
    const utterance = context.observedText.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
    if (proposal.matchedSignalIds.some(id => {
      const signal = knownSignals.get(id);
      return !signal || signal.signalType === 'exclusion' || !utterance.includes(signal.value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim());
    })) reasons.push('unobserved_signal');
  }
  const validatedTopicKeys = [...new Set(proposal.supportingTopicKeys.filter(key => activeTopics.has(key)
    && (catalog.sheets.KnowledgeTopics.find(topic => topic.topicKey === key)?.goalKey === null
      || catalog.sheets.KnowledgeTopics.find(topic => topic.topicKey === key)?.goalKey === (context.confirmedGoalKey ?? proposal.primaryGoalKey))))];
  const rejectedTopicKeys = [...new Set(proposal.supportingTopicKeys.filter(key => !validatedTopicKeys.includes(key)))];
  if (rejectedTopicKeys.length) reasons.push('unknown_or_unrelated_topic');
  const fatalSignals = hasAuthoritativeSignals ? [] : ['unknown_signal', 'unobserved_signal'];
  if (reasons.some(reason => ['unknown_goal_candidate', 'unknown_primary_goal', 'primary_goal_not_proposed', ...fatalSignals].includes(reason))) {
    return { ...rejected(reasons, proposal), validatedTopicKeys, rejectedTopicKeys, validatedSignalIds, rejectedSignalIds };
  }

  const preservedConfirmedGoal = Boolean(context.confirmedGoalKey && proposal.turnCategory !== 'business_goal' && proposal.primaryGoalKey !== context.confirmedGoalKey);
  const primaryGoalKey = preservedConfirmedGoal ? context.confirmedGoalKey : proposal.primaryGoalKey;
  if (!primaryGoalKey) {
    if (proposal.turnCategory === 'conversation_navigation' || proposal.turnCategory === 'knowledge_advisory') {
      return { accepted: true, proposal, primaryGoalKey: null, score: null,
        currentStage: null, nextRequirementKey: null, proposedToolKey: null,
        preservedConfirmedGoal: false, validatedTopicKeys, rejectedTopicKeys,
        validatedSignalIds, rejectedSignalIds, reasons: [...reasons, 'no_goal_candidate'] };
    }
    return { ...rejected([...reasons, 'goal_unconfirmed'], proposal),
      validatedTopicKeys, rejectedTopicKeys, validatedSignalIds, rejectedSignalIds };
  }
  if (preservedConfirmedGoal && proposal.primaryGoalKey && proposal.primaryGoalKey !== context.confirmedGoalKey) reasons.push('confirmed_goal_preserved');

  const goalSignals = new Set(catalog.sheets.TurnIntents.filter((intent) => intent.businessGoalKey === primaryGoalKey).map((intent) => intent.turnIntentKey));
  const matchedSignalIds = validatedSignalIds.filter((id) => {
    const signal = knownSignals.get(id);
    return signal ? signal.targetKey === primaryGoalKey || goalSignals.has(signal.targetKey) : false;
  });
  if (matchedSignalIds.length !== validatedSignalIds.length) reasons.push('signal_outside_goal');
  const runnerUpScore = hasAuthoritativeSignals ? (context.serverRunnerUpScore ?? 0) : proposal.runnerUpScore;
  const score = scoreCatalogV2Turn(catalog, { businessGoalKey: primaryGoalKey, matchedSignalIds,
    ...(runnerUpScore === null ? {} : { runnerUpScore }), verifiedRequirementKeys: context.verifiedRequirementKeys,
    currentStageKey: context.currentStageKey, goalConfirmed: context.goalConfirmed });
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
  const fatal = hasAuthoritativeSignals ? ['tool_not_allowed'] : ['unknown_signal', 'unobserved_signal', 'tool_not_allowed'];
  const accepted = !ambiguous && reasons.every(reason => !fatal.includes(reason));
  return { accepted, proposal, primaryGoalKey, score, currentStage,
    nextRequirementKey: ambiguous ? null : nextRequirementKey, proposedToolKey: allowedTool,
    preservedConfirmedGoal, validatedTopicKeys, rejectedTopicKeys, validatedSignalIds: matchedSignalIds,
    rejectedSignalIds, reasons };
};

import type { IntentCatalog, IntentCatalogActivationMode, IntentCatalogDocumentPolicy, IntentCatalogDocumentSettings, IntentCatalogExtensionRow, IntentCatalogIntent, IntentCatalogJourneyRequirement, IntentCatalogJourneyTransition, IntentCatalogQualityRule, IntentCatalogRequirementType, IntentCatalogSlot, IntentCatalogVersion, IntentCatalogWorkflowBinding } from './types.js';

export interface IntentResolution {
  intentKey: string | null;
  interest: string | null;
  workflowKey: string | null;
  score: number;
  confidence: number;
  catalogVersionId: string;
  confirmationRequired: boolean;
  missingSlots: string[];
  actionAllowed: boolean;
  ambiguous: boolean;
  runnerUpIntentKey: string | null;
  reason: string;
}

export interface IntentContinuityInput {
  currentText: string;
  contextText?: string;
  slotValues?: Record<string, string>;
  selectedIntentKey?: string | null;
  pendingPromptType?: 'clarification' | 'slot' | 'consent' | 'confirmation' | 'document' | null;
}

export interface IntentContinuityResolution {
  primary: IntentResolution;
  current: IntentResolution;
  context: IntentResolution;
  secondaryIntentKeys: string[];
}

export interface CatalogValidationResult {
  errors: string[];
  catalog: IntentCatalog | null;
}

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const bool = (value: unknown): boolean => value === true;
const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : NaN;
const clamp = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
const normalize = (value: string): string => value.toLocaleLowerCase('en-US').replace(/\s+/g, ' ').trim();
const normalizeCatalogPhrase = (value: string): string => normalize(value)
  .replace(/\bset[\s-]?up\b/g, 'start')
  .replace(/\b(?:establish|establishing|launch|launching|open|opening|create|creating|register|registering)\b/g, 'start');
const phraseTokens = (value: string): string[] => normalizeCatalogPhrase(value).match(/[\p{L}\p{N}]+/gu) ?? [];
const optionalPhraseTokens = new Set(['a', 'an', 'for', 'in', 'of', 'on', 'the', 'to']);
const tokenDistance = (left: string, right: string): number => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      current.push(left[leftIndex] === right[rightIndex]
        ? previous[rightIndex] ?? 0
        : 1 + Math.min(previous[rightIndex] ?? 0, current[rightIndex] ?? 0, previous[rightIndex + 1] ?? 0));
    }
    for (let index = 0; index < current.length; index += 1) previous[index] = current[index] ?? previous[index] ?? 0;
  }
  return previous[right.length] ?? Number.MAX_SAFE_INTEGER;
};
const matchesCatalogToken = (input: string, signal: string): boolean => input === signal || (signal.length >= 5 && input.length >= 5 && tokenDistance(input, signal) <= 1);
const matchesCatalogPhrase = (input: string, signal: string): boolean => {
  const inputTokens = phraseTokens(input);
  const signalTokens = phraseTokens(signal);
  if (!signalTokens.length) return false;
  let cursor = 0;
  let insertedTokens = 0;
  for (const token of signalTokens) {
    const matchIndex = inputTokens.findIndex((candidate, index) => index >= cursor && matchesCatalogToken(candidate, token));
    if (matchIndex < 0 && optionalPhraseTokens.has(token)) continue;
    if (matchIndex < 0) return false;
    insertedTokens += matchIndex - cursor;
    if (insertedTokens > 3) return false;
    cursor = matchIndex + 1;
  }
  return true;
};
const keyPattern = /^[a-z][a-z0-9._-]{1,79}$/;
const promptKeyPattern = /^[a-z][a-z0-9._-]{1,119}$/;
const requirementKeyPattern = /^[a-z][a-z0-9._:-]{1,119}$/;
export const isCrmWriteBinding = (binding: Pick<IntentCatalogWorkflowBinding, 'sideEffectClass'> | null | undefined): boolean => ['crm_write', 'crm'].includes(text(binding?.sideEffectClass).toLocaleLowerCase('en-US'));
export const isWorkflowClaimableBinding = (binding: Pick<IntentCatalogWorkflowBinding, 'sideEffectClass'> | null | undefined): boolean => isCrmWriteBinding(binding) || text(binding?.sideEffectClass).toLocaleLowerCase('en-US') === 'human_review';
const safePath = (value: string): boolean => /^\/[A-Za-z0-9._/-]{1,120}$/.test(value) && !value.includes('..');
const extensionRows = (value: Record<string, unknown>, name: string): IntentCatalogExtensionRow[] => Array.isArray(value[name]) ? value[name].map((item) => {
  const row = record(item);
  return Object.fromEntries(Object.entries(row).filter(([, cell]) => cell === null || typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean')) as IntentCatalogExtensionRow;
}) : [];

const duplicateErrors = (values: string[], label: string): string[] => {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    if (seen.has(value)) return [`${label} contains duplicate key ${value}.`];
    seen.add(value);
    return [];
  });
};

export const validateIntentCatalog = (input: unknown): CatalogValidationResult => {
  if (!input || typeof input !== 'object') return { errors: ['Catalog must be an object.'], catalog: null };
  const value = input as Record<string, unknown>;
  const arrays = ['intents', 'signals', 'slots', 'relations', 'workflowBindings'] as const;
  const errors: string[] = [];
  for (const name of arrays) if (!Array.isArray(value[name])) errors.push(`${name} must be an array.`);
  if (errors.length) return { errors, catalog: null };
  const intents = value.intents as unknown[];
  const signals = value.signals as unknown[];
  const slots = value.slots as unknown[];
  const relations = value.relations as unknown[];
  const workflowBindings = value.workflowBindings as unknown[];
  const qualityRules = Array.isArray(value.qualityRules) ? value.qualityRules : [];
  const intentKeys = intents.map((item) => text(record(item).intentKey));
  const workflowKeys = workflowBindings.map((item) => text(record(item).workflowKey));
  errors.push(...duplicateErrors(intentKeys.filter(Boolean), 'Intents'));
  errors.push(...duplicateErrors(workflowKeys.filter(Boolean), 'Workflow bindings'));
  const intentSet = new Set(intentKeys);
  const workflowSet = new Set(workflowKeys);
  const parsedIntents: IntentCatalogIntent[] = [];
  for (const [index, item] of intents.entries()) {
    const row = record(item);
    const intentKey = text(row.intentKey);
    const minimumScore = finite(row.minimumScore);
    const confidenceThreshold = finite(row.confidenceThreshold);
    if (!keyPattern.test(intentKey)) errors.push(`Intents row ${index + 2} has an invalid intentKey.`);
    if (!text(row.displayName) || !text(row.workflowKey)) errors.push(`Intents row ${index + 2} requires displayName and workflowKey.`);
    if (!Number.isFinite(minimumScore) || minimumScore < 0 || minimumScore > 100) errors.push(`Intents row ${index + 2} has an invalid minimumScore.`);
    if (!Number.isFinite(confidenceThreshold) || confidenceThreshold < 0 || confidenceThreshold > 1) errors.push(`Intents row ${index + 2} has an invalid confidenceThreshold.`);
    if (intentKey && !workflowSet.has(text(row.workflowKey))) errors.push(`Intents row ${index + 2} references an unknown workflow binding.`);
    parsedIntents.push({ intentKey, displayName: text(row.displayName), description: text(row.description), category: text(row.category), workflowKey: text(row.workflowKey), minimumScore: clamp(minimumScore), confidenceThreshold, confirmationRequired: bool(row.confirmationRequired), active: bool(row.active), priority: Number.isFinite(finite(row.priority)) ? finite(row.priority) : 0, versionNote: text(row.versionNote) });
  }
  const parsedSignals = signals.map((item, index) => {
    const row = record(item);
    const intentKey = text(row.intentKey); const weight = finite(row.weight);
    if (!intentSet.has(intentKey)) errors.push(`Signals row ${index + 2} references an unknown intent.`);
    if (!text(row.signalId) || !text(row.value) || !['phrase', 'keyword', 'exclusion'].includes(text(row.signalType))) errors.push(`Signals row ${index + 2} has invalid required fields.`);
    if (!Number.isFinite(weight) || weight < -100 || weight > 100) errors.push(`Signals row ${index + 2} has an invalid weight.`);
    return { intentKey, signalId: text(row.signalId), signalType: text(row.signalType) as 'phrase' | 'keyword' | 'exclusion', value: text(row.value), language: text(row.language) || 'en', matchMode: text(row.matchMode) || 'contains', weight, relationGroup: text(row.relationGroup) || null, notes: text(row.notes) };
  });
  const parsedSlots = slots.map((item, index) => {
    const row = record(item);
    const intentKey = text(row.intentKey);
    if (!intentSet.has(intentKey)) errors.push(`Slots row ${index + 2} references an unknown intent.`);
    if (!text(row.slotKey) || !text(row.dataType) || !text(row.promptKey) || !text(row.validationRule)) errors.push(`Slots row ${index + 2} has invalid required fields.`);
    return { intentKey, slotKey: text(row.slotKey), dataType: text(row.dataType), required: bool(row.required), alternativeGroup: text(row.alternativeGroup) || null, collectionOrder: Number.isFinite(finite(row.collectionOrder)) ? finite(row.collectionOrder) : 0, promptKey: text(row.promptKey), validationRule: text(row.validationRule), retentionClass: text(row.retentionClass), qualityWeight: Number.isFinite(finite(row.qualityWeight)) ? finite(row.qualityWeight) : 0 };
  });
  const parsedRelations = relations.map((item, index) => {
    const row = record(item); const sourceIntent = text(row.sourceIntent); const relatedIntent = text(row.relatedIntent);
    if (!intentSet.has(sourceIntent) || !intentSet.has(relatedIntent)) errors.push(`Relations row ${index + 2} references an unknown intent.`);
    return { sourceIntent, relatedIntent, relationType: text(row.relationType), triggerGroup: text(row.triggerGroup), scoreAdjustment: finite(row.scoreAdjustment) || 0, minimumCooccurrence: finite(row.minimumCooccurrence) || 1, clarificationPromptKey: text(row.clarificationPromptKey) };
  });
  const parsedBindings = workflowBindings.map((item, index) => {
    const row = record(item); const workflowKey = text(row.workflowKey); const webhookPath = text(row.webhookPath);
    if (!keyPattern.test(workflowKey) || !text(row.n8nWorkflowId) || !safePath(`/${webhookPath.replace(/^\//, '')}`)) errors.push(`WorkflowBindings row ${index + 2} has an invalid binding or webhook path.`);
    return { workflowKey, n8nWorkflowId: text(row.n8nWorkflowId), webhookPath: webhookPath.replace(/^\//, ''), payloadContract: text(row.payloadContract), sideEffectClass: text(row.sideEffectClass), active: bool(row.active) };
  });
  const parsedQualityRules = qualityRules.map((item, index) => {
    const row = record(item);
    const rule = { intentKey: text(row.intentKey), qualityWorkflowKey: text(row.qualityWorkflowKey), intentWeight: finite(row.intentWeight), confidenceWeight: finite(row.confidenceWeight), contactWeight: finite(row.contactWeight), hotThreshold: finite(row.hotThreshold), warmThreshold: finite(row.warmThreshold), nurtureThreshold: finite(row.nurtureThreshold) } satisfies IntentCatalogQualityRule;
    if (!intentSet.has(rule.intentKey)) errors.push(`QualityRules row ${index + 2} references an unknown intent.`);
    if (rule.qualityWorkflowKey && !workflowSet.has(rule.qualityWorkflowKey)) errors.push(`QualityRules row ${index + 2} references an unknown workflow binding.`);
    if (![rule.intentWeight, rule.confidenceWeight, rule.contactWeight].every((weight) => Number.isFinite(weight) && weight >= 0) || Math.abs(rule.intentWeight + rule.confidenceWeight + rule.contactWeight - 1) > 0.001) errors.push(`QualityRules row ${index + 2} weights must be non-negative and sum to 1.`);
    if (![rule.hotThreshold, rule.warmThreshold, rule.nurtureThreshold].every((threshold) => Number.isFinite(threshold) && threshold >= 0 && threshold <= 100) || rule.hotThreshold < rule.warmThreshold || rule.warmThreshold < rule.nurtureThreshold) errors.push(`QualityRules row ${index + 2} thresholds must be ordered between 0 and 100.`);
    return rule;
  });
  const documentPoliciesInput = Array.isArray(value.documentPolicies) ? value.documentPolicies : [];
  const journeyRequirementsInput = Array.isArray(value.journeyRequirements) ? value.journeyRequirements : [];
  const journeyRequirementKeys = new Set<string>();
  const parsedJourneyRequirements: IntentCatalogJourneyRequirement[] = journeyRequirementsInput.map((item, index) => {
    const row = record(item);
    const requirement: IntentCatalogJourneyRequirement = {
      intentKey: text(row.intentKey),
      requirementKey: text(row.requirementKey),
      requirementType: text(row.requirementType) as IntentCatalogRequirementType,
      required: bool(row.required),
      collectionOrder: finite(row.collectionOrder),
      promptKey: text(row.promptKey),
      validationRule: text(row.validationRule),
      slotKey: text(row.slotKey) || null,
      documentType: text(row.documentType) || null,
      fulfillmentMode: text(row.fulfillmentMode) as IntentCatalogJourneyRequirement['fulfillmentMode'],
      sourceOfTruth: text(row.sourceOfTruth),
      notes: text(row.notes),
    };
    const duplicateKey = `${requirement.intentKey}:${requirement.requirementKey}`;
    if (journeyRequirementKeys.has(duplicateKey)) errors.push(`JourneyRequirements row ${index + 2} contains a duplicate requirement key.`);
    journeyRequirementKeys.add(duplicateKey);
    if (!intentSet.has(requirement.intentKey) || !requirementKeyPattern.test(requirement.requirementKey) || !['slot', 'document', 'consent', 'confirmation'].includes(requirement.requirementType) || !Number.isInteger(requirement.collectionOrder) || requirement.collectionOrder < 0 || requirement.collectionOrder > 1_000 || !promptKeyPattern.test(requirement.promptKey) || !['conversation_ready', 'external_confirmation_required'].includes(requirement.fulfillmentMode)) {
      errors.push(`JourneyRequirements row ${index + 2} has invalid references or required fields.`);
    }
    if (requirement.requirementType === 'slot') {
      const slot = slots.find((candidate) => text(record(candidate).intentKey) === requirement.intentKey && text(record(candidate).slotKey) === requirement.slotKey);
      if (!slot || !requirement.slotKey) errors.push(`JourneyRequirements row ${index + 2} must reference a catalog slot.`);
    }
    if (requirement.requirementType === 'document') {
      const policy = documentPoliciesInput.map(record).find((candidate) => text(candidate.intentKey) === requirement.intentKey && Array.isArray(candidate.allowedDocumentTypes) && candidate.allowedDocumentTypes.map(text).includes(requirement.documentType ?? ''));
      if (!requirement.documentType || !policy) errors.push(`JourneyRequirements row ${index + 2} must reference an allowed document type.`);
    }
    return requirement;
  });
  const journeyTransitionsInput = Array.isArray(value.journeyTransitions) ? value.journeyTransitions : [];
  const transitionKeys = new Set<string>();
  const parsedJourneyTransitions: IntentCatalogJourneyTransition[] = journeyTransitionsInput.map((item, index) => {
    const row = record(item);
    const transition: IntentCatalogJourneyTransition = {
      sourceIntentKey: text(row.sourceIntentKey),
      targetIntentKey: text(row.targetIntentKey),
      activationMode: text(row.activationMode) as IntentCatalogActivationMode,
      maxDepth: finite(row.maxDepth),
      triggerGroup: text(row.triggerGroup),
      promptKey: text(row.promptKey),
      notes: text(row.notes),
    };
    const transitionKey = `${transition.sourceIntentKey}:${transition.targetIntentKey}`;
    if (transitionKeys.has(transitionKey)) errors.push(`JourneyTransitions row ${index + 2} contains a duplicate transition.`);
    transitionKeys.add(transitionKey);
    if (!intentSet.has(transition.sourceIntentKey) || !intentSet.has(transition.targetIntentKey) || transition.sourceIntentKey === transition.targetIntentKey || !['offer', 'automatic'].includes(transition.activationMode) || !Number.isInteger(transition.maxDepth) || transition.maxDepth < 1 || transition.maxDepth > 8 || !promptKeyPattern.test(transition.promptKey)) errors.push(`JourneyTransitions row ${index + 2} has invalid references or required fields.`);
    return transition;
  });
  const automaticTransitions = new Map<string, string[]>();
  for (const transition of parsedJourneyTransitions.filter((candidate) => candidate.activationMode === 'automatic')) automaticTransitions.set(transition.sourceIntentKey, [...(automaticTransitions.get(transition.sourceIntentKey) ?? []), transition.targetIntentKey]);
  const hasAutomaticCycle = (key: string, path: Set<string>): boolean => {
    if (path.has(key)) return true;
    const nextPath = new Set(path).add(key);
    return (automaticTransitions.get(key) ?? []).some((next) => hasAutomaticCycle(next, nextPath));
  };
  if ([...automaticTransitions.keys()].some((key) => hasAutomaticCycle(key, new Set()))) errors.push('JourneyTransitions cannot contain an automatic activation cycle.');
  const documentSettingsInput = record(value.documentSettings);
  let documentSettings: IntentCatalogDocumentSettings | undefined;
  if (Object.keys(documentSettingsInput).length > 0) {
    const allowedMimeTypes = Array.isArray(documentSettingsInput.allowedMimeTypes) ? documentSettingsInput.allowedMimeTypes.map(text).filter(Boolean) : [];
    const ocrLanguages = Array.isArray(documentSettingsInput.ocrLanguages) ? documentSettingsInput.ocrLanguages.map(text).filter(Boolean) : [];
    documentSettings = {
      schemaVersion: text(documentSettingsInput.schemaVersion), enabled: bool(documentSettingsInput.enabled), storageBackend: text(documentSettingsInput.storageBackend), processingProvider: text(documentSettingsInput.processingProvider), workflowKey: text(documentSettingsInput.workflowKey), requireUploadConsent: bool(documentSettingsInput.requireUploadConsent), maxFileBytes: finite(documentSettingsInput.maxFileBytes), maxFilesPerRequest: finite(documentSettingsInput.maxFilesPerRequest), maxPdfPages: finite(documentSettingsInput.maxPdfPages), ocrLanguages, allowedMimeTypes, retentionPolicy: text(documentSettingsInput.retentionPolicy), allowPublicDocumentUrls: bool(documentSettingsInput.allowPublicDocumentUrls), allowAutomaticKnowledgeIngestion: bool(documentSettingsInput.allowAutomaticKnowledgeIngestion), allowPersonalIdentityDocumentsByDefault: bool(documentSettingsInput.allowPersonalIdentityDocumentsByDefault), summaryRendering: text(documentSettingsInput.summaryRendering), notes: text(documentSettingsInput.notes)
    };
    if (!documentSettings.schemaVersion || !documentSettings.workflowKey || documentSettings.maxFileBytes <= 0 || documentSettings.maxFileBytes > 50 * 1024 * 1024 || documentSettings.maxFilesPerRequest < 1 || documentSettings.maxFilesPerRequest > 10 || documentSettings.maxPdfPages < 1 || documentSettings.maxPdfPages > 100 || !allowedMimeTypes.length || !ocrLanguages.length) errors.push('documentSettings has invalid limits or allowed types.');
    if (!workflowSet.has(documentSettings.workflowKey)) errors.push('documentSettings references an unknown workflow binding.');
  }
  const parsedDocumentPolicies: IntentCatalogDocumentPolicy[] = documentPoliciesInput.map((item, index) => {
    const row = record(item);
    const policy: IntentCatalogDocumentPolicy = { intentKey: text(row.intentKey), enabled: bool(row.enabled), workflowKey: text(row.workflowKey), requestMode: text(row.requestMode) as IntentCatalogDocumentPolicy['requestMode'], required: bool(row.required), requestPromptKey: text(row.requestPromptKey), allowedDocumentTypes: Array.isArray(row.allowedDocumentTypes) ? row.allowedDocumentTypes.map(text).filter(Boolean) : [], allowUserInitiated: bool(row.allowUserInitiated), consentRequired: bool(row.consentRequired), preservePrimaryIntent: bool(row.preservePrimaryIntent), storeExtractedText: bool(row.storeExtractedText), summaryTarget: text(row.summaryTarget), autoCreateLead: bool(row.autoCreateLead), autoIndexInRag: bool(row.autoIndexInRag), notes: text(row.notes) };
    if (!intentSet.has(policy.intentKey) || !workflowSet.has(policy.workflowKey) || !['conditional_offer', 'user_offer_only', 'explicit_upload'].includes(policy.requestMode) || !policy.allowedDocumentTypes.length || !policy.requestPromptKey) errors.push(`DocumentPolicies row ${index + 2} has invalid references or required fields.`);
    return policy;
  });
  const catalog: IntentCatalog = { tenantScope: text(value.tenantScope) || null, intents: parsedIntents, signals: parsedSignals, slots: parsedSlots, relations: parsedRelations, workflowBindings: parsedBindings, qualityRules: parsedQualityRules, ...(parsedJourneyRequirements.length ? { journeyRequirements: parsedJourneyRequirements } : {}), ...(parsedJourneyTransitions.length ? { journeyTransitions: parsedJourneyTransitions } : {}), ...(documentSettings ? { documentSettings } : {}), ...(documentPoliciesInput.length ? { documentPolicies: parsedDocumentPolicies } : {}), ...(extensionRows(value, 'documentRequirements').length ? { documentRequirements: extensionRows(value, 'documentRequirements') } : {}), ...(extensionRows(value, 'crmFieldMappings').length ? { crmFieldMappings: extensionRows(value, 'crmFieldMappings') } : {}), ...(extensionRows(value, 'channelCapabilities').length ? { channelCapabilities: extensionRows(value, 'channelCapabilities') } : {}), ...(extensionRows(value, 'testUtterances').length ? { testUtterances: extensionRows(value, 'testUtterances') } : {}), ...(extensionRows(value, 'catalogManifest').length ? { catalogManifest: extensionRows(value, 'catalogManifest') } : {}) };
  if (catalog.intents.length === 0) errors.push('Catalog must contain at least one intent.');
  if (catalog.workflowBindings.length === 0) errors.push('Catalog must contain at least one workflow binding.');
  return { errors: [...new Set(errors)], catalog: errors.length ? null : catalog };
};

const slotValues = (intentKey: string, slots: IntentCatalogSlot[], values: Record<string, string>): Set<string> => {
  const rows = slots.filter((slot) => slot.intentKey === intentKey);
  const present = new Set(rows.filter((slot) => Boolean(values[slot.slotKey]) && !(slot.validationRule === 'boolean:explicit_opt_in' && values[slot.slotKey] !== 'true')).map((slot) => slot.slotKey));
  for (const group of new Set(rows.map((slot) => slot.alternativeGroup).filter((group): group is string => Boolean(group)))) {
    if (rows.some((slot) => slot.alternativeGroup === group && present.has(slot.slotKey))) for (const slot of rows.filter((item) => item.alternativeGroup === group)) present.add(slot.slotKey);
  }
  return present;
};

const missingSlotKeys = (intentKey: string, slots: IntentCatalogSlot[], values: Record<string, string>): string[] => {
  const rows = slots.filter((slot) => slot.intentKey === intentKey).sort((left, right) => {
    const leftConsent = left.validationRule === 'boolean:explicit_opt_in' ? 1 : 0;
    const rightConsent = right.validationRule === 'boolean:explicit_opt_in' ? 1 : 0;
    return leftConsent - rightConsent || left.collectionOrder - right.collectionOrder;
  });
  const present = slotValues(intentKey, slots, values);
  const missing = rows.filter((slot) => slot.required && !present.has(slot.slotKey) && !(slot.alternativeGroup && rows.some((other) => other.alternativeGroup === slot.alternativeGroup && present.has(other.slotKey)))).map((slot) => slot.slotKey);
  for (const group of new Set(rows.map((slot) => slot.alternativeGroup).filter((group): group is string => Boolean(group)))) {
    if (!rows.some((slot) => slot.alternativeGroup === group && present.has(slot.slotKey))) {
      const first = rows.find((slot) => slot.alternativeGroup === group);
      if (first && !missing.includes(first.slotKey)) missing.push(first.slotKey);
    }
  }
  return rows.filter((slot) => missing.includes(slot.slotKey)).map((slot) => slot.slotKey);
};

type JourneyDocumentStatus = { intentKey?: string | null; catalogVersionId?: string | null; requirementKey?: string | null; expectedDocumentType?: string | null; status: string };

export const catalogJourneyRequirements = (version: IntentCatalogVersion, intentKey: string): IntentCatalogJourneyRequirement[] => {
  if (version.catalog.journeyRequirements?.length) return version.catalog.journeyRequirements.filter((requirement) => requirement.intentKey === intentKey).sort((left, right) => left.collectionOrder - right.collectionOrder || left.requirementKey.localeCompare(right.requirementKey));
  return version.catalog.slots.filter((slot) => slot.intentKey === intentKey && slot.required).sort((left, right) => left.collectionOrder - right.collectionOrder).map((slot) => ({ intentKey, requirementKey: `slot:${slot.slotKey}`, requirementType: slot.validationRule === 'boolean:explicit_opt_in' ? 'consent' : 'slot', required: true, collectionOrder: slot.collectionOrder, promptKey: slot.promptKey, validationRule: slot.validationRule, slotKey: slot.slotKey, documentType: null, fulfillmentMode: 'conversation_ready', sourceOfTruth: 'catalog.slots', notes: '' }));
};

const isContactSlot = (slot: IntentCatalogSlot): boolean =>
  ['name', 'email', 'phone', 'contact_consent', 'document_consent'].includes(slot.slotKey)
  || slot.validationRule === 'boolean:explicit_opt_in'
  || slot.dataType === 'person_name'
  || slot.dataType === 'email'
  || slot.dataType === 'phone'
  || /(?:^|_)pii(?:$|_)/iu.test(slot.retentionClass)
  || /(?:contact|crm_contact)/iu.test(slot.retentionClass);

/** Optional catalog slots become one-at-a-time enrichment questions after the lead is registered. */
export const catalogFollowUpRequirements = (version: IntentCatalogVersion, intentKey: string): IntentCatalogJourneyRequirement[] => {
  const explicit = (version.catalog.journeyRequirements ?? []).filter((requirement) => requirement.intentKey === intentKey && !requirement.required && requirement.requirementType !== 'consent' && requirement.requirementType !== 'document');
  const representedSlots = new Set((version.catalog.journeyRequirements ?? []).filter((requirement) => requirement.intentKey === intentKey).map((requirement) => requirement.slotKey).filter((slotKey): slotKey is string => Boolean(slotKey)));
  const fallback = version.catalog.slots
    .filter((slot) => slot.intentKey === intentKey && !slot.required && !representedSlots.has(slot.slotKey) && !isContactSlot(slot))
    .sort((left, right) => left.collectionOrder - right.collectionOrder || left.slotKey.localeCompare(right.slotKey))
    .map((slot) => ({ intentKey, requirementKey: `followup:${intentKey}:${slot.slotKey}`, requirementType: 'slot' as const, required: true, collectionOrder: slot.collectionOrder, promptKey: slot.promptKey, validationRule: slot.validationRule, slotKey: slot.slotKey, documentType: null, fulfillmentMode: 'conversation_ready' as const, sourceOfTruth: 'catalog.slots', notes: 'Optional post-registration enrichment.' }));
  return [...explicit, ...fallback].sort((left, right) => left.collectionOrder - right.collectionOrder || left.requirementKey.localeCompare(right.requirementKey));
};

export const journeyDocumentMatchesRequirement = (requirement: IntentCatalogJourneyRequirement, document: JourneyDocumentStatus, catalogVersionId?: string): boolean => {
  if (document.intentKey && document.intentKey !== requirement.intentKey) return false;
  if (requirement.sourceOfTruth !== 'catalog.slots' && document.intentKey !== requirement.intentKey) return false;
  if (catalogVersionId && requirement.sourceOfTruth !== 'catalog.slots' && document.catalogVersionId !== catalogVersionId) return false;
  if (document.requirementKey) return document.requirementKey === requirement.requirementKey;
  return requirement.sourceOfTruth === 'catalog.slots' && Boolean(document.expectedDocumentType && document.expectedDocumentType === requirement.documentType);
};

export const journeyRequirementFulfilled = (requirement: IntentCatalogJourneyRequirement, values: Record<string, string>, completedRequirementKeys: Set<string> = new Set(), documents: JourneyDocumentStatus[] = [], catalogVersionId?: string): boolean => {
  if (requirement.requirementType === 'document') return documents.some((document) => document.status === 'completed' && journeyDocumentMatchesRequirement(requirement, document, catalogVersionId));
  if (requirement.requirementType === 'confirmation') return completedRequirementKeys.has(requirement.requirementKey) || values[requirement.requirementKey] === 'true';
  const slotKey = requirement.slotKey ?? (requirement.requirementType === 'consent' ? 'contact_consent' : null);
  if (!slotKey || !values[slotKey]) return false;
  const value = values[slotKey];
  if (requirement.validationRule === 'boolean:explicit_opt_in') return value === 'true';
  if (/^(?:token:)?(?:NAME|EMAIL|PHONE)$/iu.test(requirement.validationRule)) {
    const tokenType = requirement.validationRule.split(':').pop()?.toUpperCase();
    return tokenType ? new RegExp(`^\\[${tokenType}_\\d+\\]$`, 'u').test(value) : false;
  }
  const integerRule = requirement.validationRule.match(/^integer:(positive|nonnegative|(\d+)-(\d+))$/iu);
  if (integerRule) {
    const numericValue = Number(value);
    const mode = integerRule[1] ?? '';
    if (!Number.isInteger(numericValue)) return false;
    if (mode.toLowerCase() === 'positive') return numericValue > 0;
    if (mode.toLowerCase() === 'nonnegative') return numericValue >= 0;
    return numericValue >= Number(integerRule[2] ?? NaN) && numericValue <= Number(integerRule[3] ?? NaN);
  }
  if (requirement.validationRule === 'number:positive') return Number.isFinite(Number(value)) && Number(value) > 0;
  if (requirement.validationRule === 'number:nonnegative') return Number.isFinite(Number(value)) && Number(value) >= 0;
  if (requirement.validationRule === 'money:nonnegative') return /\d/u.test(value) && !/^\s*-/u.test(value);
  return value.trim().length > 0;
};

export const catalogNextJourneyRequirement = (version: IntentCatalogVersion, intentKey: string, values: Record<string, string>, completedRequirementKeys: string[] = [], documents: JourneyDocumentStatus[] = []): IntentCatalogJourneyRequirement | null => {
  const completed = new Set(completedRequirementKeys);
  return catalogJourneyRequirements(version, intentKey).find((requirement) => requirement.required && !journeyRequirementFulfilled(requirement, values, completed, documents, version.id)) ?? null;
};

export const catalogNextFollowUpRequirement = (version: IntentCatalogVersion, intentKey: string, values: Record<string, string>, completedRequirementKeys: string[] = [], documents: JourneyDocumentStatus[] = []): IntentCatalogJourneyRequirement | null => {
  const completed = new Set(completedRequirementKeys);
  return catalogFollowUpRequirements(version, intentKey).find((requirement) => !journeyRequirementFulfilled(requirement, values, completed, documents, version.id)) ?? null;
};

const slotLabel = (slot: IntentCatalogSlot): string => {
  if (slot.dataType === 'person_name' || slot.slotKey === 'name') return 'name';
  if (slot.dataType === 'email' || slot.dataType === 'phone' || slot.alternativeGroup === 'contact') return 'email address or phone number';
  return slot.slotKey.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'this information';
};

export const catalogSlotLabel = (version: IntentCatalogVersion, intentKey: string, slotKey: string, values: Record<string, string> = {}): string => {
  const slot = version.catalog.slots.find((candidate) => candidate.intentKey === intentKey && candidate.slotKey === slotKey);
  if (!slot) return slotKey.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'this information';
  if (slot.alternativeGroup === 'contact') {
    const alternate = version.catalog.slots.find((candidate) => candidate.intentKey === intentKey && candidate.alternativeGroup === 'contact' && candidate.slotKey !== slotKey);
    if (alternate && values[alternate.slotKey]) return slot.slotKey === 'email' ? 'email address' : 'phone number';
  }
  return slotLabel(slot);
};

export const catalogSlotQuestion = (version: IntentCatalogVersion, intentKey: string, slotKey: string, values: Record<string, string> = {}): string => {
  const slot = version.catalog.slots.find((candidate) => candidate.intentKey === intentKey && candidate.slotKey === slotKey);
  if (!slot) return 'To continue, could you provide the requested information?';
  if (slot.promptKey === 'lead.ask_name') return 'What name should I use?';
  if (slot.promptKey === 'lead.ask_contact') return slot.alternativeGroup === 'contact' && !catalogSlotLabel(version, intentKey, slotKey, values).includes('phone number') && !catalogSlotLabel(version, intentKey, slotKey, values).includes('email address') ? 'What’s the best email address or phone number to reach you on?' : slot.slotKey === 'email' ? 'What email address should I use?' : 'What phone number, including country code, should I use?';
  if (slot.promptKey === 'lead.ask_phone') return 'What phone number, including country code, should I use?';
  return `To continue, could you share your ${slotLabel(slot)}?`;
};

export const catalogIntentClarification = (version: IntentCatalogVersion, intentKey: string): string => {
  const intent = version.catalog.intents.find((candidate) => candidate.intentKey === intentKey);
  if (!intent) return 'To make sure I understand, could you tell me a little more about what you need?';
  const examples = [...new Set(version.catalog.signals
    .filter((signal) => signal.intentKey === intentKey && signal.signalType !== 'exclusion')
    .sort((left, right) => right.weight - left.weight)
    .map((signal) => normalize(signal.value).replace(/[^\p{L}\p{N}\s?'-]/gu, '').trim().slice(0, 80))
    .filter(Boolean))].slice(0, 4);
  return examples.length
    ? `To make sure I route this correctly, are you looking to ${intent.displayName.toLocaleLowerCase('en-US')}? For example: ${examples.map((example) => `“${example}”`).join(', ')}.`
    : `To make sure I route this correctly, are you looking to ${intent.displayName.toLocaleLowerCase('en-US')}?`;
};

const readableCatalogText = (value: string): string => value.replace(/[._:-]+/gu, ' ').replace(/\s+/gu, ' ').trim() || 'this requirement';

export const catalogIntentLabel = (version: IntentCatalogVersion, intentKey: string | null | undefined): string => {
  if (!intentKey) return 'the related request';
  return version.catalog.intents.find((intent) => intent.intentKey === intentKey)?.displayName?.trim() || readableCatalogText(intentKey);
};

export const catalogRequirementLabel = (requirement: IntentCatalogJourneyRequirement): string => {
  const notes = requirement.notes.trim();
  return notes || readableCatalogText(requirement.requirementKey);
};

type RankedIntent = { intent: IntentCatalogVersion['catalog']['intents'][number]; score: number; confidence: number; matchedCount: number; strongPhraseMatched: boolean; missing: string[] };

const rankIntentCandidates = (version: IntentCatalogVersion, inputText: string, slotValuesByKey: Record<string, string>): RankedIntent[] => {
  const input = normalize(inputText);
  return version.catalog.intents.map((intent) => {
    const signals = version.catalog.signals.filter((signal) => signal.intentKey === intent.intentKey);
    const matched = signals.filter((signal) => signal.value && (signal.signalType === 'keyword' ? new RegExp(`\\b${normalize(signal.value).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(input) : input.includes(normalize(signal.value)) || matchesCatalogPhrase(input, signal.value)));
    const signalScore = matched.reduce((sum, signal) => sum + signal.weight, 0);
    const filled = slotValues(intent.intentKey, version.catalog.slots, slotValuesByKey);
    const slotScore = Math.min(50, filled.size * 20);
    const score = clamp(signalScore + slotScore);
    return { intent, score, confidence: Math.min(1, score / 100), matchedCount: matched.filter((signal) => signal.signalType !== 'exclusion').length, strongPhraseMatched: matched.some((signal) => signal.signalType === 'phrase' && signal.weight >= intent.minimumScore), missing: missingSlotKeys(intent.intentKey, version.catalog.slots, slotValuesByKey) };
  }).filter((candidate) => candidate.matchedCount > 0).sort((left, right) => right.score - left.score || right.intent.priority - left.intent.priority);
};

const emptyResolution = (version: IntentCatalogVersion): IntentResolution => ({ intentKey: null, interest: null, workflowKey: null, score: 0, confidence: 0, catalogVersionId: version.id, confirmationRequired: false, missingSlots: [], actionAllowed: false, ambiguous: false, runnerUpIntentKey: null, reason: 'no_signal' });

const resolutionFrom = (version: IntentCatalogVersion, candidates: RankedIntent[], index = 0): IntentResolution => {
  const best = candidates[index];
  if (!best) return emptyResolution(version);
  const runnerUp = candidates.find((candidate, candidateIndex) => candidateIndex !== index);
  const ambiguous = Boolean(runnerUp && Math.abs(best.score - runnerUp.score) <= 10 && best.intent.priority === runnerUp.intent.priority);
  const binding = version.catalog.workflowBindings.find((item) => item.workflowKey === best.intent.workflowKey);
  const scoreMet = best.score >= best.intent.minimumScore;
  const thresholdMet = scoreMet && best.confidence >= best.intent.confidenceThreshold;
  const collectionQualified = thresholdMet || (scoreMet && best.strongPhraseMatched);
  const actionAllowed = best.intent.active && Boolean(binding?.active) && thresholdMet && !ambiguous && best.missing.length === 0;
  const reason = !best.intent.active ? 'intent_inactive' : !binding?.active ? 'workflow_inactive' : ambiguous ? 'ambiguous' : !collectionQualified ? 'below_threshold' : best.missing.length ? 'missing_slots' : !thresholdMet ? 'below_threshold' : 'matched';
  return { intentKey: best.intent.intentKey, interest: best.intent.displayName, workflowKey: binding?.active ? best.intent.workflowKey : null, score: best.score, confidence: best.confidence, catalogVersionId: version.id, confirmationRequired: best.intent.confirmationRequired, missingSlots: best.missing, actionAllowed, ambiguous, runnerUpIntentKey: runnerUp?.intent.intentKey ?? null, reason };
};

const relatedIntent = (version: IntentCatalogVersion, left: string, right: string): boolean => version.catalog.relations.some((relation) => (relation.sourceIntent === left && relation.relatedIntent === right) || (relation.sourceIntent === right && relation.relatedIntent === left));

export const resolveIntent = (version: IntentCatalogVersion, inputText: string, slotValuesByKey: Record<string, string> = {}): IntentResolution => resolutionFrom(version, rankIntentCandidates(version, inputText, slotValuesByKey));

export const resolveIntentContinuity = (version: IntentCatalogVersion, input: IntentContinuityInput): IntentContinuityResolution => {
  const slotValuesByKey = input.slotValues ?? {};
  const clarificationStopWords = new Set(['a', 'am', 'for', 'have', 'i', 'is', 'it', 'my', 'need', 'please', 'the', 'to', 'want']);
  const meaningfulTokens = (value: string): string[] => normalize(value).replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((token) => token.length >= 4 && !clarificationStopWords.has(token));
  const promoteExplicitReply = (candidates: RankedIntent[]): RankedIntent[] => candidates.map((candidate) => {
    if (!input.selectedIntentKey || candidate.intent.intentKey !== input.selectedIntentKey) return candidate;
    const normalizedCurrent = normalize(input.currentText);
    const isShortExactSignal = normalizedCurrent.split(' ').length <= 8 && version.catalog.signals.some((signal) => signal.intentKey === candidate.intent.intentKey && signal.signalType !== 'exclusion' && normalize(signal.value) === normalizedCurrent);
    if (!isShortExactSignal) return candidate;
    const score = Math.max(candidate.score, candidate.intent.minimumScore, Math.ceil(candidate.intent.confidenceThreshold * 100));
    return { ...candidate, score, confidence: Math.min(1, score / 100) };
  });
  const addClarificationSynonym = (candidates: RankedIntent[]): RankedIntent[] => {
    if (!input.selectedIntentKey || normalize(input.currentText).split(' ').length > 8) return candidates;
    const intent = version.catalog.intents.find((candidate) => candidate.intentKey === input.selectedIntentKey);
    const currentTokens = meaningfulTokens(input.currentText);
    const matchesCatalogVocabulary = intent && currentTokens.some((token) => version.catalog.signals.some((signal) => signal.intentKey === intent.intentKey && signal.signalType !== 'exclusion' && meaningfulTokens(signal.value).includes(token)));
    if (!intent || !matchesCatalogVocabulary) return candidates;
    const score = Math.max(intent.minimumScore, Math.ceil(intent.confidenceThreshold * 100));
    if (candidates.some((candidate) => candidate.intent.intentKey === input.selectedIntentKey)) return candidates.map((candidate) => candidate.intent.intentKey === input.selectedIntentKey ? { ...candidate, score: Math.max(candidate.score, score), confidence: Math.min(1, Math.max(candidate.confidence, score / 100)) } : candidate);
    return [{ intent, score, confidence: Math.min(1, score / 100), matchedCount: 1, strongPhraseMatched: false, missing: missingSlotKeys(intent.intentKey, version.catalog.slots, slotValuesByKey) }, ...candidates];
  };
  const currentCandidates = addClarificationSynonym(promoteExplicitReply(rankIntentCandidates(version, input.currentText, slotValuesByKey)));
  const contextCandidates = addClarificationSynonym(promoteExplicitReply(rankIntentCandidates(version, input.contextText?.trim() || input.currentText, slotValuesByKey)));
  const current = resolutionFrom(version, currentCandidates);
  const context = resolutionFrom(version, contextCandidates);
  const selected = input.selectedIntentKey
    ? contextCandidates.find((candidate) => candidate.intent.intentKey === input.selectedIntentKey)
      ?? currentCandidates.find((candidate) => candidate.intent.intentKey === input.selectedIntentKey)
      ?? (input.pendingPromptType ? (() => {
        const intent = version.catalog.intents.find((candidate) => candidate.intentKey === input.selectedIntentKey);
        return intent ? { intent, score: Math.max(intent.minimumScore, Math.ceil(intent.confidenceThreshold * 100)), confidence: Math.max(intent.confidenceThreshold, intent.minimumScore / 100), matchedCount: 0, strongPhraseMatched: false, missing: missingSlotKeys(intent.intentKey, version.catalog.slots, slotValuesByKey) } : undefined;
      })() : undefined)
    : undefined;
  const best = contextCandidates[0] ?? currentCandidates[0];
  let primary = context;
  const currentTop = currentCandidates[0];
  const currentIsStrong = Boolean(currentTop && currentTop.score >= currentTop.intent.minimumScore && currentTop.confidence >= currentTop.intent.confidenceThreshold);
  const collectingSelectedIntent = Boolean(selected && (input.pendingPromptType === 'clarification' || input.pendingPromptType === 'slot' || input.pendingPromptType === 'consent' || input.pendingPromptType === 'document') && (!currentTop || currentTop.intent.intentKey === selected.intent.intentKey || !currentIsStrong));
  if (collectingSelectedIntent && selected) {
    const score = Math.max(selected.score, selected.intent.minimumScore, Math.ceil(selected.intent.confidenceThreshold * 100));
    primary = resolutionFrom(version, [{ ...selected, score, confidence: Math.min(1, score / 100) }]);
  } else if (selected && best && best.intent.intentKey !== selected.intent.intentKey) {
    const currentTop = currentCandidates[0];
    const currentIsStrong = Boolean(currentTop && currentTop.score >= currentTop.intent.minimumScore && currentTop.confidence >= currentTop.intent.confidenceThreshold);
    const switchPrimary = Boolean(currentTop && currentTop.intent.intentKey !== selected.intent.intentKey && currentIsStrong && !relatedIntent(version, selected.intent.intentKey, currentTop.intent.intentKey));
    primary = switchPrimary && currentTop ? resolutionFrom(version, [currentTop]) : resolutionFrom(version, [selected, ...contextCandidates.filter((candidate) => candidate.intent.intentKey !== selected.intent.intentKey)]);
  } else if (selected && !best) {
    primary = resolutionFrom(version, [selected]);
  }
  const secondaryIntentKeys = [...new Set([...contextCandidates, ...currentCandidates].map((candidate) => candidate.intent.intentKey).filter((intentKey) => intentKey !== primary.intentKey))].slice(0, 8);
  return { primary, current, context, secondaryIntentKeys };
};

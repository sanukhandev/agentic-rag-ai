import type { IntentCatalog, IntentCatalogDocumentPolicy, IntentCatalogDocumentSettings, IntentCatalogIntent, IntentCatalogQualityRule, IntentCatalogSlot, IntentCatalogVersion } from './types.js';

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
const keyPattern = /^[a-z][a-z0-9._-]{1,79}$/;
const safePath = (value: string): boolean => /^\/[A-Za-z0-9._/-]{1,120}$/.test(value) && !value.includes('..');

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
  const documentPoliciesInput = Array.isArray(value.documentPolicies) ? value.documentPolicies : [];
  const parsedDocumentPolicies: IntentCatalogDocumentPolicy[] = documentPoliciesInput.map((item, index) => {
    const row = record(item);
    const policy: IntentCatalogDocumentPolicy = { intentKey: text(row.intentKey), enabled: bool(row.enabled), workflowKey: text(row.workflowKey), requestMode: text(row.requestMode) as IntentCatalogDocumentPolicy['requestMode'], required: bool(row.required), requestPromptKey: text(row.requestPromptKey), allowedDocumentTypes: Array.isArray(row.allowedDocumentTypes) ? row.allowedDocumentTypes.map(text).filter(Boolean) : [], allowUserInitiated: bool(row.allowUserInitiated), consentRequired: bool(row.consentRequired), preservePrimaryIntent: bool(row.preservePrimaryIntent), storeExtractedText: bool(row.storeExtractedText), summaryTarget: text(row.summaryTarget), autoCreateLead: bool(row.autoCreateLead), autoIndexInRag: bool(row.autoIndexInRag), notes: text(row.notes) };
    if (!intentSet.has(policy.intentKey) || !workflowSet.has(policy.workflowKey) || !['conditional_offer', 'user_offer_only', 'explicit_upload'].includes(policy.requestMode) || !policy.allowedDocumentTypes.length || !policy.requestPromptKey) errors.push(`DocumentPolicies row ${index + 2} has invalid references or required fields.`);
    return policy;
  });
  const catalog: IntentCatalog = { tenantScope: text(value.tenantScope) || null, intents: parsedIntents, signals: parsedSignals, slots: parsedSlots, relations: parsedRelations, workflowBindings: parsedBindings, qualityRules: parsedQualityRules, ...(documentSettings ? { documentSettings } : {}), ...(documentPoliciesInput.length ? { documentPolicies: parsedDocumentPolicies } : {}) };
  if (catalog.intents.length === 0) errors.push('Catalog must contain at least one intent.');
  if (catalog.workflowBindings.length === 0) errors.push('Catalog must contain at least one workflow binding.');
  return { errors: [...new Set(errors)], catalog: errors.length ? null : catalog };
};

const slotValues = (intentKey: string, slots: IntentCatalogSlot[], values: Record<string, string>): Set<string> => {
  const rows = slots.filter((slot) => slot.intentKey === intentKey);
  const present = new Set(rows.filter((slot) => Boolean(values[slot.slotKey])).map((slot) => slot.slotKey));
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

const slotLabel = (slot: IntentCatalogSlot): string => {
  if (slot.dataType === 'person_name' || slot.slotKey === 'name') return 'name';
  if (slot.dataType === 'email' || slot.dataType === 'phone' || slot.alternativeGroup === 'contact') return 'email address or phone number';
  return slot.slotKey.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'this information';
};

export const catalogSlotQuestion = (version: IntentCatalogVersion, intentKey: string, slotKey: string): string => {
  const slot = version.catalog.slots.find((candidate) => candidate.intentKey === intentKey && candidate.slotKey === slotKey);
  if (!slot) return 'To continue, could you provide the requested information?';
  if (slot.promptKey === 'lead.ask_name') return 'What name should I use?';
  if (slot.promptKey === 'lead.ask_contact') return 'What’s the best email address or phone number to reach you on?';
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

export const resolveIntent = (version: IntentCatalogVersion, inputText: string, slotValuesByKey: Record<string, string> = {}): IntentResolution => {
  const input = normalize(inputText);
  const candidates = version.catalog.intents.map((intent) => {
    const signals = version.catalog.signals.filter((signal) => signal.intentKey === intent.intentKey);
    const matched = signals.filter((signal) => signal.value && (signal.signalType === 'keyword' ? new RegExp(`\\b${normalize(signal.value).replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\b`, 'i').test(input) : input.includes(normalize(signal.value))));
    const signalScore = matched.reduce((sum, signal) => sum + signal.weight, 0);
    const filled = slotValues(intent.intentKey, version.catalog.slots, slotValuesByKey);
    const slotScore = Math.min(50, filled.size * 20);
    const score = clamp(signalScore + slotScore);
    return { intent, score, confidence: Math.min(1, score / 100), matchedCount: matched.filter((signal) => signal.signalType !== 'exclusion').length, missing: missingSlotKeys(intent.intentKey, version.catalog.slots, slotValuesByKey) };
  }).filter((candidate) => candidate.matchedCount > 0).sort((left, right) => right.score - left.score || right.intent.priority - left.intent.priority);
  const best = candidates[0];
  if (!best) return { intentKey: null, interest: null, workflowKey: null, score: 0, confidence: 0, catalogVersionId: version.id, confirmationRequired: false, missingSlots: [], actionAllowed: false, ambiguous: false, runnerUpIntentKey: null, reason: 'no_signal' };
  const runnerUp = candidates[1];
  const ambiguous = Boolean(runnerUp && Math.abs(best.score - runnerUp.score) <= 10 && best.intent.priority === runnerUp.intent.priority);
  const binding = version.catalog.workflowBindings.find((item) => item.workflowKey === best.intent.workflowKey);
  const thresholdMet = best.score >= best.intent.minimumScore && best.confidence >= best.intent.confidenceThreshold;
  const actionAllowed = best.intent.active && Boolean(binding?.active) && thresholdMet && !ambiguous && best.missing.length === 0;
  return { intentKey: best.intent.intentKey, interest: best.intent.displayName, workflowKey: binding?.active ? best.intent.workflowKey : null, score: best.score, confidence: best.confidence, catalogVersionId: version.id, confirmationRequired: best.intent.confirmationRequired, missingSlots: best.missing, actionAllowed, ambiguous, runnerUpIntentKey: runnerUp?.intent.intentKey ?? null, reason: !best.intent.active ? 'intent_inactive' : !binding?.active ? 'workflow_inactive' : ambiguous ? 'ambiguous' : !thresholdMet ? 'below_threshold' : best.missing.length ? 'missing_slots' : 'matched' };
};

import { z } from 'zod';
import type { ModelEvidence, ChatModel, ModelToolPlan } from './model.js';
import type { IntentCatalogVersion, Session, Store } from './types.js';
import { catalogNextFollowUpRequirement, catalogNextJourneyRequirement } from './intent-catalog.js';

export const agentToolNames = [
  'get_active_opportunity',
  'get_conversation_summary',
  'get_confirmed_customer_facts',
  'get_pending_requirements',
  'get_customer_registration_status',
  'get_catalog_intents',
  'get_setup_requirements',
  'search_approved_knowledge',
  'get_available_packages',
  'get_authoritative_pricing',
  'get_package_document_requirements',
  'get_crm_status',
  'get_document_processing_status',
  'get_invoice_status',
  'get_contract_status',
] as const;

export type AgentToolName = (typeof agentToolNames)[number];

const toolInput = z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).default({});
const toolCallSchema = z.object({ name: z.enum(agentToolNames), input: toolInput }).strict();

export interface AgentToolContext {
  store: Store;
  session: Session;
  catalog: IntentCatalogVersion | null;
  opportunityId: string | null;
  maskedQuery: string;
  retrieve?: (query: string) => Promise<ModelEvidence[]>;
}

export interface AgentToolResult {
  name: AgentToolName;
  ok: boolean;
  data: Record<string, unknown>;
  errorCode?: 'TOOL_NOT_AVAILABLE' | 'TOOL_INPUT_INVALID' | 'TOOL_SCOPE_DENIED' | 'TOOL_FAILED';
}

const activeIntent = (context: AgentToolContext): string | null => {
  const state = context.session.conversationState;
  return state?.activeFollowUpIntentKey ?? state?.intentProgress?.activeIntentKey ?? state?.selectedIntentKey ?? null;
};

const scopedEntry = (context: AgentToolContext) => {
  const intentKey = activeIntent(context);
  const entry = intentKey ? context.session.conversationState?.intentProgress?.entries[intentKey] : null;
  if (context.opportunityId && entry?.journeyId && entry.journeyId !== context.opportunityId) return null;
  return entry;
};

const unavailable = (name: AgentToolName, reason: string): AgentToolResult => ({ name, ok: false, errorCode: 'TOOL_NOT_AVAILABLE', data: { status: 'unavailable', reason } });

const executeReadTool = async (name: AgentToolName, context: AgentToolContext, input: Record<string, string | number | boolean | null> = {}): Promise<AgentToolResult> => {
  const state = context.session.conversationState;
  const entry = scopedEntry(context);
  const intentKey = activeIntent(context);
  const journeyValues = entry?.slotValues ?? state?.slotValues ?? {};
  const packageInput = { catalogVersionId: context.catalog?.id ?? state?.catalogVersionId ?? null, ...(journeyValues.business_activity ? { activity: journeyValues.business_activity } : {}), ...(journeyValues.entity_type ? { entityType: journeyValues.entity_type } : {}) };
  switch (name) {
    case 'get_active_opportunity':
      return { name, ok: true, data: { opportunityId: entry?.journeyId ?? context.opportunityId, intentKey, status: entry?.status ?? 'discovery', catalogVersionId: state?.catalogVersionId ?? context.catalog?.id ?? null } };
    case 'get_conversation_summary':
      return { name, ok: true, data: { summary: (state?.rollingSummary ?? '').slice(-4_000), phase: state?.phase ?? 'DISCOVERY', workflowStatus: state?.workflowStatus ?? 'none' } };
    case 'get_confirmed_customer_facts':
      return { name, ok: true, data: { facts: Object.fromEntries(Object.entries(state?.slotValues ?? {}).filter(([key]) => key !== 'contact_consent').map(([key, value]) => [key, { value, provenance: state?.slotProvenance?.[key] ?? null }])) } };
    case 'get_pending_requirements': {
      if (!context.catalog || !intentKey) return { name, ok: true, data: { requirement: null, status: 'not_started' } };
      const requirement = catalogNextJourneyRequirement(context.catalog, intentKey, journeyValues, entry?.completedRequirementKeys ?? [])
        ?? catalogNextFollowUpRequirement(context.catalog, intentKey, journeyValues, entry?.completedRequirementKeys ?? []);
      return { name, ok: true, data: { requirement: requirement ? { requirementKey: requirement.requirementKey, requirementType: requirement.requirementType, promptKey: requirement.promptKey, documentType: requirement.documentType } : null } };
    }
    case 'get_customer_registration_status': {
      const actions = await context.store.listActionsBySession(context.session.id, context.session.tenantId);
      const scoped = actions.filter((action) => !context.opportunityId || action.opportunityId === context.opportunityId);
      const lead = await context.store.getCrmLeadBySessionId(context.session.id, context.session.tenantId);
      return { name, ok: true, data: { lead: lead ? { id: lead.id, remoteLeadId: lead.leadId ?? null, status: lead.leadId ? 'verified' : 'pending' } : null, actions: scoped.map((action) => ({ id: action.id, workflowKey: action.workflowKey, state: action.state, externalReference: action.result?.externalReference ?? null })) } };
    }
    case 'get_catalog_intents':
      return { name, ok: true, data: { catalogVersionId: context.catalog?.id ?? null, intents: (context.catalog?.catalog.intents ?? []).filter((intent) => intent.active).map((intent) => ({ key: intent.intentKey, name: intent.displayName, description: intent.description })) } };
    case 'get_setup_requirements':
      return { name, ok: true, data: { intentKey, requirements: (context.catalog?.catalog.journeyRequirements ?? []).filter((requirement) => !intentKey || requirement.intentKey === intentKey).map((requirement) => ({ key: requirement.requirementKey, type: requirement.requirementType, required: requirement.required, sourceOfTruth: requirement.sourceOfTruth })) } };
    case 'search_approved_knowledge':
      if (!context.retrieve) return unavailable(name, 'Approved retrieval is not configured for this turn.');
      return { name, ok: true, data: { evidence: await context.retrieve(context.maskedQuery) } };
    case 'get_available_packages': {
      const offerings = await context.store.listPackageOfferings(context.session.tenantId, packageInput);
      return { name, ok: true, data: { status: offerings.length > 0 ? 'available' : 'unavailable', packages: offerings.map((offering) => ({ id: offering.id, key: offering.packageKey, name: offering.name, visas: offering.includedVisaQuantity, officeRequirement: offering.officeRequirement, inclusions: offering.inclusions, availability: offering.availability })) } };
    }
    case 'get_authoritative_pricing': {
      const offerings = await context.store.listPackageOfferings(context.session.tenantId, packageInput);
      return { name, ok: true, data: { status: offerings.some((offering) => offering.priceMinor !== null) ? 'available' : 'unavailable', pricing: offerings.map((offering) => ({ packageId: offering.id, name: offering.name, amountMinor: offering.priceMinor, currency: offering.currency, effectiveFrom: offering.pricingEffectiveFrom, effectiveTo: offering.pricingEffectiveTo, sourceRefs: offering.sourceRefs })) } };
    }
    case 'get_package_document_requirements': {
      const offerings = await context.store.listPackageOfferings(context.session.tenantId, packageInput);
      return { name, ok: true, data: { requirements: offerings.map((offering) => ({ packageId: offering.id, packageName: offering.name, documents: offering.requiredDocuments })) } };
    }
    case 'get_crm_status': {
      const lead = await context.store.getCrmLeadBySessionId(context.session.id, context.session.tenantId);
      return { name, ok: true, data: { leadId: lead?.leadId ?? null, crm: lead?.remoteCrm ?? null, verified: Boolean(lead?.leadId && lead?.remoteCrm), account: { status: 'not_created', reason: 'Lead conversion is conditional and has not been verified for this opportunity.' } } };
    }
    case 'get_document_processing_status':
      return { name, ok: true, data: { documents: (await context.store.listSupportingDocuments(context.session.tenantId, context.session.id)).filter((document) => !context.opportunityId || document.opportunityId === context.opportunityId).map((document) => ({ id: document.id, requirementKey: document.requirementKey ?? null, type: document.expectedDocumentType ?? null, status: document.status, summaryAvailable: Boolean(document.summary) })) } };
    case 'get_invoice_status': {
      if (!context.opportunityId) return unavailable(name, 'No active opportunity is available for invoice lookup.');
      const selection = (await context.store.listPackageSelections(context.session.tenantId, context.opportunityId)).find((candidate) => candidate.status === 'confirmed' && candidate.quoteId);
      const quote = selection?.quoteId ? await context.store.getQuote(selection.quoteId, context.session.tenantId) : null;
      const invoice = quote ? await context.store.getInvoiceByQuote(quote.id, context.session.tenantId) : null;
      return { name, ok: true, data: { status: invoice?.status ?? 'not_created', invoice: invoice ? { id: invoice.id, externalInvoiceId: invoice.externalInvoiceId, amountMinor: invoice.amountMinor, currency: invoice.currency, paymentUrl: invoice.paymentUrl, status: invoice.status } : null } };
    }
    case 'get_contract_status': {
      const contractId = typeof input.contractId === 'string' ? input.contractId : null;
      if (!contractId) return unavailable(name, 'A contract identifier is required for status lookup.');
      const contract = await context.store.getContract(contractId, context.session.tenantId);
      if (!contract || (context.opportunityId && contract.opportunityId !== context.opportunityId)) return unavailable(name, 'The contract is not associated with this tenant opportunity.');
      return { name, ok: true, data: { status: contract.status, contract: { id: contract.id, externalContractId: contract.externalContractId, signingUrl: contract.signingUrl, templateKey: contract.templateKey } } };
    }
  }
};

const deterministicPlan = (context: AgentToolContext): ModelToolPlan => {
  const query = context.maskedQuery.toLocaleLowerCase('en-US');
  const names: AgentToolName[] = ['get_active_opportunity', 'get_confirmed_customer_facts', 'get_pending_requirements'];
  if (/[?]|\b(?:what|how|where|which|why|when|price|pricing|cost|timeline|visa|office|package|document|requirement|process)\b/u.test(query)) names.push('search_approved_knowledge');
  if (/\b(?:package|option|price|pricing|cost|quote|quotation)\b/u.test(query)) names.push('get_available_packages', 'get_authoritative_pricing');
  if (/\b(?:document|passport|upload|ocr|file)\b/u.test(query)) names.push('get_package_document_requirements', 'get_document_processing_status');
  if (/\b(?:lead|account|contact|registration|crm|status)\b/u.test(query)) names.push('get_customer_registration_status', 'get_crm_status');
  if (/\b(?:invoice|payment)\b/u.test(query)) names.push('get_invoice_status');
  if (/\b(?:contract|sign|signature)\b/u.test(query)) names.push('get_contract_status');
  return { calls: [...new Set(names)].slice(0, 8).map((name) => ({ name, input: {} })) };
};

export const runAgentTools = async (model: Pick<ChatModel, 'plan'>, context: AgentToolContext): Promise<AgentToolResult[]> => {
  const fallback = deterministicPlan(context);
  const bounded = (candidate: ModelToolPlan): { calls: Array<z.infer<typeof toolCallSchema>> } => ({ calls: candidate.calls.map((call) => toolCallSchema.safeParse(call)).filter((result): result is { success: true; data: z.infer<typeof toolCallSchema> } => result.success).map((result) => result.data).slice(0, 8) });
  let plan: { calls: Array<z.infer<typeof toolCallSchema>> } = bounded(fallback);
  if (model.plan) {
    try {
      const candidate = await model.plan({ maskedMessage: context.maskedQuery, availableTools: agentToolNames, conversationSummary: context.session.conversationState?.rollingSummary ?? '', activeIntentKey: activeIntent(context) });
      const safePlan = bounded(candidate);
      if (safePlan.calls.length > 0) plan = safePlan;
    } catch {
      plan = bounded(fallback);
    }
  }
  const results: AgentToolResult[] = [];
  for (const call of plan.calls) results.push(await executeReadTool(call.name, context, call.input));
  return results;
};

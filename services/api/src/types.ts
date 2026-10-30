export type Role = 'platform_admin' | 'tenant_admin' | 'tenant_editor' | 'tenant_viewer' | 'tenant_agent';
export type Audience = 'public' | 'internal';
export type SourceStatus = 'awaiting_review' | 'active' | 'revoked';
export type ActionState = 'awaiting_confirmation' | 'approved' | 'processing' | 'completed' | 'failed' | 'reconcile_required' | 'awaiting_customer' | 'human_review' | 'unknown';
export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'archived';
export type IngestionJobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type SupportingDocumentStatus = 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed' | 'reconciliation';
export type DocumentJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'reconciliation';

export type EventStream = 'rag:v2:crm' | 'rag:v2:documents' | 'rag:v2:actions' | 'rag:v2:notifications' | 'rag:v2:ingestion' | 'rag:v2:dead-letter';
export type DomainEventType =
  | 'crm.contact.upsert.requested.v1'
  | 'crm.summary.update.requested.v1'
  | 'crm.reconcile.requested.v1'
  | 'document.extraction.requested.v1'
  | 'intent.action.requested.v1'
  | 'conversation.notification.requested.v1'
  | 'ingestion.progress.v1';

export type EventPayload = Record<string, string | number | boolean | null>;
export type EventInboxState = 'pending' | 'processing' | 'completed' | 'retry_scheduled' | 'reconcile_required' | 'dead_lettered';

export interface EventInboxClaim {
  state: EventInboxState;
  attempts: number;
  claimed: boolean;
  dlqPublished: boolean;
}

export interface ActionExecution {
  id: string;
  actionId: string;
  tenantId: string;
  workflowKey: string;
  catalogVersionId: string | null;
  providerStatus: string;
  n8nExecutionRef: string | null;
  eventId?: string | null;
  correlationId?: string | null;
  idempotencyKey: string;
  attempt: number;
  deadlineAt: string | null;
  outcome: Record<string, string | number | boolean | null> | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowActionClaim {
  action: ActionRequest;
  execution: ActionExecution;
}

export interface OutboxEvent {
  eventId: string;
  eventType: DomainEventType;
  stream: EventStream;
  tenantId: string;
  sessionId: string | null;
  actionId: string | null;
  aggregateId: string;
  aggregateVersion: number;
  workflowKey: string | null;
  payloadRef: string;
  idempotencyKey: string;
  correlationId: string;
  payload: EventPayload;
  occurredAt: string;
  publishedAt: string | null;
  attempts: number;
  leaseExpiresAt: string | null;
  lastError: string | null;
}

export type ConversationPhase = 'DISCOVERY' | 'INTENT_CLARIFICATION' | 'SLOT_COLLECTION' | 'CONTACT_COLLECTION' | 'CONSENT_PENDING' | 'DOCUMENT_COLLECTION' | 'ACTION_CONFIRMATION' | 'QUEUED' | 'SUCCEEDED' | 'RECONCILE_REQUIRED' | 'HUMAN_REVIEW' | 'FAILED';
export type ConversationWorkflowStatus = 'none' | 'queued' | 'processing' | 'succeeded' | 'reconcile_required' | 'human_review' | 'awaiting_customer' | 'failed';

export interface PendingPrompt {
  id: string;
  type: 'clarification' | 'slot' | 'consent' | 'confirmation' | 'document';
  intentKey: string | null;
  slotKey: string | null;
  requirementKey?: string | null;
  issuedAt: string;
}

export interface FollowUpOfferOption {
  key: string;
  label: string;
  retrievalHints: string[];
}

export interface PendingFollowUpOffer {
  offerKey: string;
  intentKey: string | null;
  sourceMessageId: string | null;
  sourceQuery: string;
  options: FollowUpOfferOption[];
  issuedAt: string;
  expiresAt: string;
}

export type IntentCatalogRequirementType = 'slot' | 'document' | 'consent' | 'confirmation';
export type IntentCatalogFulfillmentMode = 'conversation_ready' | 'external_confirmation_required';
export type IntentCatalogActivationMode = 'offer' | 'automatic';

export interface IntentCatalogJourneyRequirement {
  intentKey: string;
  requirementKey: string;
  requirementType: IntentCatalogRequirementType;
  required: boolean;
  collectionOrder: number;
  promptKey: string;
  validationRule: string;
  slotKey: string | null;
  documentType: string | null;
  fulfillmentMode: IntentCatalogFulfillmentMode;
  sourceOfTruth: string;
  visitorConfirmationText?: string;
  notes: string;
}

export interface IntentCatalogJourneyTransition {
  sourceIntentKey: string;
  targetIntentKey: string;
  activationMode: IntentCatalogActivationMode;
  maxDepth: number;
  triggerGroup: string;
  promptKey: string;
  notes: string;
}

export interface IntentCatalogBusinessStage {
  order: number;
  stageKey: LifecycleStage;
  displayName: string;
  authoritativeOwner: string;
  prerequisiteExpression: string;
  successEvidence: string;
  workflowKey: string;
  onFailure: string;
  testRequirement: string;
  status: 'PROPOSED' | 'ACTIVE';
}

export const lifecycleStages = ['lead_generation', 'lead_qualification', 'account_creation', 'package_selection', 'document_upload', 'billing_invoice', 'contract'] as const;
export type LifecycleStage = typeof lifecycleStages[number];
export type LifecycleStageStatus = 'not_started' | 'awaiting_customer' | 'ready' | 'processing' | 'completed' | 'failed' | 'reconcile_required' | 'human_review';

export interface LifecycleStageState {
  stage: LifecycleStage;
  status: LifecycleStageStatus;
  revision: number;
  evidence: Record<string, string | number | boolean>;
  completedAt: string | null;
}

export interface LifecycleState {
  currentStage: LifecycleStage;
  revision: number;
  stages: Record<LifecycleStage, LifecycleStageState>;
}

export interface IntentProgressEntry {
  intentKey: string;
  /** Durable opportunity identity. Legacy sessions may not have this until resumed. */
  journeyId?: string;
  status: 'active' | 'paused' | 'fulfilled';
  completedRequirementKeys: string[];
  currentRequirementKey: string | null;
  /** Facts belong to this opportunity, never to the whole conversation. */
  slotValues?: Record<string, string>;
  slotProvenance?: Record<string, { source: 'visitor'; messageSequence: number; capturedAt: string; corrected: boolean }>;
  lifecycle?: LifecycleState;
  revision: number;
}

export interface IntentProgressState {
  version: 1;
  activeIntentKey: string | null;
  pausedIntentKeys: string[];
  fulfilledIntentKeys: string[];
  entries: Record<string, IntentProgressEntry>;
  /** Primary journey instance index; entries remains a legacy intent-key projection. */
  journeys?: Record<string, IntentProgressEntry>;
  visitedIntentKeys: string[];
  lastTransitionReason: string | null;
  lastDeclinedTransition?: {
    sourceIntentKey: string;
    targetIntentKey: string;
    catalogVersionId: string;
  };
  journeyRevision: number;
}

export interface ConversationState {
  phase: ConversationPhase;
  catalogVersionId: string | null;
  candidateIntentKeys: string[];
  selectedIntentKey: string | null;
  /** The catalog journey currently being collected after the primary opportunity was created. */
  activeFollowUpIntentKey?: string | null;
  intentScore?: number;
  intentConfidence?: number;
  intentEvidence?: string[];
  intentProgress?: IntentProgressState;
  slotValues: Record<string, string>;
  slotProvenance?: Record<string, { source: 'visitor'; messageSequence: number; capturedAt: string; corrected: boolean }>;
  pendingPrompt: PendingPrompt | null;
  pendingFollowUpOffer?: PendingFollowUpOffer | null;
  rollingSummary: string;
  summaryRevision: number;
  messageSequence: number;
  lastTurnAt?: string | null;
  workflowStatus: ConversationWorkflowStatus;
  contactConsent: 'unknown' | 'granted' | 'denied';
  consentVersion: string | null;
  consentCapturedAt: string | null;
}

export type IntentCatalogStatus = 'draft' | 'published';

export interface IntentCatalogIntent {
  intentKey: string;
  displayName: string;
  description: string;
  category: string;
  workflowKey: string;
  minimumScore: number;
  confidenceThreshold: number;
  confirmationRequired: boolean;
  active: boolean;
  priority: number;
  versionNote: string;
}

export interface IntentCatalogSignal {
  intentKey: string;
  signalId: string;
  signalType: 'phrase' | 'keyword' | 'exclusion';
  value: string;
  language: string;
  matchMode: string;
  weight: number;
  relationGroup: string | null;
  notes: string;
}

export interface IntentCatalogSlot {
  intentKey: string;
  slotKey: string;
  dataType: string;
  required: boolean;
  alternativeGroup: string | null;
  collectionOrder: number;
  promptKey: string;
  validationRule: string;
  retentionClass: string;
  qualityWeight?: number;
}

export interface IntentCatalogQualityRule {
  intentKey: string;
  qualityWorkflowKey: string;
  intentWeight: number;
  confidenceWeight: number;
  contactWeight: number;
  hotThreshold: number;
  warmThreshold: number;
  nurtureThreshold: number;
}

export interface IntentCatalogRelation {
  sourceIntent: string;
  relatedIntent: string;
  relationType: string;
  triggerGroup: string;
  scoreAdjustment: number;
  minimumCooccurrence: number;
  clarificationPromptKey: string;
}

export interface IntentCatalogWorkflowBinding {
  workflowKey: string;
  n8nWorkflowId: string;
  webhookPath: string;
  payloadContract: string;
  sideEffectClass: string;
  active: boolean;
}

export interface IntentCatalogDocumentPolicy {
  intentKey: string;
  enabled: boolean;
  workflowKey: string;
  requestMode: 'conditional_offer' | 'user_offer_only' | 'explicit_upload';
  required: boolean;
  requestPromptKey: string;
  allowedDocumentTypes: string[];
  allowUserInitiated: boolean;
  consentRequired: boolean;
  preservePrimaryIntent: boolean;
  storeExtractedText: boolean;
  summaryTarget: string;
  autoCreateLead: boolean;
  autoIndexInRag: boolean;
  notes: string;
}

export interface IntentCatalogDocumentSettings {
  schemaVersion: string;
  enabled: boolean;
  storageBackend: string;
  processingProvider: string;
  workflowKey: string;
  requireUploadConsent: boolean;
  maxFileBytes: number;
  maxFilesPerRequest: number;
  maxPdfPages: number;
  ocrLanguages: string[];
  allowedMimeTypes: string[];
  retentionPolicy: string;
  allowPublicDocumentUrls: boolean;
  allowAutomaticKnowledgeIngestion: boolean;
  allowPersonalIdentityDocumentsByDefault: boolean;
  summaryRendering: string;
  notes: string;
}

export type CrmAccountConversionRule = 'qualification_verified' | 'package_confirmed' | 'invoice_paid' | 'manual_approval';
export interface IntentCatalogCrmAccountConversionPolicy {
  intentKey: string;
  workflowKey: string;
  conversionRule: CrmAccountConversionRule;
  active: boolean;
  notes: string;
}

export type IntentCatalogExtensionRow = Record<string, string | number | boolean | null>;

export interface IntentCatalog {
  tenantScope: string | null;
  intents: IntentCatalogIntent[];
  signals: IntentCatalogSignal[];
  slots: IntentCatalogSlot[];
  relations: IntentCatalogRelation[];
  workflowBindings: IntentCatalogWorkflowBinding[];
  qualityRules?: IntentCatalogQualityRule[];
  journeyRequirements?: IntentCatalogJourneyRequirement[];
  journeyTransitions?: IntentCatalogJourneyTransition[];
  businessStages?: IntentCatalogBusinessStage[];
  documentPolicies?: IntentCatalogDocumentPolicy[];
  documentSettings?: IntentCatalogDocumentSettings;
  crmAccountConversionPolicies?: IntentCatalogCrmAccountConversionPolicy[];
  documentRequirements?: IntentCatalogExtensionRow[];
  crmFieldMappings?: IntentCatalogExtensionRow[];
  channelCapabilities?: IntentCatalogExtensionRow[];
  testUtterances?: IntentCatalogExtensionRow[];
  catalogManifest?: IntentCatalogExtensionRow[];
}

export interface IntentCatalogVersion {
  id: string;
  tenantId: string;
  version: number;
  status: IntentCatalogStatus;
  sourceFileName: string;
  sourceHash: string;
  parserVersion: string;
  catalog: IntentCatalog;
  createdAt: string;
  publishedAt: string | null;
}

export interface IntentCatalogV2Version {
  id: string;
  tenantId: string;
  version: number;
  status: IntentCatalogStatus;
  sourceFileName: string;
  sourceHash: string;
  parserVersion: string;
  catalog: CatalogV2Document;
  catalogVersionRef: string;
  createdAt: string;
  publishedAt: string | null;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  publicChatEnabled: boolean;
  publicOrigin: string | null;
  catalogQueryNormalizationEnabled: boolean;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  tenantId: string | null;
  createdAt: string;
}

export interface Persona {
  tenantId: string;
  name: string;
  greeting: string;
  personality: string;
  tone: string;
  speakingStyle: string;
  permittedLanguages: string[];
  contextWindowMessages: number;
  voiceName: string;
  voiceLanguage: string;
  voiceRate: number;
  voicePitch: number;
  voiceVolume: number;
}

export interface PersonaVersion extends Persona {
  id: string;
  version: number;
  status: 'draft' | 'published';
  createdAt: string;
  publishedAt: string | null;
}

export interface Source {
  id: string;
  tenantId: string;
  title: string;
  mimeType: string;
  sourceUrl: string | null;
  audience: Audience;
  status: SourceStatus;
  versionId: string;
  contentHash: string;
  embeddingReady: boolean;
  chunkCount?: number;
  createdAt: string;
  approvedAt: string | null;
}

export interface SourceVersion {
  sourceId: string;
  tenantId: string;
  versionId: string;
  contentHash: string;
  createdAt: string;
}

export interface TenantDomain {
  id: string;
  tenantId: string;
  hostname: string;
  createdAt: string;
}

export interface AuthSession {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type ChannelAuthMode = 'hmac' | 'api_key';

export interface ChannelCredential {
  id: string;
  tenantId: string;
  channel: string;
  authMode: ChannelAuthMode;
  keyId: string;
  secretCiphertext: string;
  apiKeyHash: string | null;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export interface IngestionJob {
  id: string;
  tenantId: string;
  title: string;
  mimeType: string;
  sourceUrl: string | null;
  audience: Audience;
  sourceId: string | null;
  status: IngestionJobStatus;
  attempts: number;
  errorCode: string | null;
  errorDetail: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Chunk {
  id: string;
  sourceId: string;
  tenantId: string;
  versionId: string;
  ordinal: number;
  locator: string;
  content: string;
  contentHash: string;
  embedding: number[];
}

export interface Session {
  id: string;
  tenantId: string;
  createdAt: string;
  lastActivityAt: string;
  closedAt: string | null;
  personaVersionId: string | null;
  tokenMap: Map<string, string>;
  conversationState?: ConversationState;
  stateVersion?: number;
}

export type FoundryConversationBindingStatus = 'active' | 'expired' | 'revoked';

export interface FoundryConversationBinding {
  id: string;
  tenantId: string;
  sessionId: string;
  foundryConversationId: string;
  foundryAgentId: string;
  foundryAgentVersion: string | null;
  status: FoundryConversationBindingStatus;
  revision: number;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface Message {
  id: string;
  sessionId: string;
  tenantId: string;
  role: 'user' | 'assistant';
  maskedContent: string;
  citations: Citation[];
  clientMessageId: string | null;
  response: Record<string, unknown> | null;
  createdAt: string;
}

export interface Citation {
  sourceId: string;
  versionId: string;
  chunkId: string;
  title: string;
  locator: string;
}

export interface LeadData {
  name?: string;
  email?: string;
  phone?: string;
  /** Server-derived catalog label. Never populated directly from the visitor. */
  interest?: string;
  slotValues?: Record<string, string>;
}

export interface ActionPayload extends LeadData {
  /** Server-recorded explicit contact consent; never inferred from contact data. */
  contactConsent?: boolean;
}

export interface LeadConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface CrmLead {
  id: string;
  tenantId: string;
  actionId: string;
  sessionId: string;
  intent: string;
  secondaryIntentKeys?: string[];
  intentScore: number;
  intentConfidence: number;
  catalogVersionId: string | null;
  score: number;
  contactCompletenessScore?: number;
  validationPass: boolean;
  qualificationStatus?: 'pending' | 'qualified' | 'disqualified' | 'reconcile_required';
  qualificationEvidence?: Record<string, string | number | boolean>;
  leadData: LeadData;
  conversation: LeadConversationMessage[];
  summary: string | null;
  summaryStatus: 'pending' | 'completed' | 'failed';
  leadId?: string | null;
  remoteCrm?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportingDocument {
  id: string;
  tenantId: string;
  sessionId: string;
  leadId: string | null;
  opportunityId?: string | null;
  intentKey?: string | null;
  catalogVersionId?: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  requirementKey?: string | null;
  expectedDocumentType?: string | null;
  storageKey: string;
  status: SupportingDocumentStatus;
  workflowKey: string;
  storeExtractedText: boolean;
  extractedText: string | null;
  summary: string | null;
  errorCode: string | null;
  consentAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrmLeadAssociation {
  id: string;
  tenantId: string;
  crmLeadId: string;
  actionId: string;
  sessionId: string;
  opportunityId: string | null;
  associationType: 'canonical' | 'deduplicated';
  createdAt: string;
}

export type PackageOfferingStatus = 'approved' | 'unavailable' | 'expired';
export interface PackageOffering {
  id: string;
  tenantId: string;
  catalogVersionId: string | null;
  packageKey: string;
  name: string;
  eligibleEntityTypes: string[];
  eligibleActivities: string[];
  includedVisaQuantity: number;
  officeRequirement: string | null;
  inclusions: string[];
  priceMinor: number | null;
  currency: string | null;
  pricingEffectiveFrom: string | null;
  pricingEffectiveTo: string | null;
  additionalFees: Array<Record<string, string | number>>;
  processingTime: string | null;
  requiredDocuments: string[];
  exclusions: string[];
  availability: string;
  approvalStatus: PackageOfferingStatus;
  sourceRefs: string[];
  createdAt: string;
}

export type PackageSelectionStatus = 'proposed' | 'confirmed' | 'rejected';
export interface PackageSelection {
  id: string;
  tenantId: string;
  sessionId: string;
  opportunityId: string;
  packageOfferingId: string;
  quoteId: string | null;
  status: PackageSelectionStatus;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type QuoteStatus = 'draft' | 'approved' | 'expired' | 'rejected';
export interface Quote {
  id: string;
  tenantId: string;
  opportunityId: string;
  packageOfferingId: string;
  amountMinor: number;
  currency: string;
  validUntil: string;
  status: QuoteStatus;
  sourceRefs: string[];
  createdAt: string;
}

export type CrmAccountStatus = 'pending' | 'verified' | 'reconcile_required' | 'failed';
export interface CrmAccount {
  id: string;
  tenantId: string;
  opportunityId: string;
  leadId: string;
  remoteAccountId: string | null;
  remoteContactId: string | null;
  remoteOpportunityId: string | null;
  status: CrmAccountStatus;
  conversionRule: CrmAccountConversionRule;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InvoiceStatus = 'draft' | 'pending' | 'paid' | 'failed' | 'reconcile_required';
export interface Invoice {
  id: string;
  tenantId: string;
  opportunityId: string;
  quoteId: string;
  externalInvoiceId: string | null;
  amountMinor: number;
  currency: string;
  paymentUrl: string | null;
  status: InvoiceStatus;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export type ContractStatus = 'draft' | 'approval_required' | 'sent' | 'signed' | 'failed' | 'reconcile_required';
export interface Contract {
  id: string;
  tenantId: string;
  opportunityId: string;
  packageSelectionId: string;
  invoiceId: string | null;
  externalContractId: string | null;
  templateKey: string;
  signingUrl: string | null;
  status: ContractStatus;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentProcessingJob {
  id: string;
  documentId: string;
  tenantId: string;
  workflowKey: string;
  webhookPath: string;
  status: DocumentJobStatus;
  attempts: number;
  leaseExpiresAt: string | null;
  executionReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionRequest {
  id: string;
  tenantId: string;
  sessionId: string;
  workflowKey: string;
  webhookPath?: string;
  intentKey?: string;
  intentScore?: number;
  intentConfidence?: number;
  catalogVersionId?: string | null;
  /** Business identity is separate from the workflow implementation key. */
  opportunityId?: string | null;
  actionKey?: string | null;
  actionRevision?: number;
  idempotencyKey: string;
  state: ActionState;
  opaqueReference: string;
  payload: ActionPayload;
  createdAt: string;
  result: { externalReference: string } | null;
}

export type LegacyActionAssignment =
  | { status: 'assigned' | 'already_assigned'; action: ActionRequest }
  | { status: 'not_found' | 'conflict'; action: null };

export interface LegacyJourneyAssociationResult {
  committed: boolean;
  session: Session;
  assignment: LegacyActionAssignment;
}

export interface AuditEvent {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  eventName: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export type IntentFactSource = 'visitor' | 'catalog' | 'node' | 'provider';

export interface UserIntentFact {
  maskedValue: string;
  source: IntentFactSource;
  messageSequence: number;
  evidenceRefs: string[];
  corrected: boolean;
}

export interface ApprovedIntentResponse {
  answer: string;
  grounded: boolean;
  citationRefs: string[];
  pendingRequirementKey: string | null;
}

export interface UserIntentDocument {
  id: string;
  tenantId: string;
  sessionId: string;
  opportunityId: string | null;
  catalogSource: 'legacy_v1' | 'v2';
  catalogVersionRef: string;
  personaVersionId: string | null;
  businessGoalKey: string | null;
  turnIntentKey: string | null;
  currentStageKey: string | null;
  stageRevision: number;
  goalConfirmed: boolean;
  verifiedFacts: Record<string, UserIntentFact>;
  pendingRequirementKey: string | null;
  lastQuestion: string | null;
  approvedResponse: ApprovedIntentResponse | null;
  toolRefs: string[];
  sourceRefs: string[];
  summary: string;
  summaryRevision: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface IntentTurnAssessment {
  id: string;
  documentId: string;
  tenantId: string;
  sessionId: string;
  opportunityId: string | null;
  turnSequence: number;
  clientMessageId: string;
  messageHash: string;
  businessGoalKey: string | null;
  turnIntentKey: string | null;
  intentCategory: string | null;
  verifiedFactPatch: Record<string, UserIntentFact>;
  pendingRequirementKey: string | null;
  lastQuestion: string | null;
  approvedResponse: ApprovedIntentResponse | null;
  toolRefs: string[];
  sourceRefs: string[];
  createdAt: string;
}

export interface TenantStats {
  sourceCounts: Record<SourceStatus, number>;
  ingestionJobs: Record<IngestionJobStatus, number>;
  sessions: number;
  messages: number;
  actions: number;
  auditEvents: number;
}

export interface Store {
  countUsers(): Promise<number>;
  createTenant(input: { name: string; slug: string }): Promise<Tenant>;
  getTenant(id: string): Promise<Tenant | null>;
  getTenantBySlug(slug: string): Promise<Tenant | null>;
  listTenants(): Promise<Tenant[]>;
  setTenantStatus(id: string, status: TenantStatus): Promise<Tenant | null>;
  setTenantPublicOrigin(id: string, publicOrigin: string | null): Promise<Tenant | null>;
  setTenantPublicChatEnabled(id: string, enabled: boolean): Promise<Tenant | null>;
  setTenantCatalogQueryNormalizationEnabled(id: string, enabled: boolean): Promise<Tenant | null>;
  listUsers(tenantId: string): Promise<User[]>;
  listDomains(tenantId: string): Promise<TenantDomain[]>;
  addDomain(input: { tenantId: string; hostname: string }): Promise<TenantDomain>;
  removeDomain(id: string, tenantId: string): Promise<boolean>;
  createUser(input: { email: string; passwordHash: string; role: Role; tenantId: string | null }): Promise<User>;
  getUserByEmail(email: string): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  updateUserRole(userId: string, tenantId: string, role: Exclude<Role, 'platform_admin' | 'tenant_admin'>): Promise<User | null>;
  createAuthSession(session: AuthSession): Promise<AuthSession>;
  getAuthSession(tokenHash: string): Promise<AuthSession | null>;
  revokeAuthSession(tokenHash: string): Promise<void>;
  claimCallbackNonce(nonce: string, expiresAt: string): Promise<boolean>;
  createChannelCredential(input: Omit<ChannelCredential, 'createdAt' | 'revokedAt'>): Promise<ChannelCredential>;
  getChannelCredential(keyId: string): Promise<ChannelCredential | null>;
  getChannelCredentialByApiKeyHash(apiKeyHash: string): Promise<ChannelCredential | null>;
  listChannelCredentials(tenantId: string): Promise<ChannelCredential[]>;
  revokeChannelCredential(id: string, tenantId: string): Promise<ChannelCredential | null>;
  setPersona(persona: Persona): Promise<Persona>;
  getPersona(tenantId: string): Promise<Persona | null>;
  createIntentCatalogVersion(input: Omit<IntentCatalogVersion, 'id' | 'version' | 'createdAt' | 'publishedAt'>): Promise<IntentCatalogVersion>;
  listIntentCatalogVersions(tenantId: string): Promise<IntentCatalogVersion[]>;
  getIntentCatalogVersion(tenantId: string, versionId: string): Promise<IntentCatalogVersion | null>;
  getPublishedIntentCatalog(tenantId: string): Promise<IntentCatalogVersion | null>;
  publishIntentCatalogVersion(tenantId: string, versionId: string): Promise<IntentCatalogVersion | null>;
  createIntentCatalogV2Version(input: Omit<IntentCatalogV2Version, 'id' | 'version' | 'createdAt' | 'publishedAt'>): Promise<IntentCatalogV2Version>;
  listIntentCatalogV2Versions(tenantId: string): Promise<IntentCatalogV2Version[]>;
  getIntentCatalogV2Version(tenantId: string, versionId: string): Promise<IntentCatalogV2Version | null>;
  publishIntentCatalogV2Version(tenantId: string, versionId: string): Promise<IntentCatalogV2Version | null>;
  createUserIntentDocument(document: UserIntentDocument): Promise<UserIntentDocument>;
  getUserIntentDocument(tenantId: string, sessionId: string): Promise<UserIntentDocument | null>;
  updateUserIntentDocument(input: { document: UserIntentDocument; expectedRevision: number }): Promise<UserIntentDocument | null>;
  appendIntentTurn(assessment: IntentTurnAssessment): Promise<IntentTurnAssessment>;
  listIntentTurns(tenantId: string, sessionId: string, limit?: number): Promise<IntentTurnAssessment[]>;
  createPersonaVersion(input: Omit<PersonaVersion, 'id' | 'version' | 'createdAt' | 'publishedAt'>): Promise<PersonaVersion>;
  listPersonaVersions(tenantId: string): Promise<PersonaVersion[]>;
  getPersonaVersion(tenantId: string, versionId: string): Promise<PersonaVersion | null>;
  publishPersonaVersion(tenantId: string, versionId: string): Promise<PersonaVersion | null>;
  createSource(input: Omit<Source, 'createdAt' | 'approvedAt'> & { chunks: Chunk[] }): Promise<Source>;
  getSource(id: string): Promise<Source | null>;
  findSourceByHash(tenantId: string, contentHash: string): Promise<Source | null>;
  listSources(tenantId: string): Promise<Source[]>;
  setSourceStatus(id: string, tenantId: string, status: SourceStatus): Promise<Source | null>;
  purgeSource(id: string, tenantId: string): Promise<boolean>;
  listSourceChunks(sourceId: string, tenantId: string): Promise<Chunk[]>;
  listSourceVersions(sourceId: string, tenantId: string): Promise<SourceVersion[]>;
  replaceSourceVersion(input: { sourceId: string; tenantId: string; versionId: string; contentHash: string; chunks: Chunk[] }): Promise<Source | null>;
  createIngestionJob(input: { id: string; tenantId: string; title: string; mimeType: string; sourceUrl: string | null; audience: Audience }): Promise<IngestionJob>;
  getIngestionJob(id: string): Promise<IngestionJob | null>;
  listIngestionJobs(tenantId: string): Promise<IngestionJob[]>;
  claimIngestionJob(id: string, leaseMs: number): Promise<IngestionJob | null>;
  claimNextIngestionJob(leaseMs: number): Promise<IngestionJob | null>;
  renewIngestionJob(id: string, leaseMs: number): Promise<IngestionJob | null>;
  updateIngestionJob(job: IngestionJob): Promise<IngestionJob>;
  listSearchableChunks(tenantId: string, audience: Audience): Promise<Array<{ source: Source; chunk: Chunk }>>;
  searchSearchableChunks(tenantId: string, audience: Audience, queryEmbedding: number[], limit: number, queryText?: string): Promise<Array<{ source: Source; chunk: Chunk }>>;
  createSession(tenantId: string, personaVersionId?: string | null): Promise<Session>;
  createSessionAccessToken(input: { sessionId: string; tokenHash: string; expiresAt: string }): Promise<void>;
  verifySessionAccessToken(sessionId: string, tokenHash: string): Promise<boolean>;
  revokeSessionAccessToken(sessionId: string): Promise<void>;
  getSession(id: string): Promise<Session | null>;
  getFoundryConversationBinding(tenantId: string, sessionId: string, foundryAgentId: string): Promise<FoundryConversationBinding | null>;
  createFoundryConversationBinding(binding: FoundryConversationBinding): Promise<FoundryConversationBinding>;
  touchFoundryConversationBinding(input: { id: string; tenantId: string; sessionId: string; lastUsedAt: string; expiresAt: string }): Promise<FoundryConversationBinding | null>;
  revokeFoundryConversationBinding(id: string, tenantId: string, sessionId: string): Promise<FoundryConversationBinding | null>;
  listExpiredSupportingDocuments(tenantId: string, before: string): Promise<SupportingDocument[]>;
  purgeExpiredSessions(tenantId: string, before: string): Promise<number>;
  updateSession(session: Session): Promise<Session>;
  addMessage(message: Message): Promise<Message>;
  updateMessage(message: Message): Promise<Message>;
  getMessageByClientId(sessionId: string, clientMessageId: string): Promise<Message | null>;
  listMessages(sessionId: string, tenantId: string, limit?: number): Promise<Message[]>;
  createAction(action: ActionRequest): Promise<ActionRequest>;
  approveAction(action: ActionRequest): Promise<ActionRequest>;
  approveActionAndSession(action: ActionRequest, session: Session): Promise<ActionRequest>;
  getAction(id: string): Promise<ActionRequest | null>;
  getActionByIdempotency(tenantId: string, idempotencyKey: string): Promise<ActionRequest | null>;
  getActionByIdentity(input: { tenantId: string; opportunityId: string; actionKey: string; actionRevision: number }): Promise<ActionRequest | null>;
  updateAction(action: ActionRequest): Promise<ActionRequest>;
  assignLegacyActionOpportunity(input: { tenantId: string; sessionId: string; actionId: string; intentKey: string; catalogVersionId?: string | null; opportunityId: string; eligibleStates: ActionState[] }): Promise<LegacyActionAssignment>;
  establishLegacyJourneyAndAssignAction(input: { session: Session; actionId: string; intentKey: string; catalogVersionId?: string | null; opportunityId: string; eligibleStates: ActionState[] }): Promise<LegacyJourneyAssociationResult>;
  transitionAction(actionId: string, tenantId: string, fromState: ActionState, toState: ActionState, result: ActionRequest['result']): Promise<ActionRequest | null>;
  retryActionAfterReconciliation(input: { actionId: string; tenantId: string; deadlineAt: string; reason: string }): Promise<{ action: ActionRequest; event: OutboxEvent } | null>;
  transitionActionWithExecution(input: { actionId: string; tenantId: string; fromState: ActionState; toState: ActionState; result: ActionRequest['result']; providerStatus: string; n8nExecutionRef: string; eventId: string; correlationId: string; expectedAttempt: number; resolveReconciliation?: boolean; outcome?: ActionExecution['outcome'] }): Promise<{ action: ActionRequest; execution: ActionExecution } | null>;
  claimWorkflowActionsWithExecutions(input: { actionId?: string; tenantId?: string; n8nWorkflowId: string; executionReference: string; workflowKey?: string; limit: number; eventId?: string; correlationId?: string; attempt: number; deadlineAt: string }): Promise<WorkflowActionClaim[]>;
  claimAction(actionId: string, workflowKey: string): Promise<ActionRequest | null>;
  claimActionsForWorkflow(n8nWorkflowId: string, workflowKey: string | undefined, limit: number): Promise<ActionRequest[]>;
  listActions(tenantId: string): Promise<ActionRequest[]>;
  listActionsBySession(sessionId: string, tenantId: string): Promise<ActionRequest[]>;
  createCrmLead(lead: CrmLead): Promise<CrmLead>;
  upsertCrmLead(lead: CrmLead, dedupeKey: string): Promise<CrmLead>;
  getCrmLeadByActionId(actionId: string, tenantId: string): Promise<CrmLead | null>;
  getCrmLeadBySessionId(sessionId: string, tenantId: string): Promise<CrmLead | null>;
  getCrmLead(id: string, tenantId: string): Promise<CrmLead | null>;
  listCrmLeads(tenantId: string): Promise<CrmLead[]>;
  updateCrmLeadSummary(id: string, tenantId: string, summary: string, status: CrmLead['summaryStatus']): Promise<CrmLead | null>;
  updateCrmLeadScore(id: string, tenantId: string, score: number): Promise<CrmLead | null>;
  updateCrmLeadQualification(id: string, tenantId: string, status: CrmLead['qualificationStatus'], evidence?: CrmLead['qualificationEvidence']): Promise<CrmLead | null>;
  updateCrmLeadRemote(input: { id: string; tenantId: string; leadId: string; remoteCrm: string }): Promise<CrmLead | null>;
  createCrmLeadAssociation(association: CrmLeadAssociation): Promise<CrmLeadAssociation>;
  getCrmLeadAssociationByActionId(actionId: string, tenantId: string): Promise<CrmLeadAssociation | null>;
  createSupportingDocument(document: SupportingDocument): Promise<SupportingDocument>;
  createSupportingDocumentWithJob(document: SupportingDocument, job: DocumentProcessingJob): Promise<void>;
  requeueSupportingDocumentWithJob(document: SupportingDocument, job: DocumentProcessingJob): Promise<DocumentProcessingJob>;
  getSupportingDocument(id: string, tenantId: string): Promise<SupportingDocument | null>;
  listSupportingDocuments(tenantId: string, sessionId?: string, leadId?: string): Promise<SupportingDocument[]>;
  updateSupportingDocument(document: SupportingDocument): Promise<SupportingDocument>;
  createDocumentProcessingJob(job: DocumentProcessingJob): Promise<DocumentProcessingJob>;
  getDocumentProcessingJob(id: string, tenantId: string): Promise<DocumentProcessingJob | null>;
  claimNextDocumentProcessingJob(leaseMs: number): Promise<DocumentProcessingJob | null>;
  renewDocumentProcessingJob(id: string, tenantId: string, leaseMs: number): Promise<DocumentProcessingJob | null>;
  updateDocumentProcessingJob(job: DocumentProcessingJob): Promise<DocumentProcessingJob>;
  linkSessionDocuments(sessionId: string, tenantId: string, leadId: string): Promise<void>;
  listPackageOfferings(tenantId: string, input?: { catalogVersionId?: string | null; activity?: string; entityType?: string }): Promise<PackageOffering[]>;
  getPackageOffering(id: string, tenantId: string): Promise<PackageOffering | null>;
  createPackageOffering(offering: PackageOffering): Promise<PackageOffering>;
  createPackageSelection(selection: PackageSelection): Promise<PackageSelection>;
  listPackageSelections(tenantId: string, opportunityId: string): Promise<PackageSelection[]>;
  getPackageSelection(id: string, tenantId: string): Promise<PackageSelection | null>;
  confirmPackageSelection(id: string, tenantId: string, quoteId: string): Promise<PackageSelection | null>;
  createQuote(quote: Quote): Promise<Quote>;
  getQuote(id: string, tenantId: string): Promise<Quote | null>;
  createCrmAccount(account: CrmAccount): Promise<CrmAccount>;
  getCrmAccount(id: string, tenantId: string): Promise<CrmAccount | null>;
  getCrmAccountByOpportunity(opportunityId: string, tenantId: string): Promise<CrmAccount | null>;
  updateCrmAccount(account: CrmAccount): Promise<CrmAccount>;
  createInvoice(invoice: Invoice): Promise<Invoice>;
  getInvoiceByQuote(quoteId: string, tenantId: string): Promise<Invoice | null>;
  getInvoice(id: string, tenantId: string): Promise<Invoice | null>;
  updateInvoice(invoice: Invoice): Promise<Invoice>;
  createContract(contract: Contract): Promise<Contract>;
  getContract(id: string, tenantId: string): Promise<Contract | null>;
  updateContract(contract: Contract): Promise<Contract>;
  enqueueOutboxEvent(event: OutboxEvent): Promise<OutboxEvent>;
  claimOutboxEvents(limit: number, leaseMs: number): Promise<OutboxEvent[]>;
  markOutboxPublished(eventId: string, publishedAt?: string): Promise<void>;
  releaseOutboxEvent(eventId: string, error: string, retryAt: string): Promise<void>;
  deadLetterOutboxEvent(eventId: string, error: string): Promise<void>;
  claimDeadLetterOutboxEvents(limit: number, leaseMs: number): Promise<OutboxEvent[]>;
  markOutboxDeadLetterPublished(eventId: string, publishedAt?: string): Promise<void>;
  claimInboxEvent(consumer: string, eventId: string, leaseMs?: number): Promise<EventInboxClaim>;
  completeInboxEvent(consumer: string, eventId: string): Promise<void>;
  scheduleInboxRetry(consumer: string, eventId: string, error: string, retryAt: string): Promise<void>;
  markInboxReconcileRequired(consumer: string, eventId: string, error: string, event?: OutboxEvent): Promise<void>;
  markInboxDeadLettered(consumer: string, eventId: string, error: string, event?: OutboxEvent): Promise<void>;
  claimInboxDeadLetterProjections(limit: number, leaseMs: number): Promise<Array<{ consumer: string; eventId: string; event: OutboxEvent; reason: string }>>;
  markInboxDeadLetterPublished(consumer: string, eventId: string, publishedAt?: string): Promise<void>;
  releaseInboxDeadLetterProjection(consumer: string, eventId: string): Promise<void>;
  claimActionExecution(execution: ActionExecution): Promise<{ execution: ActionExecution; claimed: boolean }>;
  getActionExecution(actionId: string, tenantId: string): Promise<ActionExecution | null>;
  recordActionExecution(execution: ActionExecution): Promise<ActionExecution>;
  updateActionExecution(input: { actionId: string; tenantId: string; providerStatus: string; n8nExecutionRef?: string | null; outcome?: ActionExecution['outcome']; resolveReconciliation?: boolean; eventId?: string; correlationId?: string; expectedAttempt?: number }): Promise<ActionExecution | null>;
  reconcileExpiredActionExecutions(now: string): Promise<ActionExecution[]>;
  addAudit(event: AuditEvent): Promise<void>;
  listAudit(tenantId: string): Promise<AuditEvent[]>;
  getTenantStats(tenantId: string): Promise<TenantStats>;
}
import type { CatalogV2Document } from './catalog-v2.js';

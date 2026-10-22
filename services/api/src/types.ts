export type Role = 'platform_admin' | 'tenant_admin' | 'tenant_editor' | 'tenant_viewer' | 'tenant_agent';
export type Audience = 'public' | 'internal';
export type SourceStatus = 'awaiting_review' | 'active' | 'revoked';
export type ActionState = 'awaiting_confirmation' | 'approved' | 'processing' | 'completed' | 'failed' | 'unknown';
export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'archived';
export type IngestionJobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type SupportingDocumentStatus = 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed' | 'reconciliation';
export type DocumentJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'reconciliation';

export type ConversationPhase = 'DISCOVERY' | 'INTENT_CLARIFICATION' | 'SLOT_COLLECTION' | 'CONTACT_COLLECTION' | 'CONSENT_PENDING' | 'DOCUMENT_COLLECTION' | 'ACTION_CONFIRMATION' | 'QUEUED' | 'SUCCEEDED' | 'RECONCILE_REQUIRED' | 'FAILED';
export type ConversationWorkflowStatus = 'none' | 'queued' | 'processing' | 'succeeded' | 'reconcile_required' | 'failed';

export interface PendingPrompt {
  id: string;
  type: 'clarification' | 'slot' | 'consent' | 'confirmation' | 'document';
  intentKey: string | null;
  slotKey: string | null;
  issuedAt: string;
}

export interface ConversationState {
  phase: ConversationPhase;
  catalogVersionId: string | null;
  candidateIntentKeys: string[];
  selectedIntentKey: string | null;
  slotValues: Record<string, string>;
  pendingPrompt: PendingPrompt | null;
  rollingSummary: string;
  summaryRevision: number;
  messageSequence: number;
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

export type IntentCatalogExtensionRow = Record<string, string | number | boolean | null>;

export interface IntentCatalog {
  tenantScope: string | null;
  intents: IntentCatalogIntent[];
  signals: IntentCatalogSignal[];
  slots: IntentCatalogSlot[];
  relations: IntentCatalogRelation[];
  workflowBindings: IntentCatalogWorkflowBinding[];
  qualityRules?: IntentCatalogQualityRule[];
  documentPolicies?: IntentCatalogDocumentPolicy[];
  documentSettings?: IntentCatalogDocumentSettings;
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

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  publicChatEnabled: boolean;
  publicOrigin: string | null;
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
  validationPass: boolean;
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
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
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
  idempotencyKey: string;
  state: ActionState;
  opaqueReference: string;
  payload: ActionPayload;
  createdAt: string;
  result: { externalReference: string } | null;
}

export interface AuditEvent {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  eventName: string;
  metadata: Record<string, string | number | boolean | null>;
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
  updateIngestionJob(job: IngestionJob): Promise<IngestionJob>;
  listSearchableChunks(tenantId: string, audience: Audience): Promise<Array<{ source: Source; chunk: Chunk }>>;
  searchSearchableChunks(tenantId: string, audience: Audience, queryEmbedding: number[], limit: number): Promise<Array<{ source: Source; chunk: Chunk }>>;
  createSession(tenantId: string, personaVersionId?: string | null): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  listExpiredSupportingDocuments(tenantId: string, before: string): Promise<SupportingDocument[]>;
  purgeExpiredSessions(tenantId: string, before: string): Promise<number>;
  updateSession(session: Session): Promise<Session>;
  addMessage(message: Message): Promise<Message>;
  updateMessage(message: Message): Promise<Message>;
  getMessageByClientId(sessionId: string, clientMessageId: string): Promise<Message | null>;
  listMessages(sessionId: string, tenantId: string, limit?: number): Promise<Message[]>;
  createAction(action: ActionRequest): Promise<ActionRequest>;
  getAction(id: string): Promise<ActionRequest | null>;
  getActionByIdempotency(tenantId: string, idempotencyKey: string): Promise<ActionRequest | null>;
  updateAction(action: ActionRequest): Promise<ActionRequest>;
  claimApprovedActions(workflowKey: string, limit: number): Promise<ActionRequest[]>;
  listActions(tenantId: string): Promise<ActionRequest[]>;
  createCrmLead(lead: CrmLead): Promise<CrmLead>;
  upsertCrmLead(lead: CrmLead, dedupeKey: string): Promise<CrmLead>;
  getCrmLeadByActionId(actionId: string, tenantId: string): Promise<CrmLead | null>;
  getCrmLeadBySessionId(sessionId: string, tenantId: string): Promise<CrmLead | null>;
  getCrmLead(id: string, tenantId: string): Promise<CrmLead | null>;
  listCrmLeads(tenantId: string): Promise<CrmLead[]>;
  updateCrmLeadSummary(id: string, tenantId: string, summary: string, status: CrmLead['summaryStatus']): Promise<CrmLead | null>;
  updateCrmLeadScore(id: string, tenantId: string, score: number): Promise<CrmLead | null>;
  updateCrmLeadRemote(input: { id: string; tenantId: string; leadId: string; remoteCrm: string }): Promise<CrmLead | null>;
  createSupportingDocument(document: SupportingDocument): Promise<SupportingDocument>;
  createSupportingDocumentWithJob(document: SupportingDocument, job: DocumentProcessingJob): Promise<void>;
  getSupportingDocument(id: string, tenantId: string): Promise<SupportingDocument | null>;
  listSupportingDocuments(tenantId: string, sessionId?: string, leadId?: string): Promise<SupportingDocument[]>;
  updateSupportingDocument(document: SupportingDocument): Promise<SupportingDocument>;
  createDocumentProcessingJob(job: DocumentProcessingJob): Promise<DocumentProcessingJob>;
  getDocumentProcessingJob(id: string, tenantId: string): Promise<DocumentProcessingJob | null>;
  claimNextDocumentProcessingJob(leaseMs: number): Promise<DocumentProcessingJob | null>;
  renewDocumentProcessingJob(id: string, tenantId: string, leaseMs: number): Promise<DocumentProcessingJob | null>;
  updateDocumentProcessingJob(job: DocumentProcessingJob): Promise<DocumentProcessingJob>;
  linkSessionDocuments(sessionId: string, tenantId: string, leadId: string): Promise<void>;
  addAudit(event: AuditEvent): Promise<void>;
  listAudit(tenantId: string): Promise<AuditEvent[]>;
  getTenantStats(tenantId: string): Promise<TenantStats>;
}

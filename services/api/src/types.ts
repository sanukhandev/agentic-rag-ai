export type Role = 'platform_admin' | 'tenant_admin' | 'tenant_editor' | 'tenant_viewer' | 'tenant_agent';
export type Audience = 'public' | 'internal';
export type SourceStatus = 'awaiting_review' | 'active' | 'revoked';
export type ActionState = 'awaiting_confirmation' | 'completed' | 'failed' | 'unknown';
export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'archived';
export type IngestionJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

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

export interface IntentCatalog {
  tenantScope: string | null;
  intents: IntentCatalogIntent[];
  signals: IntentCatalogSignal[];
  slots: IntentCatalogSlot[];
  relations: IntentCatalogRelation[];
  workflowBindings: IntentCatalogWorkflowBinding[];
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
  intentScore: number;
  intentConfidence: number;
  catalogVersionId: string | null;
  score: number;
  validationPass: boolean;
  leadData: LeadData;
  conversation: LeadConversationMessage[];
  summary: string | null;
  summaryStatus: 'pending' | 'completed' | 'failed';
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
  payload: LeadData;
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
  listActions(tenantId: string): Promise<ActionRequest[]>;
  createCrmLead(lead: CrmLead): Promise<CrmLead>;
  getCrmLeadByActionId(actionId: string, tenantId: string): Promise<CrmLead | null>;
  getCrmLead(id: string, tenantId: string): Promise<CrmLead | null>;
  listCrmLeads(tenantId: string): Promise<CrmLead[]>;
  updateCrmLeadSummary(id: string, tenantId: string, summary: string, status: CrmLead['summaryStatus']): Promise<CrmLead | null>;
  addAudit(event: AuditEvent): Promise<void>;
  listAudit(tenantId: string): Promise<AuditEvent[]>;
  getTenantStats(tenantId: string): Promise<TenantStats>;
}

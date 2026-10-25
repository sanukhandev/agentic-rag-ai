export type TenantStatus = 'active' | 'suspended' | 'archived';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  sourceCount?: number;
  lastActivity?: string;
  domains?: string[];
  primaryContact?: string;
}

export interface TenantDomain {
  id: string;
  hostname: string;
  createdAt: string;
  verified?: boolean;
}

export type MemberRole = 'tenant_admin' | 'tenant_editor' | 'tenant_viewer' | 'tenant_agent';

export interface Member {
  id: string;
  email: string;
  role: MemberRole;
  createdAt?: string;
  lastLoginAt?: string;
}

export interface Channel {
  publicOrigin: string | null;
  publicChatEnabled: boolean;
  rateLimitPerMinute?: number;
}

export type ChannelAuthMode = 'hmac' | 'api_key';

export interface ChannelCredential {
  id: string;
  tenantId: string;
  channel: string;
  authMode: ChannelAuthMode;
  keyId: string;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
}

export type SourceStatus = 'active' | 'awaiting_review' | 'revoked';
export type SourceAudience = 'public' | 'internal';

export interface Source {
  id: string;
  title: string;
  status: SourceStatus;
  audience: SourceAudience;
  mimeType: string;
  chunkCount?: number;
  createdAt?: string;
  updatedAt?: string;
  sizeBytes?: number;
}

export type IngestionJobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface IngestionJob {
  id: string;
  title: string;
  sourceUrl: string | null;
  status: IngestionJobStatus;
  attempts: number;
  errorCode: string | null;
  errorDetail: string | null;
  updatedAt: string;
  mimeType?: string;
  durationMs?: number;
  chunksIndexed?: number;
}

export interface Persona {
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

export interface Telemetry {
  requests: number;
  serverErrors: number;
  averageLatencyMs: number;
  lastRequestAt: string | null;
  chatResponses: number;
  groundedResponses: number;
  abstentions: number;
  actionProposals: number;
  groundingRate: number;
  abstentionRate: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number | null;
}

export interface ServiceCheck {
  status: 'healthy' | 'degraded' | 'down' | 'ok' | 'active' | 'adapter' | 'ready' | 'standby' | 'not_observed' | 'operational';
  latencyMs?: number;
  details?: string;
  lastChecked?: string;
}

export interface Health {
  checkedAt: string;
  telemetry: Telemetry;
  checks: Record<string, ServiceCheck>;
}

export interface WorkflowRun {
  id: string;
  actionId?: string;
  sessionId?: string;
  workflowKey: string;
  state: string;
  uiState?: 'success' | 'running' | 'failed';
  lifecycleState?: string;
  catalogVersionId?: string | null;
  intentKey?: string;
  idempotencyKey?: string;
  createdAt: string;
  result: { externalReference: string } | null;
  durationMs?: number;
  triggerEvent?: string;
}

export interface CrmLead {
  id: string;
  tenantId?: string;
  actionId?: string;
  sessionId?: string;
  intent: string;
  score: number;
  quality: 'new' | 'nurture' | 'warm' | 'hot';
  validationPass: boolean;
  leadData: { name?: string; email?: string; phone?: string; interest?: string };
  conversation: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>;
  summary: string | null;
  summaryStatus: 'pending' | 'completed' | 'failed';
  leadId?: string | null;
  remoteCrm?: string | null;
  documents?: SupportingDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface SupportingDocument {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: 'uploaded' | 'queued' | 'processing' | 'completed' | 'failed' | 'reconciliation';
  extractedText: string | null;
  summary: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  eventName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actorEmail?: string;
  ip?: string;
}

export interface Metrics {
  sourceCounts: Record<string, number>;
  ingestionJobs: Record<string, number>;
  sessions: number;
  messages: number;
  actions: number;
  auditEvents: number;
}

export interface PlatformOverview {
  tenants: {
    total: number;
    active: number;
    suspended: number;
    archived: number;
  };
  metrics: Array<{
    tenantId: string;
    metrics: Metrics;
  }>;
  systemSummary?: {
    activeSources: number;
    totalIngestions: number;
    globalGroundingRate: number;
    avgResponseLatencyMs: number;
  };
}

export type NavSection = 'overview' | 'organizations' | 'knowledge' | 'catalog' | 'studio' | 'chat' | 'crm' | 'observability' | 'settings';

export interface IntentCatalogVersion {
  id: string;
  version: number;
  status: 'draft' | 'published';
  sourceFileName: string;
  sourceHash: string;
  parserVersion: string;
  catalog: {
    intents: Array<{ intentKey: string; displayName: string; description?: string; workflowKey: string; minimumScore?: number; confidenceThreshold?: number; confirmationRequired?: boolean; active: boolean }>;
    signals: Array<{ intentKey: string; signalId: string; signalType: 'phrase' | 'keyword' | 'exclusion'; value: string; weight: number }>;
    slots: Array<{ intentKey: string; slotKey: string; required: boolean; alternativeGroup: string | null; promptKey: string }>;
    workflowBindings: Array<{ workflowKey: string; active: boolean }>;
  };
  createdAt: string;
  publishedAt: string | null;
}

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
  workflowKey: string;
  state: 'success' | 'running' | 'failed';
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
  leadData: { name?: string; email?: string; phone?: string };
  conversation: Array<{ role: 'user' | 'assistant'; content: string; createdAt: string }>;
  summary: string | null;
  summaryStatus: 'pending' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  eventName: string;
  metadata: Record<string, any>;
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

export type NavSection = 'overview' | 'organizations' | 'knowledge' | 'studio' | 'chat' | 'crm' | 'observability' | 'settings';

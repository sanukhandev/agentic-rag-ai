import {
  Tenant,
  Source,
  IngestionJob,
  Health,
  Metrics,
  Persona,
  PersonaVersion,
  PlatformOverview,
  WorkflowRun,
  AuditEvent,
  Member,
  TenantDomain
} from '../types/admin.types';

export const MOCK_TENANTS: Tenant[] = [
  {
    id: 't-01h8q7k1e3p9',
    name: 'Acme Global Corporation',
    slug: 'acme-corp',
    status: 'active',
    createdAt: '2026-04-12T10:30:00Z',
    sourceCount: 42,
    lastActivity: '2 minutes ago',
    domains: ['acme.com', 'chat.acme.com'],
    primaryContact: 'operations@acme.com'
  },
  {
    id: 't-02j9w8m2f4r0',
    name: 'Stripe Logistics EMEA',
    slug: 'stripe-emea',
    status: 'active',
    createdAt: '2026-05-18T14:15:00Z',
    sourceCount: 89,
    lastActivity: '14 minutes ago',
    domains: ['logistics.stripe-emea.net'],
    primaryContact: 'compliance@stripe-emea.net'
  },
  {
    id: 't-03k0x9n3g5s1',
    name: 'Vercel Enterprise Lab',
    slug: 'vercel-lab',
    status: 'active',
    createdAt: '2026-06-22T08:45:00Z',
    sourceCount: 114,
    lastActivity: '1 hour ago',
    domains: ['agent.vercel-lab.internal'],
    primaryContact: 'platform@vercel-lab.io'
  },
  {
    id: 't-04l1y0o4h6t2',
    name: 'Apex Financial Services',
    slug: 'apex-fin',
    status: 'suspended',
    createdAt: '2026-07-09T16:20:00Z',
    sourceCount: 16,
    lastActivity: '3 days ago',
    domains: ['secure.apexfin.org'],
    primaryContact: 'secops@apexfin.org'
  },
  {
    id: 't-05m2z1p5i7u3',
    name: 'Northwind Telemetry AI',
    slug: 'northwind-io',
    status: 'active',
    createdAt: '2026-08-01T11:00:00Z',
    sourceCount: 31,
    lastActivity: '8 minutes ago',
    domains: ['ai.northwind-telemetry.io'],
    primaryContact: 'admin@northwind-telemetry.io'
  },
  {
    id: 't-06n3a2q6j8v4',
    name: 'Helios BioTech Group',
    slug: 'helios-bio',
    status: 'active',
    createdAt: '2026-08-25T09:10:00Z',
    sourceCount: 67,
    lastActivity: '35 minutes ago',
    domains: ['research.heliosbio.ch'],
    primaryContact: 'data-desk@heliosbio.ch'
  },
  {
    id: 't-07o4b3r7k9w5',
    name: 'Vanguard Legacy Corp',
    slug: 'vanguard-legacy',
    status: 'archived',
    createdAt: '2026-02-10T12:00:00Z',
    sourceCount: 8,
    lastActivity: '28 days ago',
    domains: ['archive.vanguard-legacy.com'],
    primaryContact: 'records@vanguard-legacy.com'
  }
];

export const MOCK_PLATFORM_OVERVIEW: PlatformOverview = {
  tenants: {
    total: 24,
    active: 21,
    suspended: 2,
    archived: 1
  },
  metrics: [
    {
      tenantId: 't-01h8q7k1e3p9',
      metrics: {
        sourceCounts: { active: 42, awaiting_review: 4, revoked: 2 },
        ingestionJobs: { queued: 1, failed: 0, completed: 86 },
        sessions: 3840,
        messages: 18420,
        actions: 1420,
        auditEvents: 260
      }
    }
  ],
  systemSummary: {
    activeSources: 367,
    totalIngestions: 1240,
    globalGroundingRate: 98.6,
    avgResponseLatencyMs: 38
  }
};

export const MOCK_HEALTH: Health = {
  checkedAt: '2026-10-16T09:30:00Z',
  telemetry: {
    requests: 184520,
    serverErrors: 14,
    averageLatencyMs: 38,
    lastRequestAt: '14 seconds ago',
    chatResponses: 112400,
    groundedResponses: 110826,
    abstentions: 1574,
    actionProposals: 4280,
    groundingRate: 0.986,
    abstentionRate: 0.014,
    estimatedInputTokens: 24890100,
    estimatedOutputTokens: 8120300,
    estimatedCostUsd: 64.85
  },
  checks: {
    api_gateway: {
      status: 'healthy',
      latencyMs: 16,
      details: 'HTTP/2 Node Express boundary running with zero leaks',
      lastChecked: 'Just now'
    },
    azure_gpt4_mini: {
      status: 'healthy',
      latencyMs: 245,
      details: 'Azure AI Foundry GPT-4.1-mini deployment nominal',
      lastChecked: 'Just now'
    },
    pgvector_store: {
      status: 'healthy',
      latencyMs: 12,
      details: 'PostgreSQL 16 + pgvector HNSW index synchronized',
      lastChecked: 'Just now'
    },
    python_ingestion: {
      status: 'healthy',
      latencyMs: 42,
      details: 'Isolated venv text extractor & chunking pipeline idle',
      lastChecked: 'Just now'
    },
    n8n_orchestrator: {
      status: 'healthy',
      latencyMs: 28,
      details: 'Internal webhook execution runner authenticated',
      lastChecked: 'Just now'
    },
    token_privacy_vault: {
      status: 'healthy',
      latencyMs: 8,
      details: 'Reversible customer PII masking vault active',
      lastChecked: 'Just now'
    }
  }
};

export const MOCK_METRICS: Metrics = {
  sourceCounts: {
    active: 42,
    awaiting_review: 4,
    revoked: 2
  },
  ingestionJobs: {
    queued: 2,
    processing: 1,
    completed: 148,
    failed: 1
  },
  sessions: 4210,
  messages: 19840,
  actions: 1640,
  auditEvents: 342
};

export const MOCK_SOURCES: Source[] = [
  {
    id: 'src-99a1',
    title: 'Enterprise Master Services Agreement (MSA) v4.2',
    status: 'active',
    audience: 'public',
    mimeType: 'application/pdf',
    chunkCount: 184,
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-02T14:20:00Z',
    sizeBytes: 2457600
  },
  {
    id: 'src-99a2',
    title: '2026 Enterprise Pricing Matrix & Add-on Tier Schedule',
    status: 'active',
    audience: 'public',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    chunkCount: 92,
    createdAt: '2026-09-10T11:15:00Z',
    updatedAt: '2026-09-10T12:00:00Z',
    sizeBytes: 864000
  },
  {
    id: 'src-99a3',
    title: 'SOC-2 Type II Security Architecture & Boundary Verification',
    status: 'active',
    audience: 'public',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    chunkCount: 310,
    createdAt: '2026-09-14T09:40:00Z',
    updatedAt: '2026-09-14T15:20:00Z',
    sizeBytes: 3980000
  },
  {
    id: 'src-99a4',
    title: 'Level 3 Incident Escalation & Response Playbook',
    status: 'awaiting_review',
    audience: 'internal',
    mimeType: 'text/plain',
    chunkCount: 56,
    createdAt: '2026-10-15T18:20:00Z',
    updatedAt: '2026-10-15T18:20:00Z',
    sizeBytes: 124000
  },
  {
    id: 'src-99a5',
    title: 'Crawl Snapshot: https://docs.agentic-rag.ai/privacy-principles',
    status: 'active',
    audience: 'public',
    mimeType: 'text/html',
    chunkCount: 45,
    createdAt: '2026-10-14T08:12:00Z',
    updatedAt: '2026-10-14T08:15:00Z',
    sizeBytes: 98000
  },
  {
    id: 'src-99a6',
    title: 'Q2 2026 Promotional Terms & Discount Codes (Deprecated)',
    status: 'revoked',
    audience: 'public',
    mimeType: 'application/pdf',
    chunkCount: 28,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    sizeBytes: 420000
  }
];

export const MOCK_JOBS: IngestionJob[] = [
  {
    id: 'job-7801',
    title: 'SOC-2 Type II Security Architecture & Boundary Verification',
    sourceUrl: null,
    status: 'completed',
    attempts: 1,
    errorCode: null,
    updatedAt: '2026-10-16T09:12:00Z',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    durationMs: 4120,
    chunksIndexed: 310
  },
  {
    id: 'job-7802',
    title: '2026 Enterprise Pricing Matrix & Add-on Tier Schedule',
    sourceUrl: null,
    status: 'completed',
    attempts: 1,
    errorCode: null,
    updatedAt: '2026-10-16T08:45:00Z',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    durationMs: 2310,
    chunksIndexed: 92
  },
  {
    id: 'job-7803',
    title: 'Snapshot Crawl: https://docs.agentic-rag.ai/compliance-framework',
    sourceUrl: 'https://docs.agentic-rag.ai/compliance-framework',
    status: 'completed',
    attempts: 1,
    errorCode: null,
    updatedAt: '2026-10-16T07:20:00Z',
    mimeType: 'text/html',
    durationMs: 1450,
    chunksIndexed: 45
  },
  {
    id: 'job-7804',
    title: 'Technical Support Knowledge Base Archive (Part 3)',
    sourceUrl: null,
    status: 'processing',
    attempts: 1,
    errorCode: null,
    updatedAt: '2026-10-16T09:28:00Z',
    mimeType: 'application/pdf',
    durationMs: 3800,
    chunksIndexed: 142
  },
  {
    id: 'job-7805',
    title: 'Legacy Q3 Internal Audit Scans',
    sourceUrl: null,
    status: 'failed',
    attempts: 3,
    errorCode: 'PARSER_REJECTED: Corrupted PDF binary header or password locked',
    updatedAt: '2026-10-16T06:10:00Z',
    mimeType: 'application/pdf',
    durationMs: 820,
    chunksIndexed: 0
  }
];

export const MOCK_PERSONA: Persona = {
  name: 'Aura Enterprise Guide',
  greeting: 'Welcome to Acme Global. I am your verified conversational assistant grounded directly in active enterprise policies.',
  personality: 'Calm, authoritative, strictly grounded in authorized customer documentation, respectful, and privacy-first.',
  tone: 'Clear, concise, professional, and helpful.',
  speakingStyle: 'Declarative sentences, itemized bulleted clarifications, zero ungrounded speculation.',
  permittedLanguages: ['en', 'es', 'de', 'fr', 'ja', 'ar']
};

export const MOCK_PERSONA_VERSIONS: PersonaVersion[] = [
  {
    id: 'pv-03',
    version: 3,
    status: 'published',
    createdAt: '2026-10-12T14:00:00Z',
    publishedAt: '2026-10-12T14:05:00Z',
    name: 'Aura Enterprise Guide',
    greeting: 'Welcome to Acme Global. I am your verified conversational assistant grounded directly in active enterprise policies.',
    personality: 'Calm, authoritative, strictly grounded in authorized customer documentation, respectful, and privacy-first.',
    tone: 'Clear, concise, professional, and helpful.',
    speakingStyle: 'Declarative sentences, itemized bulleted clarifications, zero ungrounded speculation.',
    permittedLanguages: ['en', 'es', 'de', 'fr', 'ja', 'ar']
  },
  {
    id: 'pv-02',
    version: 2,
    status: 'draft',
    createdAt: '2026-09-20T10:30:00Z',
    publishedAt: null,
    name: 'Aura Concierge Experimental',
    greeting: 'Hello from Acme. How can I assist your enterprise inquiry today?',
    personality: 'Friendly, tech-forward, grounded in product matrices.',
    tone: 'Energetic and precise',
    speakingStyle: 'Concise summary with direct references',
    permittedLanguages: ['en', 'es']
  },
  {
    id: 'pv-01',
    version: 1,
    status: 'draft',
    createdAt: '2026-08-01T09:00:00Z',
    publishedAt: '2026-08-01T09:30:00Z',
    name: 'Sales Support Agent v1',
    greeting: 'Hi there, how can I help you today?',
    personality: 'Direct and standard sales assistant.',
    tone: 'Neutral',
    speakingStyle: 'Standard text',
    permittedLanguages: ['en']
  }
];

export const MOCK_WORKFLOW_RUNS: WorkflowRun[] = [
  {
    id: 'wf-9101',
    workflowKey: 'enterprise_lead_qualification',
    state: 'success',
    createdAt: '2026-10-16T09:22:15Z',
    result: { externalReference: 'n8n-exec-889102-crm-lead-created' },
    durationMs: 840,
    triggerEvent: 'intent:qualify_enterprise_trial'
  },
  {
    id: 'wf-9102',
    workflowKey: 'schedule_architecture_review',
    state: 'success',
    createdAt: '2026-10-16T09:04:10Z',
    result: { externalReference: 'n8n-exec-889045-calendar-invite-sent' },
    durationMs: 1120,
    triggerEvent: 'intent:schedule_demo'
  },
  {
    id: 'wf-9103',
    workflowKey: 'tier3_urgent_support_dispatch',
    state: 'running',
    createdAt: '2026-10-16T09:35:00Z',
    result: null,
    durationMs: 320,
    triggerEvent: 'intent:escalate_incident'
  },
  {
    id: 'wf-9104',
    workflowKey: 'custom_security_packet_request',
    state: 'success',
    createdAt: '2026-10-16T08:18:22Z',
    result: { externalReference: 'n8n-exec-888912-packet-dispatched' },
    durationMs: 980,
    triggerEvent: 'intent:request_compliance_pack'
  }
];

export const MOCK_AUDIT_EVENTS: AuditEvent[] = [
  {
    id: 'aud-4401',
    eventName: 'source.published',
    metadata: { sourceId: 'src-99a3', title: 'SOC-2 Type II Security Architecture', chunks: 310, approvedBy: 'admin@acme.com' },
    createdAt: '2026-10-16T09:14:00Z',
    actorEmail: 'admin@acme.com',
    ip: '198.51.100.42'
  },
  {
    id: 'aud-4402',
    eventName: 'persona.version_published',
    metadata: { versionId: 'pv-03', versionNumber: 3, languages: ['en', 'es', 'de', 'fr', 'ja', 'ar'] },
    createdAt: '2026-10-16T08:52:10Z',
    actorEmail: 'admin@acme.com',
    ip: '198.51.100.42'
  },
  {
    id: 'aud-4403',
    eventName: 'tenant.domain_verified',
    metadata: { hostname: 'chat.acme.com', tenantId: 't-01h8q7k1e3p9', dnsTxtRecord: 'verified' },
    createdAt: '2026-10-16T07:30:00Z',
    actorEmail: 'secops@acme.com',
    ip: '198.51.100.18'
  },
  {
    id: 'aud-4404',
    eventName: 'privacy.token_vault_rehydration_attempt',
    metadata: { status: 'DENIED', reason: 'Insufficient role permission for caller', target: 'visitor_email' },
    createdAt: '2026-10-16T06:14:22Z',
    actorEmail: 'bot-runner@internal',
    ip: '10.0.4.15'
  },
  {
    id: 'aud-4405',
    eventName: 'retention.expired_sessions_purged',
    metadata: { purgedCount: 38, cutoffHours: 24, storageReclaimedKb: 4120 },
    createdAt: '2026-10-16T04:00:00Z',
    actorEmail: 'system-cron@agentic-rag',
    ip: '127.0.0.1'
  }
];

export const MOCK_DOMAINS: TenantDomain[] = [
  { id: 'dom-01', hostname: 'chat.acme.com', createdAt: '2026-08-10T12:00:00Z', verified: true },
  { id: 'dom-02', hostname: 'portal.acme.global', createdAt: '2026-09-01T15:30:00Z', verified: true },
  { id: 'dom-03', hostname: 'agent.internal.acme.net', createdAt: '2026-10-02T09:20:00Z', verified: false }
];

export const MOCK_MEMBERS: Member[] = [
  { id: 'mem-01', email: 'admin@acme.com', role: 'tenant_admin', createdAt: '2026-04-12T10:30:00Z', lastLoginAt: '12 minutes ago' },
  { id: 'mem-02', email: 'sarah.chen@acme.com', role: 'tenant_editor', createdAt: '2026-05-02T11:00:00Z', lastLoginAt: '1 hour ago' },
  { id: 'mem-03', email: 'marcus.vance@acme.com', role: 'tenant_editor', createdAt: '2026-06-14T14:40:00Z', lastLoginAt: 'Yesterday' },
  { id: 'mem-04', email: 'auditor.lead@acme.com', role: 'tenant_viewer', createdAt: '2026-08-19T08:15:00Z', lastLoginAt: '3 days ago' }
];

import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { fileMimeType } from './upload-utils';
import { parsePermittedLanguages } from './persona-utils';

type Source = { id: string; title: string; status: string; audience: string; mimeType: string };
type IngestionJob = { id: string; title: string; sourceUrl: string | null; status: string; attempts: number; errorCode: string | null; updatedAt: string };
type Metrics = { sourceCounts: Record<string, number>; ingestionJobs: Record<string, number>; sessions: number; messages: number; actions: number; auditEvents: number };
type Persona = { name: string; greeting: string; personality: string; tone: string; speakingStyle: string; permittedLanguages: string[] };
type PersonaVersion = Persona & { id: string; version: number; status: 'draft' | 'published'; createdAt: string; publishedAt: string | null };
type Tenant = { id: string; name: string; slug: string; status: string };
type TenantDomain = { id: string; hostname: string; createdAt: string };
type Channel = { publicOrigin: string | null };
type Member = { id: string; email: string; role: string };
type Health = { checkedAt: string; telemetry: { requests: number; serverErrors: number; averageLatencyMs: number; lastRequestAt: string | null }; checks: Record<string, { status: string }> };
type WorkflowRun = { id: string; workflowKey: string; state: string; createdAt: string; result: { externalReference: string } | null };
type AuditEvent = { id: string; eventName: string; metadata: Record<string, string | number | boolean | null>; createdAt: string };
type PlatformOverview = { tenants: { total: number; active: number; suspended: number; archived: number }; metrics: Array<{ tenantId: string; metrics: Metrics }> };
const api = 'http://localhost:4000';

@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './app.component.html' })
export class AppComponent {
  private readonly http = inject(HttpClient);
  email = 'admin@example.test'; password = ''; token = ''; role = ''; error = ''; sources: Source[] = []; ingestionJobs: IngestionJob[] = []; tenants: Tenant[] = []; domains: TenantDomain[] = []; members: Member[] = []; workflowRuns: WorkflowRun[] = []; auditEvents: AuditEvent[] = []; platformOverview: PlatformOverview | null = null; health: Health | null = null; metrics: Metrics | null = null; persona: Persona = { name: '', greeting: '', personality: '', tone: '', speakingStyle: '', permittedLanguages: ['en'] };
  title = ''; content = ''; sourceUrl = ''; audience = 'public'; selectedFile: File | null = null;
  tenantName = ''; tenantSlug = ''; tenantAdminEmail = ''; tenantAdminPassword = ''; publicOrigin = '';
  personaVersions: PersonaVersion[] = [];
  domainHostname = '';
  memberEmail = ''; memberPassword = ''; memberRole = 'tenant_editor';
  previewMessage = 'What can you help me with?'; previewAnswer = ''; previewGrounded = false;
  permittedLanguageText = 'en';

  login(): void { this.http.post<{ token: string; user: { role: string } }>(`${api}/api/v1/auth/login`, { email: this.email, password: this.password }).subscribe({ next: (body) => { this.token = body.token; this.role = body.user.role; this.loadHealth(); if (this.role === 'platform_admin') { this.loadTenants(); this.loadPlatformOverview(); } else { this.loadSources(); this.loadJobs(); this.loadDashboard(); this.loadWorkflowRuns(); this.loadAudit(); this.loadPersona(); this.loadPersonaVersions(); if (this.role === 'tenant_admin') { this.loadDomains(); this.loadMembers(); this.loadChannel(); } } }, error: () => { this.error = 'Login failed.'; } }); }
  loadTenants(): void { this.http.get<{ items: Tenant[] }>(`${api}/api/v1/admin/tenants`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.tenants = body.items; }, error: () => { this.error = 'Could not load tenants.'; } }); }
  loadPlatformOverview(): void { this.http.get<PlatformOverview>(`${api}/api/v1/admin/platform/overview`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.platformOverview = body; }, error: () => { this.error = 'Could not load platform overview.'; } }); }
  createTenant(): void { this.http.post(`${api}/api/v1/admin/tenants`, { name: this.tenantName, slug: this.tenantSlug, adminEmail: this.tenantAdminEmail, adminPassword: this.tenantAdminPassword }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.tenantName = ''; this.tenantSlug = ''; this.tenantAdminEmail = ''; this.tenantAdminPassword = ''; this.loadTenants(); }, error: () => { this.error = 'Tenant could not be created.'; } }); }
  updateTenantStatus(tenant: Tenant, status: 'active' | 'suspended' | 'archived'): void { if (status === 'archived' && !window.confirm(`Archive ${tenant.name}?`)) return; this.http.patch<{ tenant: Tenant }>(`${api}/api/v1/admin/tenants/${tenant.id}/status`, { status }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadTenants(), error: () => { this.error = 'Tenant status could not be updated.'; } }); }
  loadSources(): void { this.http.get<{ items: Source[] }>(`${api}/api/v1/admin/sources`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.sources = body.items; }, error: () => { this.error = 'Could not load sources.'; } }); }
  loadJobs(): void { this.http.get<{ items: IngestionJob[] }>(`${api}/api/v1/admin/ingestion-jobs`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.ingestionJobs = body.items; }, error: () => { this.error = 'Could not load ingestion jobs.'; } }); }
  loadDashboard(): void { this.http.get<{ metrics: Metrics }>(`${api}/api/v1/admin/dashboard/overview`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.metrics = body.metrics; }, error: () => { this.error = 'Could not load dashboard metrics.'; } }); }
  loadHealth(): void { this.http.get<Health>(`${api}/api/v1/admin/services/health`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.health = body; }, error: () => { this.error = 'Could not load service health.'; } }); }
  loadWorkflowRuns(): void { this.http.get<{ items: WorkflowRun[] }>(`${api}/api/v1/admin/workflow-runs`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.workflowRuns = body.items; }, error: () => { this.error = 'Could not load workflow runs.'; } }); }
  loadAudit(): void { this.http.get<{ items: AuditEvent[] }>(`${api}/api/v1/admin/audit`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.auditEvents = body.items; }, error: () => { this.error = 'Could not load audit events.'; } }); }
  loadDomains(): void { this.http.get<{ items: TenantDomain[] }>(`${api}/api/v1/admin/domains`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.domains = body.items; }, error: () => { this.error = 'Could not load domains.'; } }); }
  addDomain(): void { this.http.post(`${api}/api/v1/admin/domains`, { hostname: this.domainHostname }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.domainHostname = ''; this.loadDomains(); }, error: () => { this.error = 'Domain could not be added.'; } }); }
  removeDomain(domain: TenantDomain): void { this.http.delete(`${api}/api/v1/admin/domains/${domain.id}`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadDomains(), error: () => { this.error = 'Domain could not be removed.'; } }); }
  loadChannel(): void { this.http.get<Channel>(`${api}/api/v1/admin/channel`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.publicOrigin = body.publicOrigin ?? ''; }, error: () => { this.error = 'Could not load chat channel.'; } }); }
  saveChannel(): void { this.http.patch<Channel>(`${api}/api/v1/admin/channel`, { publicOrigin: this.publicOrigin }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.publicOrigin = body.publicOrigin ?? ''; }, error: () => { this.error = 'Chat origin could not be saved.'; } }); }
  loadMembers(): void { this.http.get<{ items: Member[] }>(`${api}/api/v1/admin/members`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.members = body.items; }, error: () => { this.error = 'Could not load members.'; } }); }
  addMember(): void { this.http.post(`${api}/api/v1/admin/members`, { email: this.memberEmail, password: this.memberPassword, role: this.memberRole }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.memberEmail = ''; this.memberPassword = ''; this.loadMembers(); }, error: () => { this.error = 'Member could not be added.'; } }); }
  loadPersona(): void { this.http.get<{ persona: Persona | null }>(`${api}/api/v1/admin/persona`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { if (body.persona) { this.persona = body.persona; this.permittedLanguageText = body.persona.permittedLanguages.join(', '); } }, error: () => { this.error = 'Could not load persona.'; } }); }
  loadPersonaVersions(): void { this.http.get<{ items: PersonaVersion[] }>(`${api}/api/v1/admin/persona/versions`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.personaVersions = body.items; }, error: () => { this.error = 'Could not load persona versions.'; } }); }
  personaPayload(): Persona { return { ...this.persona, permittedLanguages: parsePermittedLanguages(this.permittedLanguageText) }; }
  savePersonaDraft(): void { this.http.post(`${api}/api/v1/admin/persona/drafts`, this.personaPayload(), { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadPersonaVersions(), error: () => { this.error = 'Persona draft could not be saved.'; } }); }
  previewPersona(): void { this.http.post<{ preview: { answer: string; grounded: boolean } }>(`${api}/api/v1/admin/persona/preview`, { ...this.personaPayload(), message: this.previewMessage }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.previewAnswer = body.preview.answer; this.previewGrounded = body.preview.grounded; }, error: () => { this.error = 'Persona preview could not be generated.'; } }); }
  publishPersonaVersion(version: PersonaVersion): void { this.http.post(`${api}/api/v1/admin/persona/versions/${version.id}/publish`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.loadPersona(); this.loadPersonaVersions(); }, error: () => { this.error = 'Persona version could not be published.'; } }); }
  savePersona(): void { this.http.put(`${api}/api/v1/admin/persona`, this.personaPayload(), { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.error = ''; }, error: () => { this.error = 'Persona could not be saved.'; } }); }
  onFileSelected(event: Event): void { this.selectedFile = (event.target as HTMLInputElement).files?.[0] ?? null; }
  uploadFile(): void {
    const file = this.selectedFile;
    if (!file) { this.error = 'Choose a TXT, PDF, DOCX or XLSX file first.'; return; }
    const mimeType = fileMimeType(file.name);
    if (!mimeType) { this.error = 'Unsupported file type.'; return; }
    const reader = new FileReader();
    reader.onload = () => {
      const encoded = typeof reader.result === 'string' ? reader.result.split(',')[1] : undefined;
      if (!encoded) { this.error = 'The file could not be read.'; return; }
      this.http.post(`${api}/api/v1/admin/sources/upload`, { title: this.title || file.name, fileName: file.name, mimeType, audience: this.audience, contentBase64: encoded }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.title = ''; this.selectedFile = null; this.loadJobs(); }, error: () => { this.error = 'File could not be queued for ingestion.'; } });
    };
    reader.onerror = () => { this.error = 'The file could not be read.'; };
    reader.readAsDataURL(file);
  }
  stage(): void { this.http.post(`${api}/api/v1/admin/sources`, { title: this.title, mimeType: 'text/plain', audience: this.audience, content: this.content }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.title = ''; this.content = ''; this.loadSources(); this.loadJobs(); }, error: () => { this.error = 'Source could not be staged.'; } }); }
  queueUrl(): void { this.http.post(`${api}/api/v1/admin/ingestion-jobs`, { title: this.title, mimeType: 'text/html', sourceUrl: this.sourceUrl, audience: this.audience }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.title = ''; this.sourceUrl = ''; this.loadJobs(); }, error: () => { this.error = 'URL ingestion could not be queued.'; } }); }
  retryJob(job: IngestionJob): void { this.http.post(`${api}/api/v1/admin/ingestion-jobs/${job.id}/retry`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadJobs(), error: () => { this.error = 'Only failed ingestion jobs can be retried.'; } }); }
  reindex(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/reindex`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.loadSources(); this.loadJobs(); }, error: () => { this.error = 'Source could not be reindexed.'; } }); }
  purge(source: Source): void { this.http.delete(`${api}/api/v1/admin/sources/${source.id}`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.loadSources(); }, error: () => { this.error = 'Only revoked sources can be purged.'; } }); }
  publish(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/publish`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadSources(), error: () => { this.error = 'Source could not be published.'; } }); }
  revoke(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/revoke`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadSources(), error: () => { this.error = 'Source could not be revoked.'; } }); }
  logout(): void { this.http.post(`${api}/api/v1/auth/logout`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.token = ''; this.role = ''; this.metrics = null; this.platformOverview = null; this.health = null; this.ingestionJobs = []; this.domains = []; this.members = []; this.workflowRuns = []; this.auditEvents = []; }, error: () => { this.token = ''; this.role = ''; } }); }
}

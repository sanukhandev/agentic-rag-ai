import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Source = { id: string; title: string; status: string; audience: string; mimeType: string };
type IngestionJob = { id: string; title: string; sourceUrl: string | null; status: string; attempts: number; errorCode: string | null; updatedAt: string };
type Metrics = { sourceCounts: Record<string, number>; sessions: number; messages: number; actions: number; auditEvents: number };
type Persona = { name: string; greeting: string; personality: string; tone: string; speakingStyle: string; permittedLanguages: string[] };
type Tenant = { id: string; name: string; slug: string; status: string };
const api = 'http://localhost:4000';

@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './app.component.html' })
export class AppComponent {
  private readonly http = inject(HttpClient);
  email = 'admin@example.test'; password = ''; token = ''; role = ''; error = ''; sources: Source[] = []; ingestionJobs: IngestionJob[] = []; tenants: Tenant[] = []; metrics: Metrics | null = null; persona: Persona = { name: '', greeting: '', personality: '', tone: '', speakingStyle: '', permittedLanguages: ['en'] };
  title = ''; content = ''; sourceUrl = ''; audience = 'public';
  tenantName = ''; tenantSlug = ''; tenantAdminEmail = ''; tenantAdminPassword = '';

  login(): void { this.http.post<{ token: string; user: { role: string } }>(`${api}/api/v1/auth/login`, { email: this.email, password: this.password }).subscribe({ next: (body) => { this.token = body.token; this.role = body.user.role; if (this.role === 'platform_admin') this.loadTenants(); else { this.loadSources(); this.loadJobs(); this.loadDashboard(); this.loadPersona(); } }, error: () => { this.error = 'Login failed.'; } }); }
  loadTenants(): void { this.http.get<{ items: Tenant[] }>(`${api}/api/v1/admin/tenants`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.tenants = body.items; }, error: () => { this.error = 'Could not load tenants.'; } }); }
  createTenant(): void { this.http.post(`${api}/api/v1/admin/tenants`, { name: this.tenantName, slug: this.tenantSlug, adminEmail: this.tenantAdminEmail, adminPassword: this.tenantAdminPassword }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.tenantName = ''; this.tenantSlug = ''; this.tenantAdminEmail = ''; this.tenantAdminPassword = ''; this.loadTenants(); }, error: () => { this.error = 'Tenant could not be created.'; } }); }
  loadSources(): void { this.http.get<{ items: Source[] }>(`${api}/api/v1/admin/sources`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.sources = body.items; }, error: () => { this.error = 'Could not load sources.'; } }); }
  loadJobs(): void { this.http.get<{ items: IngestionJob[] }>(`${api}/api/v1/admin/ingestion-jobs`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.ingestionJobs = body.items; }, error: () => { this.error = 'Could not load ingestion jobs.'; } }); }
  loadDashboard(): void { this.http.get<{ metrics: Metrics }>(`${api}/api/v1/admin/dashboard/overview`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.metrics = body.metrics; }, error: () => { this.error = 'Could not load dashboard metrics.'; } }); }
  loadPersona(): void { this.http.get<{ persona: Persona | null }>(`${api}/api/v1/admin/persona`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { if (body.persona) this.persona = body.persona; }, error: () => { this.error = 'Could not load persona.'; } }); }
  savePersona(): void { this.http.put(`${api}/api/v1/admin/persona`, this.persona, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.error = ''; }, error: () => { this.error = 'Persona could not be saved.'; } }); }
  stage(): void { this.http.post(`${api}/api/v1/admin/sources`, { title: this.title, mimeType: 'text/plain', audience: this.audience, content: this.content }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.title = ''; this.content = ''; this.loadSources(); this.loadJobs(); }, error: () => { this.error = 'Source could not be staged.'; } }); }
  queueUrl(): void { this.http.post(`${api}/api/v1/admin/ingestion-jobs`, { title: this.title, mimeType: 'text/html', sourceUrl: this.sourceUrl, audience: this.audience }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.title = ''; this.sourceUrl = ''; this.loadJobs(); }, error: () => { this.error = 'URL ingestion could not be queued.'; } }); }
  reindex(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/reindex`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.loadSources(); this.loadJobs(); }, error: () => { this.error = 'Source could not be reindexed.'; } }); }
  publish(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/publish`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadSources(), error: () => { this.error = 'Source could not be published.'; } }); }
  revoke(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/revoke`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadSources(), error: () => { this.error = 'Source could not be revoked.'; } }); }
  logout(): void { this.http.post(`${api}/api/v1/auth/logout`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.token = ''; this.role = ''; this.metrics = null; this.ingestionJobs = []; }, error: () => { this.token = ''; this.role = ''; } }); }
}

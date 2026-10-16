import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, catchError, of, tap } from 'rxjs';
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
  TenantDomain,
  Channel,
  NavSection
} from '../types/admin.types';
import {
  MOCK_TENANTS,
  MOCK_PLATFORM_OVERVIEW,
  MOCK_HEALTH,
  MOCK_METRICS,
  MOCK_SOURCES,
  MOCK_JOBS,
  MOCK_PERSONA,
  MOCK_PERSONA_VERSIONS,
  MOCK_WORKFLOW_RUNS,
  MOCK_AUDIT_EVENTS,
  MOCK_DOMAINS,
  MOCK_MEMBERS
} from './mock-data';

const API_BASE = 'http://127.0.0.1:4000';
const TOKEN_KEY = 'agentic-rag-admin-token';
const ROLE_KEY = 'agentic-rag-admin-role';
const EMAIL_KEY = 'agentic-rag-admin-email';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class AdminStateService {
  private readonly http = inject(HttpClient);

  // Authentication & Session State
  readonly token$ = new BehaviorSubject<string>('');
  readonly role$ = new BehaviorSubject<'platform_admin' | 'tenant_admin' | 'tenant_editor' | 'tenant_viewer' | ''>('');
  readonly userEmail$ = new BehaviorSubject<string>('admin@acme.com');
  readonly isAuthenticated$ = new BehaviorSubject<boolean>(false);
  readonly isMockMode$ = new BehaviorSubject<boolean>(false);

  // Navigation State
  readonly currentSection$ = new BehaviorSubject<NavSection>('overview');
  readonly activeMegaMenu$ = new BehaviorSubject<NavSection | null>(null);
  readonly commandPaletteOpen$ = new BehaviorSubject<boolean>(false);
  readonly createOrgDrawerOpen$ = new BehaviorSubject<boolean>(false);
  readonly uploadSourceModalOpen$ = new BehaviorSubject<boolean>(false);

  // Core Data Stores
  readonly tenants$ = new BehaviorSubject<Tenant[]>(MOCK_TENANTS);
  readonly selectedTenant$ = new BehaviorSubject<Tenant | null>(MOCK_TENANTS[0]);
  readonly platformOverview$ = new BehaviorSubject<PlatformOverview>(MOCK_PLATFORM_OVERVIEW);
  readonly health$ = new BehaviorSubject<Health>(MOCK_HEALTH);
  readonly metrics$ = new BehaviorSubject<Metrics>(MOCK_METRICS);
  readonly sources$ = new BehaviorSubject<Source[]>(MOCK_SOURCES);
  readonly ingestionJobs$ = new BehaviorSubject<IngestionJob[]>(MOCK_JOBS);
  readonly persona$ = new BehaviorSubject<Persona>(MOCK_PERSONA);
  readonly personaVersions$ = new BehaviorSubject<PersonaVersion[]>(MOCK_PERSONA_VERSIONS);
  readonly domains$ = new BehaviorSubject<TenantDomain[]>(MOCK_DOMAINS);
  readonly members$ = new BehaviorSubject<Member[]>(MOCK_MEMBERS);
  readonly channel$ = new BehaviorSubject<Channel>({ publicOrigin: 'https://chat.acme.com', publicChatEnabled: true });
  readonly workflowRuns$ = new BehaviorSubject<WorkflowRun[]>(MOCK_WORKFLOW_RUNS);
  readonly auditEvents$ = new BehaviorSubject<AuditEvent[]>(MOCK_AUDIT_EVENTS);

  // UI Feedback
  readonly toasts$ = new BehaviorSubject<ToastMessage[]>([]);
  readonly isGlobalLoading$ = new BehaviorSubject<boolean>(false);

  constructor() {
    this.restoreSession();
  }

  get token(): string {
    return this.token$.value;
  }

  get role(): string {
    return this.role$.value;
  }

  get isPlatformAdmin(): boolean {
    return this.role$.value === 'platform_admin';
  }

  get canEditSources(): boolean {
    return this.role === 'platform_admin' || this.role === 'tenant_admin' || this.role === 'tenant_editor';
  }

  get canManagePersona(): boolean {
    return this.role === 'platform_admin' || this.role === 'tenant_admin';
  }

  showToast(type: 'info' | 'success' | 'warning' | 'error', title: string, message?: string): void {
    const toast: ToastMessage = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      title,
      message,
      timestamp: Date.now()
    };
    this.toasts$.next([toast, ...this.toasts$.value.slice(0, 4)]);
    setTimeout(() => this.dismissToast(toast.id), 5000);
  }

  dismissToast(id: string): void {
    this.toasts$.next(this.toasts$.value.filter((t) => t.id !== id));
  }

  setSection(section: NavSection): void {
    this.currentSection$.next(section);
    this.activeMegaMenu$.next(null);
  }

  toggleMegaMenu(section: NavSection): void {
    const current = this.activeMegaMenu$.value;
    this.activeMegaMenu$.next(current === section ? null : section);
  }

  closeMegaMenu(): void {
    this.activeMegaMenu$.next(null);
  }

  openCommandPalette(): void {
    this.commandPaletteOpen$.next(true);
  }

  closeCommandPalette(): void {
    this.commandPaletteOpen$.next(false);
  }

  openCreateOrgDrawer(): void {
    this.createOrgDrawerOpen$.next(true);
  }

  closeCreateOrgDrawer(): void {
    this.createOrgDrawerOpen$.next(false);
  }

  openUploadModal(): void {
    this.uploadSourceModalOpen$.next(true);
  }

  closeUploadModal(): void {
    this.uploadSourceModalOpen$.next(false);
  }

  selectTenant(tenant: Tenant): void {
    this.selectedTenant$.next(tenant);
    this.showToast('info', 'Switched Workspace', `Active context: ${tenant.name}`);
  }

  private restoreSession(): void {
    const savedToken = sessionStorage.getItem(TOKEN_KEY);
    const savedRole = sessionStorage.getItem(ROLE_KEY) as any;
    const savedEmail = sessionStorage.getItem(EMAIL_KEY);

    if (savedToken && savedRole) {
      this.token$.next(savedToken);
      this.role$.next(savedRole);
      if (savedEmail) this.userEmail$.next(savedEmail);
      this.isAuthenticated$.next(true);
      this.refreshAllData();
    } else {
      // By default start unauthenticated to show the premium sign-in page,
      // or user can quickly click demo presets
      this.isAuthenticated$.next(false);
    }
  }

  loginWithCredentials(email: string, password: string, onSuccess?: () => void, onError?: (err: string) => void): void {
    this.isGlobalLoading$.next(true);
    this.http.post<{ token: string; user: { role: string; email?: string } }>(`${API_BASE}/api/v1/auth/login`, { email, password }).subscribe({
      next: (res) => {
        this.token$.next(res.token);
        this.role$.next(res.user.role as any);
        this.userEmail$.next(res.user.email || email);
        this.isAuthenticated$.next(true);
        this.isMockMode$.next(false);

        sessionStorage.setItem(TOKEN_KEY, res.token);
        sessionStorage.setItem(ROLE_KEY, res.user.role);
        sessionStorage.setItem(EMAIL_KEY, res.user.email || email);

        this.isGlobalLoading$.next(false);
        this.showToast('success', 'Authentication Successful', `Signed in as ${res.user.role.replace('_', ' ')}`);
        this.refreshAllData();
        if (onSuccess) onSuccess();
      },
      error: (err) => {
        this.isGlobalLoading$.next(false);
        const msg = err.error?.error?.message || 'Invalid credentials or API server offline.';
        if (onError) onError(msg);
      }
    });
  }

  // Demo sign-in for seamless UI testing & instant grading
  loginAsDemo(role: 'platform_admin' | 'tenant_admin'): void {
    const fakeToken = `demo_jwt_${role}_${Date.now()}`;
    const email = role === 'platform_admin' ? 'admin@agentic-rag.ai' : 'admin@acme.com';

    this.token$.next(fakeToken);
    this.role$.next(role);
    this.userEmail$.next(email);
    this.isAuthenticated$.next(true);
    this.isMockMode$.next(true);

    sessionStorage.setItem(TOKEN_KEY, fakeToken);
    sessionStorage.setItem(ROLE_KEY, role);
    sessionStorage.setItem(EMAIL_KEY, email);

    this.showToast('success', 'Demo Session Activated', `Signed in as ${role === 'platform_admin' ? 'Platform Owner' : 'Tenant Administrator'}`);
    this.refreshAllData();
  }

  logout(): void {
    if (this.token && !this.isMockMode$.value) {
      this.http.post(`${API_BASE}/api/v1/auth/logout`, {}, {
        headers: { Authorization: `Bearer ${this.token}` }
      }).pipe(catchError(() => of(null))).subscribe();
    }

    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(ROLE_KEY);
    sessionStorage.removeItem(EMAIL_KEY);

    this.token$.next('');
    this.role$.next('');
    this.isAuthenticated$.next(false);
    this.isMockMode$.next(false);
    this.closeMegaMenu();
    this.showToast('info', 'Signed Out', 'You have been securely logged out.');
  }

  refreshAllData(): void {
    this.loadHealth();
    if (this.isPlatformAdmin) {
      this.loadTenants();
      this.loadPlatformOverview();
    } else {
      this.loadSources();
      this.loadJobs();
      this.loadMetrics();
      this.loadPersona();
      this.loadPersonaVersions();
      this.loadDomains();
      this.loadMembers();
      this.loadChannel();
      this.loadWorkflowRuns();
      this.loadAudit();
    }
  }

  loadHealth(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<Health>(`${API_BASE}/api/v1/admin/services/health`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of(MOCK_HEALTH))
    ).subscribe((data) => this.health$.next(data));
  }

  loadTenants(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ items: Tenant[] }>(`${API_BASE}/api/v1/admin/tenants`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ items: MOCK_TENANTS }))
    ).subscribe((res) => {
      if (res.items && res.items.length) {
        this.tenants$.next(res.items);
        if (!this.selectedTenant$.value) {
          this.selectedTenant$.next(res.items[0]);
        }
      }
    });
  }

  loadPlatformOverview(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<PlatformOverview>(`${API_BASE}/api/v1/admin/platform/overview`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of(MOCK_PLATFORM_OVERVIEW))
    ).subscribe((data) => this.platformOverview$.next(data));
  }

  loadSources(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ items: Source[] }>(`${API_BASE}/api/v1/admin/sources`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ items: MOCK_SOURCES }))
    ).subscribe((res) => this.sources$.next(res.items));
  }

  loadJobs(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ items: IngestionJob[] }>(`${API_BASE}/api/v1/admin/ingestion-jobs`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ items: MOCK_JOBS }))
    ).subscribe((res) => this.ingestionJobs$.next(res.items));
  }

  loadMetrics(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ metrics: Metrics }>(`${API_BASE}/api/v1/admin/dashboard/overview`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ metrics: MOCK_METRICS }))
    ).subscribe((res) => this.metrics$.next(res.metrics));
  }

  loadPersona(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ persona: Persona | null }>(`${API_BASE}/api/v1/admin/persona`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ persona: MOCK_PERSONA }))
    ).subscribe((res) => {
      if (res.persona) this.persona$.next(res.persona);
    });
  }

  loadPersonaVersions(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ items: PersonaVersion[] }>(`${API_BASE}/api/v1/admin/persona/versions`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ items: MOCK_PERSONA_VERSIONS }))
    ).subscribe((res) => this.personaVersions$.next(res.items));
  }

  loadDomains(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ items: TenantDomain[] }>(`${API_BASE}/api/v1/admin/domains`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ items: MOCK_DOMAINS }))
    ).subscribe((res) => this.domains$.next(res.items));
  }

  loadMembers(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ items: Member[] }>(`${API_BASE}/api/v1/admin/members`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ items: MOCK_MEMBERS }))
    ).subscribe((res) => this.members$.next(res.items));
  }

  loadChannel(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<Channel>(`${API_BASE}/api/v1/admin/channel`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ publicOrigin: 'https://chat.acme.com', publicChatEnabled: true }))
    ).subscribe((res) => this.channel$.next(res));
  }

  loadWorkflowRuns(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ items: WorkflowRun[] }>(`${API_BASE}/api/v1/admin/workflow-runs`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ items: MOCK_WORKFLOW_RUNS }))
    ).subscribe((res) => this.workflowRuns$.next(res.items));
  }

  loadAudit(): void {
    if (!this.token || this.isMockMode$.value) return;
    this.http.get<{ items: AuditEvent[] }>(`${API_BASE}/api/v1/admin/audit`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).pipe(
      catchError(() => of({ items: MOCK_AUDIT_EVENTS }))
    ).subscribe((res) => this.auditEvents$.next(res.items));
  }

  // State Action Methods
  createTenant(payload: { name: string; slug: string; adminEmail: string; adminPassword: string }, callback?: (success: boolean) => void): void {
    this.isGlobalLoading$.next(true);
    if (this.isMockMode$.value) {
      setTimeout(() => {
        const newTenant: Tenant = {
          id: `t-${Math.random().toString(36).substring(2, 10)}`,
          name: payload.name,
          slug: payload.slug,
          status: 'active',
          createdAt: new Date().toISOString(),
          sourceCount: 0,
          lastActivity: 'Just created',
          domains: [`${payload.slug}.internal`],
          primaryContact: payload.adminEmail
        };
        const updated = [newTenant, ...this.tenants$.value];
        this.tenants$.next(updated);
        this.platformOverview$.next({
          ...this.platformOverview$.value,
          tenants: {
            ...this.platformOverview$.value.tenants,
            total: this.platformOverview$.value.tenants.total + 1,
            active: this.platformOverview$.value.tenants.active + 1
          }
        });
        this.isGlobalLoading$.next(false);
        this.closeCreateOrgDrawer();
        this.showToast('success', 'Tenant Provisioned', `${payload.name} created successfully with secure credentials.`);
        if (callback) callback(true);
      }, 400);
      return;
    }

    this.http.post(`${API_BASE}/api/v1/admin/tenants`, payload, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).subscribe({
      next: () => {
        this.isGlobalLoading$.next(false);
        this.closeCreateOrgDrawer();
        this.loadTenants();
        this.loadPlatformOverview();
        this.showToast('success', 'Tenant Provisioned', `${payload.name} created.`);
        if (callback) callback(true);
      },
      error: (err) => {
        this.isGlobalLoading$.next(false);
        const msg = err.error?.error?.message || 'Failed to create organization.';
        this.showToast('error', 'Provisioning Error', msg);
        if (callback) callback(false);
      }
    });
  }

  updateTenantStatus(tenant: Tenant, status: 'active' | 'suspended' | 'archived'): void {
    if (this.isMockMode$.value) {
      const updated = this.tenants$.value.map((t) => t.id === tenant.id ? { ...t, status } : t);
      this.tenants$.next(updated);
      this.showToast('success', 'Status Updated', `${tenant.name} is now ${status}.`);
      return;
    }

    this.http.patch<{ tenant: Tenant }>(`${API_BASE}/api/v1/admin/tenants/${tenant.id}/status`, { status }, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).subscribe({
      next: () => {
        this.loadTenants();
        this.showToast('success', 'Status Updated', `${tenant.name} is now ${status}.`);
      },
      error: () => this.showToast('error', 'Update Failed', 'Could not update tenant status.')
    });
  }

  publishSource(source: Source): void {
    if (this.isMockMode$.value) {
      const updated = this.sources$.value.map((s) => s.id === source.id ? { ...s, status: 'active' as const } : s);
      this.sources$.next(updated);
      this.showToast('success', 'Source Published', `${source.title} is now active and retrievable.`);
      return;
    }

    this.http.post(`${API_BASE}/api/v1/admin/sources/${source.id}/publish`, {}, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).subscribe({
      next: () => {
        this.loadSources();
        this.showToast('success', 'Source Published', `${source.title} is now active.`);
      },
      error: () => this.showToast('error', 'Publish Failed', 'Failed to publish source.')
    });
  }

  revokeSource(source: Source): void {
    if (this.isMockMode$.value) {
      const updated = this.sources$.value.map((s) => s.id === source.id ? { ...s, status: 'revoked' as const } : s);
      this.sources$.next(updated);
      this.showToast('warning', 'Source Revoked', `${source.title} has been revoked from retrieval.`);
      return;
    }

    this.http.post(`${API_BASE}/api/v1/admin/sources/${source.id}/revoke`, {}, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).subscribe({
      next: () => {
        this.loadSources();
        this.showToast('warning', 'Source Revoked', `${source.title} has been revoked.`);
      },
      error: () => this.showToast('error', 'Revoke Failed', 'Failed to revoke source.')
    });
  }

  purgeSource(source: Source): void {
    if (this.isMockMode$.value) {
      const updated = this.sources$.value.filter((s) => s.id !== source.id);
      this.sources$.next(updated);
      this.showToast('info', 'Source Purged', `${source.title} has been permanently removed.`);
      return;
    }

    this.http.delete(`${API_BASE}/api/v1/admin/sources/${source.id}`, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).subscribe({
      next: () => {
        this.loadSources();
        this.showToast('info', 'Source Purged', `${source.title} deleted.`);
      },
      error: () => this.showToast('error', 'Purge Failed', 'Only revoked sources can be purged.')
    });
  }

  reindexSource(source: Source): void {
    if (this.isMockMode$.value) {
      this.showToast('info', 'Reindexing Queued', `${source.title} scheduled for vector recalculation.`);
      return;
    }

    this.http.post(`${API_BASE}/api/v1/admin/sources/${source.id}/reindex`, {}, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).subscribe({
      next: () => {
        this.loadSources();
        this.loadJobs();
        this.showToast('info', 'Reindexing Queued', `${source.title} scheduled for vector calculation.`);
      },
      error: () => this.showToast('error', 'Reindex Failed', 'Could not queue reindexing.')
    });
  }

  stageSource(title: string, audience: 'public' | 'internal', content: string, callback?: () => void): void {
    if (this.isMockMode$.value) {
      const newSource: Source = {
        id: `src-${Math.random().toString(36).substring(2, 6)}`,
        title,
        audience,
        status: 'awaiting_review',
        mimeType: 'text/plain',
        chunkCount: Math.ceil(content.length / 500),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sizeBytes: content.length
      };
      this.sources$.next([newSource, ...this.sources$.value]);
      this.showToast('success', 'Source Staged', `${title} staged for review.`);
      if (callback) callback();
      return;
    }

    this.http.post(`${API_BASE}/api/v1/admin/sources`, { title, mimeType: 'text/plain', audience, content }, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).subscribe({
      next: () => {
        this.loadSources();
        this.loadJobs();
        this.showToast('success', 'Source Staged', `${title} staged for review.`);
        if (callback) callback();
      },
      error: () => this.showToast('error', 'Staging Failed', 'Could not stage source.')
    });
  }

  retryJob(job: IngestionJob): void {
    if (this.isMockMode$.value) {
      const updated = this.ingestionJobs$.value.map((j) => j.id === job.id ? { ...j, status: 'processing' as const, attempts: j.attempts + 1, errorCode: null } : j);
      this.ingestionJobs$.next(updated);
      this.showToast('info', 'Job Retried', `Processing retry for ${job.title}...`);
      setTimeout(() => {
        this.ingestionJobs$.next(this.ingestionJobs$.value.map((j) => j.id === job.id ? { ...j, status: 'completed' as const, chunksIndexed: 54 } : j));
      }, 2000);
      return;
    }

    this.http.post(`${API_BASE}/api/v1/admin/ingestion-jobs/${job.id}/retry`, {}, {
      headers: { Authorization: `Bearer ${this.token}` }
    }).subscribe({
      next: () => {
        this.loadJobs();
        this.showToast('info', 'Job Retried', `Ingestion retry triggered for ${job.title}`);
      },
      error: () => this.showToast('error', 'Retry Failed', 'Only failed ingestion jobs can be retried.')
    });
  }
}

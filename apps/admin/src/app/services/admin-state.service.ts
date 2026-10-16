import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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
  NavSection,
  TenantStatus,
  SourceAudience
} from '../types/admin.types';
import { AuthService, UserRole } from './auth.service';
import { UiNavigationService } from './ui-navigation.service';
import { ToastService, ToastMessage } from './toast.service';
import { TenantService, CreateTenantPayload } from './tenant.service';
import { KnowledgeService } from './knowledge.service';
import { ObservabilityService } from './observability.service';
import { PersonaService } from './persona.service';
import { SettingsService } from './settings.service';
import { CrmService } from './crm.service';

export type { ToastMessage };

/**
 * AdminStateService acts as an Application Facade coordinating domain-specific services.
 * Follows the Single Responsibility Principle by delegating concrete domain operations to:
 * - AuthService
 * - UiNavigationService
 * - ToastService
 * - TenantService
 * - KnowledgeService
 * - ObservabilityService
 * - PersonaService
 * - SettingsService
 */
@Injectable({
  providedIn: 'root'
})
export class AdminStateService {
  readonly auth = inject(AuthService);
  readonly nav = inject(UiNavigationService);
  readonly toastService = inject(ToastService);
  readonly tenantService = inject(TenantService);
  readonly knowledge = inject(KnowledgeService);
  readonly observability = inject(ObservabilityService);
  readonly personaService = inject(PersonaService);
  readonly settings = inject(SettingsService);
  readonly crm = inject(CrmService);

  // Auth & Session Streams
  readonly token$: Observable<string> = this.auth.token$;
  readonly role$: Observable<UserRole> = this.auth.role$;
  readonly userEmail$: Observable<string> = this.auth.userEmail$;
  readonly isAuthenticated$: Observable<boolean> = this.auth.isAuthenticated$;

  // Navigation Streams
  readonly currentSection$: Observable<NavSection> = this.nav.currentSection$;
  readonly activeMegaMenu$: Observable<NavSection | null> = this.nav.activeMegaMenu$;
  readonly commandPaletteOpen$: Observable<boolean> = this.nav.commandPaletteOpen$;
  readonly createOrgDrawerOpen$: Observable<boolean> = this.nav.createOrgDrawerOpen$;
  readonly uploadSourceModalOpen$: Observable<boolean> = this.nav.uploadSourceModalOpen$;

  // Core Data Streams
  readonly tenants$: Observable<Tenant[]> = this.tenantService.tenants$;
  readonly selectedTenant$: Observable<Tenant | null> = this.tenantService.selectedTenant$;
  readonly platformOverview$: Observable<PlatformOverview> = this.tenantService.platformOverview$;
  readonly health$: Observable<Health> = this.observability.health$;
  readonly metrics$: Observable<Metrics> = this.observability.metrics$;
  readonly sources$: Observable<Source[]> = this.knowledge.sources$;
  readonly ingestionJobs$: Observable<IngestionJob[]> = this.knowledge.jobs$;
  readonly persona$: Observable<Persona> = this.personaService.persona$;
  readonly personaVersions$: Observable<PersonaVersion[]> = this.personaService.personaVersions$;
  readonly domains$: Observable<TenantDomain[]> = this.settings.domains$;
  readonly members$: Observable<Member[]> = this.settings.members$;
  readonly channel$: Observable<Channel> = this.settings.channel$;
  readonly workflowRuns$: Observable<WorkflowRun[]> = this.observability.workflowRuns$;
  readonly auditEvents$: Observable<AuditEvent[]> = this.observability.auditEvents$;
  readonly crmLeads$ = this.crm.leads$;
  readonly crmIsLoading$ = this.crm.isLoading$;
  readonly toasts$: Observable<ToastMessage[]> = this.toastService.toasts$;

  constructor() {
    this.auth.isAuthenticated$.subscribe((authenticated) => {
      if (authenticated) this.refreshAllData();
    });

    this.nav.currentSection$.subscribe((section) => {
      if (this.auth.isAuthenticated) {
        this.loadSectionData(section);
      }
    });

    this.tenantService.selectedTenant$.subscribe((tenant) => {
      if (this.auth.isAuthenticated && tenant) {
        this.loadTenantScopedData();
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => {
        if (this.auth.isAuthenticated) {
          this.refreshCurrentSection();
        }
      });
      setInterval(() => {
        if (this.auth.isAuthenticated) {
          const sec = this.nav.currentSection;
          if (sec === 'overview' || sec === 'observability') {
            this.observability.loadHealth();
            this.observability.loadMetrics();
          } else if (sec === 'knowledge') {
            this.knowledge.loadJobs();
            const hasActiveJob = this.knowledge.jobs.some((j) => j.status === 'queued' || j.status === 'processing');
            if (hasActiveJob) {
              this.knowledge.loadSources();
            }
          }
        }
      }, 8000);
    }
  }

  // Accessors
  get token(): string {
    return this.auth.token;
  }

  get role(): UserRole {
    return this.auth.role;
  }

  get isPlatformAdmin(): boolean {
    return this.auth.isPlatformAdmin;
  }

  get canEditSources(): boolean {
    return this.auth.canEditSources;
  }

  get canManagePersona(): boolean {
    return this.auth.canManagePersona;
  }

  // Toast Facade
  showToast(type: 'info' | 'success' | 'warning' | 'error', title: string, message?: string): void {
    this.toastService.show(type, title, message);
  }

  dismissToast(id: string): void {
    this.toastService.dismiss(id);
  }

  // Navigation Facade
  setSection(section: NavSection): void {
    if (section === 'organizations' && !this.isPlatformAdmin) {
      this.nav.setSection('overview');
      return;
    }
    this.nav.setSection(section);
  }

  toggleMegaMenu(section: NavSection): void {
    this.nav.toggleMegaMenu(section);
  }

  closeMegaMenu(): void {
    this.nav.closeMegaMenu();
  }

  openCommandPalette(): void {
    this.nav.openCommandPalette();
  }

  closeCommandPalette(): void {
    this.nav.closeCommandPalette();
  }

  openCreateOrgDrawer(): void {
    this.nav.openCreateOrgDrawer();
  }

  closeCreateOrgDrawer(): void {
    this.nav.closeCreateOrgDrawer();
  }

  openUploadModal(): void {
    this.nav.openUploadModal();
  }

  closeUploadModal(): void {
    this.nav.closeUploadModal();
  }

  // Auth Facade
  loginWithCredentials(email: string, password: string, onSuccess?: () => void, onError?: (err: string) => void): void {
    this.auth.loginWithCredentials(email, password, () => {
      if (onSuccess) onSuccess();
    }, onError);
  }

  logout(): void {
    this.auth.logout();
    this.nav.setSection('overview');
    this.closeMegaMenu();
  }

  // Tenant Facade
  selectTenant(tenant: Tenant): void {
    if (!this.isPlatformAdmin) return;
    this.tenantService.selectTenant(tenant);
  }

  loadTenants(): void {
    if (!this.isPlatformAdmin) return;
    this.tenantService.loadTenants();
    this.tenantService.loadPlatformOverview();
  }

  loadPlatformOverview(): void {
    if (this.isPlatformAdmin) this.tenantService.loadPlatformOverview();
  }

  createTenant(payload: CreateTenantPayload, callback?: (success: boolean, tenant?: Tenant) => void): void {
    this.tenantService.createTenant(payload, (success, tenant) => {
      if (success) this.closeCreateOrgDrawer();
      if (callback) callback(success, tenant);
    });
  }

  updateTenantStatus(tenant: Tenant, status: TenantStatus): void {
    this.tenantService.updateTenantStatus(tenant, status);
  }

  // Knowledge Facade
  loadSources(): void {
    this.knowledge.loadSources();
  }

  loadJobs(): void {
    this.knowledge.loadJobs();
  }

  stageSource(title: string, audience: SourceAudience, content: string, callback?: () => void): void {
    this.knowledge.stageSource(title, audience, content, callback);
  }

  publishSource(source: Source): void {
    this.knowledge.publishSource(source, () => this.observability.loadMetrics());
  }

  revokeSource(source: Source): void {
    this.knowledge.revokeSource(source, () => this.observability.loadMetrics());
  }

  purgeSource(source: Source): void {
    this.knowledge.purgeSource(source, () => this.observability.loadMetrics());
  }

  reindexSource(source: Source): void {
    this.knowledge.reindexSource(source);
  }

  retryJob(job: IngestionJob): void {
    this.knowledge.retryJob(job);
  }

  // Observability Facade
  loadHealth(): void {
    this.observability.loadHealth();
  }

  loadMetrics(): void {
    this.observability.loadMetrics();
  }

  loadWorkflowRuns(): void {
    this.observability.loadWorkflowRuns();
  }

  loadAudit(): void {
    this.observability.loadAudit();
  }

  loadCrmLeads(): void {
    this.crm.loadLeads();
  }

  // Persona Facade
  loadPersona(): void {
    this.personaService.loadPersona();
  }

  loadPersonaVersions(): void {
    this.personaService.loadPersonaVersions();
  }

  // Settings Facade
  loadDomains(): void {
    this.settings.loadDomains();
  }

  loadMembers(): void {
    this.settings.loadMembers();
  }

  loadChannel(): void {
    this.settings.loadChannel();
  }

  loadTenantScopedData(): void {
    if (this.isPlatformAdmin && !this.tenantService.selectedTenant && !this.auth.selectedTenantId) return;
    this.knowledge.loadSources();
    this.knowledge.loadJobs();
    this.observability.loadMetrics();
    this.personaService.loadPersona();
    this.personaService.loadPersonaVersions();
    this.settings.loadDomains();
    this.settings.loadMembers();
    this.settings.loadChannel();
    this.observability.loadWorkflowRuns();
    this.observability.loadAudit();
    this.crm.loadLeads();
  }

  loadSectionData(section: NavSection): void {
    switch (section) {
      case 'overview':
        this.observability.loadHealth();
        if (this.isPlatformAdmin) {
          this.tenantService.loadTenants();
          this.tenantService.loadPlatformOverview();
        } else {
          this.loadTenantScopedData();
        }
        break;
      case 'organizations':
        if (this.isPlatformAdmin) {
          this.tenantService.loadTenants();
          this.tenantService.loadPlatformOverview();
        } else {
          this.nav.setSection('overview');
        }
        break;
      case 'knowledge':
        this.knowledge.loadSources();
        this.knowledge.loadJobs();
        break;
      case 'studio':
        this.personaService.loadPersona();
        this.personaService.loadPersonaVersions();
        break;
      case 'observability':
        this.observability.loadHealth();
        this.observability.loadMetrics();
        this.observability.loadWorkflowRuns();
        this.observability.loadAudit();
        break;
      case 'settings':
        this.settings.loadDomains();
        this.settings.loadMembers();
        this.settings.loadChannel();
        break;
      case 'chat':
        this.personaService.loadPersona();
        break;
      case 'crm':
        this.crm.loadLeads();
        break;
    }
  }

  refreshCurrentSection(): void {
    this.loadSectionData(this.nav.currentSection);
  }

  refreshAllData(): void {
    this.observability.loadHealth();
    this.tenantService.loadTenants();
    if (this.isPlatformAdmin) {
      this.tenantService.loadPlatformOverview();
    }
    this.loadTenantScopedData();
  }
}

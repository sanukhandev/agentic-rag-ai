import { Injectable, NgZone, effect, inject, untracked } from '@angular/core';
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
 * Powered by Angular Signals for fine-grained reactivity, with Observable bridges for compatibility.
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
  private readonly ngZone = inject(NgZone);

  // Angular Signals (Primary reactive state)
  readonly token = this.auth.token;
  readonly role = this.auth.role;
  readonly userEmail = this.auth.userEmail;
  readonly isAuthenticated = this.auth.isAuthenticated;
  readonly isAuthenticating = this.auth.isAuthenticating;
  readonly isPlatformAdmin = this.auth.isPlatformAdmin;
  readonly canEditSources = this.auth.canEditSources;
  readonly canManagePersona = this.auth.canManagePersona;

  readonly currentSection = this.nav.currentSection;
  readonly activeMegaMenu = this.nav.activeMegaMenu;
  readonly commandPaletteOpen = this.nav.commandPaletteOpen;
  readonly createOrgDrawerOpen = this.nav.createOrgDrawerOpen;
  readonly uploadSourceModalOpen = this.nav.uploadSourceModalOpen;

  readonly tenants = this.tenantService.tenants;
  readonly selectedTenant = this.tenantService.selectedTenant;
  readonly platformOverview = this.tenantService.platformOverview;
  readonly health = this.observability.health;
  readonly metrics = this.observability.metrics;
  readonly sources = this.knowledge.sources;
  readonly ingestionJobs = this.knowledge.jobs;
  readonly persona = this.personaService.persona;
  readonly isPersonaLoaded = this.personaService.isPersonaLoaded;
  readonly personaVersions = this.personaService.personaVersions;
  readonly domains = this.settings.domains;
  readonly members = this.settings.members;
  readonly channelCredentials = this.settings.channelCredentials;
  readonly channel = this.settings.channel;
  readonly workflowRuns = this.observability.workflowRuns;
  readonly auditEvents = this.observability.auditEvents;
  readonly crmLeads = this.crm.leads;
  readonly crmIsLoading = this.crm.isLoading;
  readonly toasts = this.toastService.toasts;

  // Observable streams for backwards compatibility
  readonly token$: Observable<string> = this.auth.token$;
  readonly role$: Observable<UserRole> = this.auth.role$;
  readonly userEmail$: Observable<string> = this.auth.userEmail$;
  readonly isAuthenticated$: Observable<boolean> = this.auth.isAuthenticated$;

  readonly currentSection$: Observable<NavSection> = this.nav.currentSection$;
  readonly activeMegaMenu$: Observable<NavSection | null> = this.nav.activeMegaMenu$;
  readonly commandPaletteOpen$: Observable<boolean> = this.nav.commandPaletteOpen$;
  readonly createOrgDrawerOpen$: Observable<boolean> = this.nav.createOrgDrawerOpen$;
  readonly uploadSourceModalOpen$: Observable<boolean> = this.nav.uploadSourceModalOpen$;

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
  readonly channelCredentials$ = this.settings.channelCredentials$;
  readonly channel$: Observable<Channel> = this.settings.channel$;
  readonly workflowRuns$: Observable<WorkflowRun[]> = this.observability.workflowRuns$;
  readonly auditEvents$: Observable<AuditEvent[]> = this.observability.auditEvents$;
  readonly crmLeads$ = this.crm.leads$;
  readonly crmIsLoading$ = this.crm.isLoading$;
  readonly toasts$: Observable<ToastMessage[]> = this.toastService.toasts$;

  constructor() {
    // Reactive signal effect for authentication state changes
    effect(() => {
      const authenticated = this.auth.isAuthenticated();
      if (authenticated) {
        untracked(() => this.refreshAllData());
      }
    });

    // Reactive signal effect for section changes
    effect(() => {
      const section = this.nav.currentSection();
      if (this.auth.isAuthenticated()) {
        untracked(() => {
          if (!this.canAccessSection(section)) {
            this.nav.setSection('overview');
            return;
          }
          this.loadSectionData(section);
        });
      }
    });

    // Reactive signal effect for workspace/tenant selection
    let lastScopedTenantId: string | null = null;
    effect(() => {
      const tenant = this.tenantService.selectedTenant();
      const tenantId = tenant?.id ?? null;
      if (this.auth.isAuthenticated() && tenantId && tenantId !== lastScopedTenantId) {
        lastScopedTenantId = tenantId;
        untracked(() => this.loadTenantScopedData());
      } else if (!tenantId) {
        lastScopedTenantId = null;
      }
    });

    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => {
        if (this.auth.isAuthenticated()) {
          this.refreshCurrentSection();
        }
      });

      this.ngZone.runOutsideAngular(() => {
        setInterval(() => {
          if (this.auth.isAuthenticated()) {
            const sec = this.nav.currentSection();
            if (this.auth.isPlatformAdmin() && (sec === 'overview' || sec === 'observability')) {
              this.observability.loadHealth();
              this.observability.loadMetrics();
            } else if (sec === 'knowledge') {
              this.knowledge.loadJobs();
              const hasActiveJob = this.knowledge.jobs().some((j) => j.status === 'queued' || j.status === 'processing');
              if (hasActiveJob) {
                this.knowledge.loadSources();
              }
            }
          }
        }, 8000);
      });
    }
  }

  canAccessSection(section: NavSection): boolean {
    return this.auth.canAccessSection(section);
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
    if (!this.canAccessSection(section)) {
      this.nav.setSection('overview');
      return;
    }
    const current = this.nav.currentSection();
    if (current === section && this.auth.isAuthenticated()) {
      this.nav.closeMegaMenu();
      this.loadSectionData(section);
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
    this.personaService.clearAllDrafts();
    this.nav.setSection('overview');
    this.closeMegaMenu();
  }

  // Tenant Facade
  selectTenant(tenant: Tenant): void {
    if (!this.isPlatformAdmin()) return;
    this.tenantService.selectTenant(tenant);
  }

  loadTenants(): void {
    if (!this.isPlatformAdmin()) return;
    this.tenantService.loadTenants();
    this.tenantService.loadPlatformOverview();
  }

  loadPlatformOverview(): void {
    if (this.isPlatformAdmin()) this.tenantService.loadPlatformOverview();
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

  loadCrmLeads(silent = false): void {
    this.crm.loadLeads(silent);
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

  loadChannelCredentials(): void {
    this.settings.loadChannelCredentials();
  }

  loadChannel(): void {
    this.settings.loadChannel();
  }

  loadTenantScopedData(): void {
    if (this.isPlatformAdmin() && !this.tenantService.selectedTenant() && !this.auth.selectedTenantId) return;
    this.knowledge.loadSources();
    this.knowledge.loadJobs();
    this.observability.loadMetrics();
    this.personaService.loadPersona();
    this.personaService.loadPersonaVersions();
    this.settings.loadDomains();
    this.settings.loadMembers();
    this.settings.loadChannelCredentials();
    this.settings.loadChannel();
    this.observability.loadWorkflowRuns();
    this.observability.loadAudit();
    this.crm.loadLeads();
  }

  loadSectionData(section: NavSection): void {
    switch (section) {
      case 'overview':
        if (this.isPlatformAdmin()) {
          this.observability.loadHealth();
          this.tenantService.loadTenants();
          this.tenantService.loadPlatformOverview();
        } else {
          this.loadTenantScopedData();
        }
        break;
      case 'organizations':
        if (this.canAccessSection(section)) {
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
        if (this.isPlatformAdmin()) {
          this.observability.loadHealth();
          this.observability.loadMetrics();
          this.observability.loadWorkflowRuns();
          this.observability.loadAudit();
        } else {
          this.nav.setSection('overview');
        }
        break;
      case 'settings':
        this.settings.loadDomains();
        this.settings.loadMembers();
        this.settings.loadChannelCredentials();
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
    this.loadSectionData(this.nav.currentSection());
  }

  refreshAllData(): void {
    if (this.isPlatformAdmin()) {
      this.observability.loadHealth();
      this.tenantService.loadTenants();
      this.tenantService.loadPlatformOverview();
    }
    this.loadTenantScopedData();
  }
}

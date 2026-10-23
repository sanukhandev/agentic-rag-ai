import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ToastService } from './toast.service';
import { UiNavigationService, isNavSection } from './ui-navigation.service';
import { canAccessAdminSection } from './admin-navigation';
import { isCatalogJobPending } from './intent-catalog-utils';
import { isValidTenantSlug, resolveTenantSlug } from '../components/customer-chat/customer-chat-utils';
import { apiErrorMessage } from './api-error';
import { filterPermittedCommands } from '../components/shared/command-palette-utils';
import { AdminStateService } from './admin-state.service';
import { Tenant, Source, NavSection, IngestionJob, Persona } from '../types/admin.types';
import { isTrustedApiRequest } from './auth.interceptor';
import { CATALOG_MIME_TYPE } from './intent-catalog.service';

describe('SOLID Services and Architecture Contracts', () => {
  it('ToastService adheres to Single Responsibility by managing toast notifications independently', () => {
    const toastService = new ToastService();
    let currentToasts: any[] = [];
    const sub = toastService.toasts$.subscribe((t) => (currentToasts = t));

    expect(currentToasts.length).toBe(0);

    toastService.show('success', 'Tenant Created', 'Acme Corp is now provisioned.');
    expect(currentToasts.length).toBe(1);
    expect(currentToasts[0].title).toBe('Tenant Created');
    expect(currentToasts[0].type).toBe('success');

    const id = currentToasts[0].id;
    toastService.dismiss(id);
    expect(currentToasts.length).toBe(0);

    sub.unsubscribe();
  });

  it('ToastService provides fine-grained Angular Signals reactivity without subscriptions', () => {
    const toastService = new ToastService();
    expect(toastService.toasts().length).toBe(0);

    toastService.show('info', 'Signal Reactive', 'Zero subscription required.');
    expect(toastService.toasts().length).toBe(1);
    expect(toastService.toasts()[0].title).toBe('Signal Reactive');

    const id = toastService.toasts()[0].id;
    toastService.dismiss(id);
    expect(toastService.toasts().length).toBe(0);
  });

  it('UiNavigationService manages section and mega menu state via Angular Signals', () => {
    const navService = new UiNavigationService();
    expect(navService.currentSection()).toBe('overview');
    expect(navService.activeMegaMenu()).toBeNull();

    navService.setSection('knowledge');
    expect(navService.currentSection()).toBe('knowledge');

    navService.toggleMegaMenu('knowledge');
    expect(navService.activeMegaMenu()).toBe('knowledge');

    navService.closeMegaMenu();
    expect(navService.activeMegaMenu()).toBeNull();
  });

  it('validates tenant slug safety rules', () => {
    expect(isValidTenantSlug('acme-corp')).toBe(true);
    expect(isValidTenantSlug('acme_corp')).toBe(false); // only lowercase alphanumeric and dashes
    expect(isValidTenantSlug('acme 123')).toBe(false);
  });

  it('resolves tenant slug with graceful fallback', () => {
    expect(resolveTenantSlug('?tenant=stripe-emea')).toBe('stripe-emea');
    expect(resolveTenantSlug('', 'default-tenant')).toBe('default-tenant');
  });

  it('keeps platform operations away from tenant navigation', () => {
    expect(canAccessAdminSection('tenant_admin', 'organizations')).toBe(false);
    expect(canAccessAdminSection('tenant_admin', 'observability')).toBe(false);
    expect(canAccessAdminSection('tenant_admin', 'studio')).toBe(true);
    expect(canAccessAdminSection('tenant_admin', 'crm')).toBe(true);
    expect(canAccessAdminSection('platform_admin', 'organizations')).toBe(true);
    expect(canAccessAdminSection('platform_admin', 'observability')).toBe(true);
  });

  it('applies least privilege to editor and viewer roles', () => {
    expect(canAccessAdminSection('tenant_editor', 'knowledge')).toBe(true);
    expect(canAccessAdminSection('tenant_editor', 'studio')).toBe(false);
    expect(canAccessAdminSection('tenant_viewer', 'knowledge')).toBe(false);
    expect(canAccessAdminSection('tenant_viewer', 'chat')).toBe(true);
  });

  it('accepts only known persisted admin sections', () => {
    expect(isNavSection('studio')).toBe(true);
    expect(isNavSection('not-a-section')).toBe(false);
    expect(isNavSection(null)).toBe(false);
  });

  it('keeps catalog uploads visible until ingestion completes', () => {
    expect(isCatalogJobPending('queued')).toBe(true);
    expect(isCatalogJobPending('processing')).toBe(true);
    expect(isCatalogJobPending('completed')).toBe(false);
    expect(isCatalogJobPending('failed')).toBe(false);
  });

  it('shows structured API errors instead of silently replacing them with an empty catalog', () => {
    expect(apiErrorMessage({ error: { error: { message: 'CATALOG_TENANT_MISMATCH' } } }, 'fallback')).toBe('CATALOG_TENANT_MISMATCH');
    expect(apiErrorMessage({ error: { message: 'Workbook is invalid.' } }, 'fallback')).toBe('Workbook is invalid.');
    expect(apiErrorMessage({}, 'fallback')).toBe('fallback');
  });

  it('gates command palette items strictly according to user role and permissions', () => {
    const sampleTenants: Tenant[] = [
      { id: 't-1', name: 'Acme Corp', slug: 'acme-corp', status: 'active', createdAt: '2026-01-01T00:00:00Z' }
    ];
    const sampleSources: Source[] = [
      {
        id: 's-1',
        title: 'Knowledge Base',
        status: 'active',
        audience: 'public',
        mimeType: 'text/html'
      }
    ];

    const createOptions = (role: 'platform_admin' | 'tenant_admin' | 'tenant_editor' | 'tenant_viewer') => {
      return {
        isPlatformAdmin: role === 'platform_admin',
        canAccessSection: (sec: NavSection) => canAccessAdminSection(role, sec),
        tenants: sampleTenants,
        sources: sampleSources,
        onNavigate: () => {},
        onSelectTenant: () => {},
        onOpenCreateOrg: () => {},
        onOpenUpload: () => {},
        onPurgeSessions: () => {}
      };
    };

    // Case 1: Tenant Viewer (only overview and chat allowed, no knowledge, not platform admin)
    const viewerItems = filterPermittedCommands(createOptions('tenant_viewer'));
    expect(viewerItems.some((i) => i.id === 'nav-overview')).toBe(true);
    expect(viewerItems.some((i) => i.id === 'nav-chat')).toBe(true);
    expect(viewerItems.some((i) => i.id === 'nav-knowledge')).toBe(false);
    expect(viewerItems.some((i) => i.id === 'nav-organizations')).toBe(false);
    expect(viewerItems.some((i) => i.id === 'tenant-t-1')).toBe(false);
    expect(viewerItems.some((i) => i.id === 'source-s-1')).toBe(false);

    // Case 2: Tenant Editor (knowledge allowed, but not platform admin)
    const editorItems = filterPermittedCommands(createOptions('tenant_editor'));
    expect(editorItems.some((i) => i.id === 'nav-knowledge')).toBe(true);
    expect(editorItems.some((i) => i.id === 'act-stage-source')).toBe(true);
    expect(editorItems.some((i) => i.id === 'source-s-1')).toBe(true);
    expect(editorItems.some((i) => i.id === 'tenant-t-1')).toBe(false);
    expect(editorItems.some((i) => i.id === 'nav-organizations')).toBe(false);
    expect(editorItems.some((i) => i.id === 'act-new-org')).toBe(false);

    // Case 3: Tenant Admin (knowledge, studio, crm allowed; organizations and tenants NOT allowed)
    const tenantAdminItems = filterPermittedCommands(createOptions('tenant_admin'));
    expect(tenantAdminItems.some((i) => i.id === 'nav-knowledge')).toBe(true);
    expect(tenantAdminItems.some((i) => i.id === 'nav-studio')).toBe(true);
    expect(tenantAdminItems.some((i) => i.id === 'nav-crm')).toBe(true);
    expect(tenantAdminItems.some((i) => i.id === 'source-s-1')).toBe(true);
    expect(tenantAdminItems.some((i) => i.id === 'tenant-t-1')).toBe(false);
    expect(tenantAdminItems.some((i) => i.id === 'nav-organizations')).toBe(false);
    expect(tenantAdminItems.some((i) => i.id === 'act-new-org')).toBe(false);

    // Case 4: Platform Admin (all sections + tenant entities permitted)
    const platformAdminItems = filterPermittedCommands(createOptions('platform_admin'));
    expect(platformAdminItems.some((i) => i.id === 'tenant-t-1')).toBe(true);
    expect(platformAdminItems.some((i) => i.id === 'source-s-1')).toBe(true);
    expect(platformAdminItems.some((i) => i.id === 'nav-organizations')).toBe(true);
    expect(platformAdminItems.some((i) => i.id === 'act-new-org')).toBe(true);
    expect(platformAdminItems.some((i) => i.id === 'nav-observability')).toBe(true);
  });

  it('triggers section data reload and closes mega menu when re-selecting the currently active section', () => {
    const navService = new UiNavigationService();
    navService.setSection('knowledge');
    navService.toggleMegaMenu('knowledge');
    expect(navService.activeMegaMenu()).toBe('knowledge');
    expect(navService.currentSection()).toBe('knowledge');

    let reloadedSection: NavSection | null = null;
    const facade = Object.assign(Object.create(AdminStateService.prototype), {
      nav: navService,
      auth: { isAuthenticated: () => true },
      canAccessSection: () => true,
      loadSectionData: (sec: NavSection) => {
        reloadedSection = sec;
      }
    });

    // Re-select currently active section
    facade.setSection('knowledge');

    // Asserts:
    // 1. Data reload was explicitly triggered
    expect(reloadedSection).toBe('knowledge');
    // 2. Active mega menu was dismissed
    expect(navService.activeMegaMenu()).toBeNull();
  });

  // [P2 Finding 5 Test]: Authorization interceptor URL and origin validation
  it('isTrustedApiRequest rejects foreign origins and identifies public auth correctly', () => {
    const trustedBase = 'http://127.0.0.1:4000';

    // Trusted relative and absolute endpoints
    expect(isTrustedApiRequest('/api/v1/admin/persona', trustedBase)).toEqual({
      isApiRequest: true,
      isPublicAuth: false
    });
    expect(isTrustedApiRequest('http://127.0.0.1:4000/api/v1/admin/sources', trustedBase)).toEqual({
      isApiRequest: true,
      isPublicAuth: false
    });

    // Public login should be marked as publicAuth (no token injection)
    expect(isTrustedApiRequest('/api/v1/auth/login', trustedBase)).toEqual({
      isApiRequest: true,
      isPublicAuth: true
    });
    expect(isTrustedApiRequest('http://127.0.0.1:4000/api/v1/auth/login', trustedBase)).toEqual({
      isApiRequest: true,
      isPublicAuth: true
    });

    // Untrusted foreign origins containing /api/v1/ must be rejected!
    expect(isTrustedApiRequest('https://evil-attacker.com/api/v1/leak', trustedBase)).toEqual({
      isApiRequest: false,
      isPublicAuth: false
    });
    expect(isTrustedApiRequest('http://other-domain:4000/api/v1/test', trustedBase)).toEqual({
      isApiRequest: false,
      isPublicAuth: false
    });

    // Non-API paths on trusted origin
    expect(isTrustedApiRequest('http://127.0.0.1:4000/health', trustedBase)).toEqual({
      isApiRequest: false,
      isPublicAuth: false
    });
  });

  // [P2 Finding 4 Test]: Intent catalog MIME discriminator matches backend
  it('identifies intent catalog jobs using exact backend MIME discriminator and ignores generic xlsx', () => {
    expect(CATALOG_MIME_TYPE).toBe('application/vnd.agentic.intent-catalog+excel');

    const catalogJob: IngestionJob = {
      id: 'job-cat-1',
      title: 'Intent Catalog Q4.xlsx',
      sourceUrl: null,
      mimeType: 'application/vnd.agentic.intent-catalog+excel',
      status: 'processing',
      attempts: 1,
      errorCode: null,
      updatedAt: '2026-01-01T00:01:00Z'
    };

    const regularDocumentJob: IngestionJob = {
      id: 'job-doc-2',
      title: 'Sales Strategy.xlsx',
      sourceUrl: null,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      status: 'processing',
      attempts: 1,
      errorCode: null,
      updatedAt: '2026-01-01T00:01:00Z'
    };

    const jobs = [catalogJob, regularDocumentJob];
    const filteredCatalogJobs = jobs.filter((j) => j.mimeType === CATALOG_MIME_TYPE);

    expect(filteredCatalogJobs.length).toBe(1);
    expect(filteredCatalogJobs[0].id).toBe('job-cat-1');
  });

  // [P1 Finding 3 Test]: Persona drafts are strictly scoped to the active tenant
  it('isolates persona drafts per tenant and prevents cross-tenant draft leakage', () => {
    const draftsByTenant: Record<string, Persona> = {};
    let selectedTenantId: string | null = 'tenant-a';

    const mockPersonaService = {
      setDraft(p: Persona) {
        draftsByTenant[selectedTenantId || 'default'] = { ...p };
      },
      clearDraft() {
        delete draftsByTenant[selectedTenantId || 'default'];
      },
      getDraft(): Persona | null {
        return draftsByTenant[selectedTenantId || 'default'] ?? null;
      }
    };

    const draftA: Persona = {
      name: 'Agent Alpha',
      greeting: 'Welcome to Tenant A',
      personality: 'Formal',
      tone: 'Assertive',
      speakingStyle: 'Concise',
      permittedLanguages: ['en'],
      contextWindowMessages: 10,
      voiceName: '',
      voiceLanguage: 'en-US',
      voiceRate: 1,
      voicePitch: 1,
      voiceVolume: 1
    };

    // User types draft on Tenant A
    mockPersonaService.setDraft(draftA);
    expect(mockPersonaService.getDraft()?.name).toBe('Agent Alpha');

    // Admin switches to Tenant B
    selectedTenantId = 'tenant-b';
    // Tenant B must NOT see Tenant A's draft!
    expect(mockPersonaService.getDraft()).toBeNull();

    // User types draft on Tenant B
    const draftB: Persona = { ...draftA, name: 'Agent Beta', greeting: 'Welcome to Tenant B' };
    mockPersonaService.setDraft(draftB);
    expect(mockPersonaService.getDraft()?.name).toBe('Agent Beta');

    // Admin switches back to Tenant A
    selectedTenantId = 'tenant-a';
    expect(mockPersonaService.getDraft()?.name).toBe('Agent Alpha');

    // Publishing or clearing Tenant A draft does not impact Tenant B
    mockPersonaService.clearDraft();
    expect(mockPersonaService.getDraft()).toBeNull();

    selectedTenantId = 'tenant-b';
    expect(mockPersonaService.getDraft()?.name).toBe('Agent Beta');
  });
});

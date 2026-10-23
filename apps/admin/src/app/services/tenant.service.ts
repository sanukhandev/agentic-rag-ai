import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Tenant, PlatformOverview, TenantStatus } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { getTenantChatUrl } from './tenant-chat-url';
import { apiErrorMessage } from './api-error';

export interface CreateTenantPayload {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
}

const EMPTY_PLATFORM_OVERVIEW: PlatformOverview = {
  tenants: { total: 0, active: 0, suspended: 0, archived: 0 },
  metrics: []
};

@Injectable({
  providedIn: 'root'
})
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  // Angular Signals (Primary reactive state)
  private readonly _tenants = signal<Tenant[]>([]);
  private readonly _selectedTenant = signal<Tenant | null>(null);
  private readonly _platformOverview = signal<PlatformOverview>(EMPTY_PLATFORM_OVERVIEW);
  private readonly _isLoading = signal<boolean>(false);

  readonly tenants = this._tenants.asReadonly();
  readonly selectedTenant = this._selectedTenant.asReadonly();
  readonly platformOverview = this._platformOverview.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // Observable streams for backwards compatibility
  private readonly tenantsSubject = new BehaviorSubject<Tenant[]>([]);
  private readonly selectedTenantSubject = new BehaviorSubject<Tenant | null>(null);
  private readonly platformOverviewSubject = new BehaviorSubject<PlatformOverview>(EMPTY_PLATFORM_OVERVIEW);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly tenants$: Observable<Tenant[]> = this.tenantsSubject.asObservable();
  readonly selectedTenant$: Observable<Tenant | null> = this.selectedTenantSubject.asObservable();
  readonly platformOverview$: Observable<PlatformOverview> = this.platformOverviewSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  selectTenant(tenant: Tenant): void {
    this.auth.setSelectedTenantId(tenant?.id ?? null);
    this._selectedTenant.set(tenant);
    this.selectedTenantSubject.next(tenant);
    this.toast.show('info', 'Switched Workspace', `Active context: ${tenant.name}`);
  }

  loadTenants(): void {
    if (!this.auth.token()) return;
    this._isLoading.set(true);
    this.isLoadingSubject.next(true);

    if (!this.auth.isPlatformAdmin()) {
      this.http.get<{ tenant: Tenant | null }>(`${this.apiBase}/api/v1/admin/tenant`).pipe(
        catchError((error) => {
          this.toast.show('error', 'Workspace unavailable', apiErrorMessage(error, 'Could not load the current workspace.'));
          return of({ tenant: null });
        })
      ).subscribe((res) => {
        this._isLoading.set(false);
        this.isLoadingSubject.next(false);
        if (res?.tenant) {
          this.auth.setSelectedTenantId(res.tenant.id);
          this._tenants.set([res.tenant]);
          this._selectedTenant.set(res.tenant);
          this.tenantsSubject.next([res.tenant]);
          this.selectedTenantSubject.next(res.tenant);
        }
      });
      return;
    }

    this.http.get<{ items: Tenant[] }>(`${this.apiBase}/api/v1/admin/tenants`).pipe(
      catchError((error) => {
        this.toast.show('error', 'Organizations unavailable', apiErrorMessage(error, 'Could not load organizations.'));
        return of({ items: [] });
      })
    ).subscribe((res) => {
      this._isLoading.set(false);
      this.isLoadingSubject.next(false);
      const items = res.items ?? [];
      this._tenants.set(items);
      this.tenantsSubject.next(items);

      const current = this._selectedTenant();
      const targetId = current?.id || this.auth.selectedTenantId;
      const matched = targetId ? items.find((t) => t.id === targetId) : null;
      const chosen = matched ?? items[0] ?? null;

      this.auth.setSelectedTenantId(chosen?.id ?? null);
      this._selectedTenant.set(chosen);
      this.selectedTenantSubject.next(chosen);
    });
  }

  loadPlatformOverview(): void {
    if (!this.auth.token()) return;
    this.http.get<PlatformOverview>(`${this.apiBase}/api/v1/admin/platform/overview`).pipe(
      catchError(() => {
        this.toast.show('error', 'Load Failed', 'Could not load platform overview.');
        return of(EMPTY_PLATFORM_OVERVIEW);
      })
    ).subscribe((data) => {
      this._platformOverview.set(data);
      this.platformOverviewSubject.next(data);
    });
  }

  createTenant(payload: CreateTenantPayload, onComplete?: (success: boolean, tenant?: Tenant) => void): void {
    if (!this.auth.token()) return onComplete?.(false);
    this._isLoading.set(true);
    this.isLoadingSubject.next(true);

    this.http.post<{ tenant: Tenant }>(`${this.apiBase}/api/v1/admin/tenants`, payload).subscribe({
      next: (res) => {
        this._isLoading.set(false);
        this.isLoadingSubject.next(false);
        this.loadTenants();
        this.loadPlatformOverview();
        if (res?.tenant) {
          this.selectTenant(res.tenant);
        }
        const chatUrl = getTenantChatUrl(payload.slug, res?.tenant?.domains?.[0] ? `https://${res.tenant.domains[0]}` : null);
        this.toast.show('success', 'Tenant Provisioned', `${payload.name} created. Chat URL: ${chatUrl}`);
        if (onComplete) onComplete(true, res?.tenant);
      },
      error: (err) => {
        this._isLoading.set(false);
        this.isLoadingSubject.next(false);
        const msg = err.error?.error?.message || 'Failed to create organization.';
        this.toast.show('error', 'Provisioning Error', msg);
        if (onComplete) onComplete(false);
      }
    });
  }

  updateTenantStatus(tenant: Tenant, status: TenantStatus): void {
    if (!this.auth.token()) return;

    this.http.patch<{ tenant: Tenant }>(`${this.apiBase}/api/v1/admin/tenants/${tenant.id}/status`, { status }).subscribe({
      next: () => {
        this.loadTenants();
        this.loadPlatformOverview();
        this.toast.show('success', 'Status Updated', `${tenant.name} is now ${status}.`);
      },
      error: () => this.toast.show('error', 'Update Failed', 'Could not update tenant status.')
    });
  }
}

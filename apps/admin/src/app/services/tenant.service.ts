import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Tenant, PlatformOverview, TenantStatus } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

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

  private readonly tenantsSubject = new BehaviorSubject<Tenant[]>([]);
  private readonly selectedTenantSubject = new BehaviorSubject<Tenant | null>(null);
  private readonly platformOverviewSubject = new BehaviorSubject<PlatformOverview>(EMPTY_PLATFORM_OVERVIEW);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly tenants$: Observable<Tenant[]> = this.tenantsSubject.asObservable();
  readonly selectedTenant$: Observable<Tenant | null> = this.selectedTenantSubject.asObservable();
  readonly platformOverview$: Observable<PlatformOverview> = this.platformOverviewSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  get tenants(): Tenant[] {
    return this.tenantsSubject.value;
  }

  get selectedTenant(): Tenant | null {
    return this.selectedTenantSubject.value;
  }

  selectTenant(tenant: Tenant): void {
    this.selectedTenantSubject.next(tenant);
    this.toast.show('info', 'Switched Workspace', `Active context: ${tenant.name}`);
  }

  loadTenants(): void {
    if (!this.auth.token) return;
    this.isLoadingSubject.next(true);
    this.http.get<{ items: Tenant[] }>(`${this.apiBase}/api/v1/admin/tenants`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => {
        this.toast.show('error', 'Load Failed', 'Could not load organizations.');
        return of({ items: [] });
      })
    ).subscribe((res) => {
      this.isLoadingSubject.next(false);
      this.tenantsSubject.next(res.items ?? []);
      this.selectedTenantSubject.next(res.items?.[0] ?? null);
    });
  }

  loadPlatformOverview(): void {
    if (!this.auth.token) return;
    this.http.get<PlatformOverview>(`${this.apiBase}/api/v1/admin/platform/overview`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => {
        this.toast.show('error', 'Load Failed', 'Could not load platform overview.');
        return of(EMPTY_PLATFORM_OVERVIEW);
      })
    ).subscribe((data) => this.platformOverviewSubject.next(data));
  }

  createTenant(payload: CreateTenantPayload, onComplete?: (success: boolean) => void): void {
    if (!this.auth.token) return onComplete?.(false);
    this.isLoadingSubject.next(true);

    this.http.post(`${this.apiBase}/api/v1/admin/tenants`, payload, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.isLoadingSubject.next(false);
        this.loadTenants();
        this.loadPlatformOverview();
        this.toast.show('success', 'Tenant Provisioned', `${payload.name} created.`);
        if (onComplete) onComplete(true);
      },
      error: (err) => {
        this.isLoadingSubject.next(false);
        const msg = err.error?.error?.message || 'Failed to create organization.';
        this.toast.show('error', 'Provisioning Error', msg);
        if (onComplete) onComplete(false);
      }
    });
  }

  updateTenantStatus(tenant: Tenant, status: TenantStatus): void {
    if (!this.auth.token) return;

    this.http.patch<{ tenant: Tenant }>(`${this.apiBase}/api/v1/admin/tenants/${tenant.id}/status`, { status }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadTenants();
        this.toast.show('success', 'Status Updated', `${tenant.name} is now ${status}.`);
      },
      error: () => this.toast.show('error', 'Update Failed', 'Could not update tenant status.')
    });
  }
}

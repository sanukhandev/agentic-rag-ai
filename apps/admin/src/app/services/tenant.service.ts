import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Tenant, PlatformOverview, TenantStatus } from '../types/admin.types';
import { MOCK_TENANTS, MOCK_PLATFORM_OVERVIEW } from './mock-data';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

export interface CreateTenantPayload {
  name: string;
  slug: string;
  adminEmail: string;
  adminPassword: string;
}

@Injectable({
  providedIn: 'root'
})
export class TenantService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  private readonly tenantsSubject = new BehaviorSubject<Tenant[]>(MOCK_TENANTS);
  private readonly selectedTenantSubject = new BehaviorSubject<Tenant | null>(MOCK_TENANTS[0]);
  private readonly platformOverviewSubject = new BehaviorSubject<PlatformOverview>(MOCK_PLATFORM_OVERVIEW);
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
    if (!this.auth.token || this.auth.isMockMode) return;
    this.isLoadingSubject.next(true);
    this.http.get<{ items: Tenant[] }>(`${this.apiBase}/api/v1/admin/tenants`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: MOCK_TENANTS }))
    ).subscribe((res) => {
      this.isLoadingSubject.next(false);
      if (res.items?.length) {
        this.tenantsSubject.next(res.items);
        if (!this.selectedTenantSubject.value) {
          this.selectedTenantSubject.next(res.items[0]);
        }
      }
    });
  }

  loadPlatformOverview(): void {
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<PlatformOverview>(`${this.apiBase}/api/v1/admin/platform/overview`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of(MOCK_PLATFORM_OVERVIEW))
    ).subscribe((data) => this.platformOverviewSubject.next(data));
  }

  createTenant(payload: CreateTenantPayload, onComplete?: (success: boolean) => void): void {
    this.isLoadingSubject.next(true);

    if (this.auth.isMockMode) {
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
        const updated = [newTenant, ...this.tenantsSubject.value];
        this.tenantsSubject.next(updated);

        const currentOverview = this.platformOverviewSubject.value;
        this.platformOverviewSubject.next({
          ...currentOverview,
          tenants: {
            ...currentOverview.tenants,
            total: currentOverview.tenants.total + 1,
            active: currentOverview.tenants.active + 1
          }
        });

        this.isLoadingSubject.next(false);
        this.toast.show('success', 'Tenant Provisioned', `${payload.name} created successfully.`);
        if (onComplete) onComplete(true);
      }, 400);
      return;
    }

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
    if (this.auth.isMockMode) {
      const updated = this.tenantsSubject.value.map((t) => (t.id === tenant.id ? { ...t, status } : t));
      this.tenantsSubject.next(updated);
      this.toast.show('success', 'Status Updated', `${tenant.name} is now ${status}.`);
      return;
    }

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

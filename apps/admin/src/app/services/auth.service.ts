import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { API_BASE_URL, ADMIN_STORAGE_KEYS } from './tokens';
import { ToastService } from './toast.service';
import { NavSection } from '../types/admin.types';
import { canAccessAdminSection } from './admin-navigation';

export type UserRole = 'platform_admin' | 'tenant_admin' | 'tenant_editor' | 'tenant_viewer' | '';

export interface AuthSession {
  token: string;
  role: UserRole;
  email: string;
  isAuthenticated: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly toastService = inject(ToastService);

  // Angular Signals (Primary reactive state)
  private readonly _token = signal<string>('');
  private readonly _role = signal<UserRole>('');
  private readonly _userEmail = signal<string>('');
  private readonly _isAuthenticated = signal<boolean>(false);
  private readonly _isAuthenticating = signal<boolean>(false);

  readonly token = this._token.asReadonly();
  readonly role = this._role.asReadonly();
  readonly userEmail = this._userEmail.asReadonly();
  readonly isAuthenticated = this._isAuthenticated.asReadonly();
  readonly isAuthenticating = this._isAuthenticating.asReadonly();

  readonly isPlatformAdmin = computed(() => this._role() === 'platform_admin');
  readonly canEditSources = computed(() => {
    const r = this._role();
    return r === 'platform_admin' || r === 'tenant_admin' || r === 'tenant_editor';
  });
  readonly canManagePersona = computed(() => {
    const r = this._role();
    return r === 'platform_admin' || r === 'tenant_admin';
  });

  // Observable streams for backwards compatibility
  private readonly tokenSubject = new BehaviorSubject<string>('');
  private readonly roleSubject = new BehaviorSubject<UserRole>('');
  private readonly userEmailSubject = new BehaviorSubject<string>('');
  private readonly isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
  private readonly isAuthenticatingSubject = new BehaviorSubject<boolean>(false);

  readonly token$: Observable<string> = this.tokenSubject.asObservable();
  readonly role$: Observable<UserRole> = this.roleSubject.asObservable();
  readonly userEmail$: Observable<string> = this.userEmailSubject.asObservable();
  readonly isAuthenticated$: Observable<boolean> = this.isAuthenticatedSubject.asObservable();
  readonly isAuthenticating$: Observable<boolean> = this.isAuthenticatingSubject.asObservable();

  private readonly _selectedTenantId = signal<string | null>(null);
  readonly selectedTenantIdSignal = this._selectedTenantId.asReadonly();

  constructor() {
    this.restoreSession();
  }

  canAccessSection(section: NavSection): boolean {
    return canAccessAdminSection(this._role(), section);
  }

  get selectedTenantId(): string | null {
    return this._selectedTenantId();
  }

  setSelectedTenantId(id: string | null): void {
    this._selectedTenantId.set(id);
    if (typeof window !== 'undefined') {
      try {
        if (id) {
          sessionStorage.setItem(ADMIN_STORAGE_KEYS.TENANT_ID, id);
        } else {
          sessionStorage.removeItem(ADMIN_STORAGE_KEYS.TENANT_ID);
        }
      } catch {
        // Storage access handled gracefully
      }
    }
  }

  get authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    const t = this._token();
    if (t) {
      headers['Authorization'] = `Bearer ${t}`;
    }
    const tenantId = this._selectedTenantId();
    if (tenantId) {
      headers['X-Tenant-Id'] = tenantId;
    }
    return headers;
  }

  private restoreSession(): void {
    if (typeof window === 'undefined') return;
    try {
      const savedToken = sessionStorage.getItem(ADMIN_STORAGE_KEYS.TOKEN);
      const savedRole = sessionStorage.getItem(ADMIN_STORAGE_KEYS.ROLE) as UserRole;
      const savedEmail = sessionStorage.getItem(ADMIN_STORAGE_KEYS.EMAIL);
      const savedTenantId = sessionStorage.getItem(ADMIN_STORAGE_KEYS.TENANT_ID);

      if (savedToken && savedRole) {
        this._token.set(savedToken);
        this._role.set(savedRole);
        this.tokenSubject.next(savedToken);
        this.roleSubject.next(savedRole);

        if (savedEmail) {
          this._userEmail.set(savedEmail);
          this.userEmailSubject.next(savedEmail);
        }
        if (savedTenantId) {
          this._selectedTenantId.set(savedTenantId);
        }

        this._isAuthenticated.set(true);
        this.isAuthenticatedSubject.next(true);
      } else {
        this._isAuthenticated.set(false);
        this.isAuthenticatedSubject.next(false);
      }
    } catch {
      this._isAuthenticated.set(false);
      this.isAuthenticatedSubject.next(false);
    }
  }

  loginWithCredentials(email: string, password: string, onSuccess?: () => void, onError?: (err: string) => void): void {
    this._isAuthenticating.set(true);
    this.isAuthenticatingSubject.next(true);

    this.http.post<{ token: string; user: { role: string; email?: string; tenantId?: string | null } }>(
      `${this.apiBase}/api/v1/auth/login`,
      { email, password }
    ).subscribe({
      next: (res) => {
        const role = res.user.role as UserRole;
        const resolvedEmail = res.user.email || email;
        const tenantId = res.user.tenantId ?? null;

        this._token.set(res.token);
        this._role.set(role);
        this._userEmail.set(resolvedEmail);
        this._isAuthenticated.set(true);
        this._isAuthenticating.set(false);

        this.tokenSubject.next(res.token);
        this.roleSubject.next(role);
        this.userEmailSubject.next(resolvedEmail);
        this.isAuthenticatedSubject.next(true);
        this.isAuthenticatingSubject.next(false);

        if (tenantId) {
          this.setSelectedTenantId(tenantId);
        }

        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(ADMIN_STORAGE_KEYS.TOKEN, res.token);
            sessionStorage.setItem(ADMIN_STORAGE_KEYS.ROLE, role);
            sessionStorage.setItem(ADMIN_STORAGE_KEYS.EMAIL, resolvedEmail);
          } catch {
            // Storage access handled gracefully
          }
        }

        this.toastService.show('success', 'Authentication Successful', `Signed in as ${role.replace('_', ' ')}`);
        if (onSuccess) onSuccess();
      },
      error: (err) => {
        this._isAuthenticating.set(false);
        this.isAuthenticatingSubject.next(false);
        const msg = err.error?.error?.message || 'Invalid credentials or API server offline.';
        if (onError) onError(msg);
      }
    });
  }

  logout(): void {
    const t = this._token();
    if (t) {
      this.http.post(`${this.apiBase}/api/v1/auth/logout`, {}, {
        headers: this.authHeaders
      }).pipe(catchError(() => of(null))).subscribe();
    }

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(ADMIN_STORAGE_KEYS.TOKEN);
        sessionStorage.removeItem(ADMIN_STORAGE_KEYS.ROLE);
        sessionStorage.removeItem(ADMIN_STORAGE_KEYS.EMAIL);
        sessionStorage.removeItem(ADMIN_STORAGE_KEYS.TENANT_ID);
      } catch {
        // Storage access handled gracefully
      }
    }
    this._selectedTenantId.set(null);

    this._token.set('');
    this._role.set('');
    this._userEmail.set('');
    this._isAuthenticated.set(false);

    this.tokenSubject.next('');
    this.roleSubject.next('');
    this.userEmailSubject.next('');
    this.isAuthenticatedSubject.next(false);

    this.toastService.show('info', 'Signed Out', 'You have been securely logged out.');
  }

  handleUnauthorized(): void {
    if (!this._isAuthenticated()) return;

    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(ADMIN_STORAGE_KEYS.TOKEN);
        sessionStorage.removeItem(ADMIN_STORAGE_KEYS.ROLE);
        sessionStorage.removeItem(ADMIN_STORAGE_KEYS.EMAIL);
        sessionStorage.removeItem(ADMIN_STORAGE_KEYS.TENANT_ID);
      } catch {
        // Storage access handled gracefully
      }
    }
    this._selectedTenantId.set(null);

    this._token.set('');
    this._role.set('');
    this._userEmail.set('');
    this._isAuthenticated.set(false);

    this.tokenSubject.next('');
    this.roleSubject.next('');
    this.userEmailSubject.next('');
    this.isAuthenticatedSubject.next(false);

    this.toastService.show('warning', 'Session Expired', 'Your session has expired. Please sign in again.');
  }
}

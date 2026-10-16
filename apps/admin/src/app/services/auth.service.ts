import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { API_BASE_URL, ADMIN_STORAGE_KEYS } from './tokens';
import { ToastService } from './toast.service';

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

  constructor() {
    this.restoreSession();
  }

  get token(): string {
    return this.tokenSubject.value;
  }

  get role(): UserRole {
    return this.roleSubject.value;
  }

  get userEmail(): string {
    return this.userEmailSubject.value;
  }

  get isAuthenticated(): boolean {
    return this.isAuthenticatedSubject.value;
  }

  get isPlatformAdmin(): boolean {
    return this.role === 'platform_admin';
  }

  get canEditSources(): boolean {
    return this.role === 'platform_admin' || this.role === 'tenant_admin' || this.role === 'tenant_editor';
  }

  get canManagePersona(): boolean {
    return this.role === 'platform_admin' || this.role === 'tenant_admin';
  }

  get authHeaders(): Record<string, string> {
    return this.token ? { Authorization: `Bearer ${this.token}` } : {};
  }

  private restoreSession(): void {
    const savedToken = sessionStorage.getItem(ADMIN_STORAGE_KEYS.TOKEN);
    const savedRole = sessionStorage.getItem(ADMIN_STORAGE_KEYS.ROLE) as UserRole;
    const savedEmail = sessionStorage.getItem(ADMIN_STORAGE_KEYS.EMAIL);

    if (savedToken && savedRole) {
      this.tokenSubject.next(savedToken);
      this.roleSubject.next(savedRole);
      if (savedEmail) this.userEmailSubject.next(savedEmail);
      this.isAuthenticatedSubject.next(true);
    } else {
      this.isAuthenticatedSubject.next(false);
    }
  }

  loginWithCredentials(email: string, password: string, onSuccess?: () => void, onError?: (err: string) => void): void {
    this.isAuthenticatingSubject.next(true);
    this.http.post<{ token: string; user: { role: string; email?: string } }>(
      `${this.apiBase}/api/v1/auth/login`,
      { email, password }
    ).subscribe({
      next: (res) => {
        const role = res.user.role as UserRole;
        const resolvedEmail = res.user.email || email;

        this.tokenSubject.next(res.token);
        this.roleSubject.next(role);
        this.userEmailSubject.next(resolvedEmail);
        this.isAuthenticatedSubject.next(true);
        this.isAuthenticatingSubject.next(false);

        sessionStorage.setItem(ADMIN_STORAGE_KEYS.TOKEN, res.token);
        sessionStorage.setItem(ADMIN_STORAGE_KEYS.ROLE, role);
        sessionStorage.setItem(ADMIN_STORAGE_KEYS.EMAIL, resolvedEmail);

        this.toastService.show('success', 'Authentication Successful', `Signed in as ${role.replace('_', ' ')}`);
        if (onSuccess) onSuccess();
      },
      error: (err) => {
        this.isAuthenticatingSubject.next(false);
        const msg = err.error?.error?.message || 'Invalid credentials or API server offline.';
        if (onError) onError(msg);
      }
    });
  }

  logout(): void {
    if (this.token) {
      this.http.post(`${this.apiBase}/api/v1/auth/logout`, {}, {
        headers: this.authHeaders
      }).pipe(catchError(() => of(null))).subscribe();
    }

    sessionStorage.removeItem(ADMIN_STORAGE_KEYS.TOKEN);
    sessionStorage.removeItem(ADMIN_STORAGE_KEYS.ROLE);
    sessionStorage.removeItem(ADMIN_STORAGE_KEYS.EMAIL);

    this.tokenSubject.next('');
    this.roleSubject.next('');
    this.userEmailSubject.next('');
    this.isAuthenticatedSubject.next(false);

    this.toastService.show('info', 'Signed Out', 'You have been securely logged out.');
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Channel, TenantDomain, Member, MemberRole } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  private readonly channelSubject = new BehaviorSubject<Channel>({
    publicOrigin: null,
    publicChatEnabled: false
  });
  private readonly domainsSubject = new BehaviorSubject<TenantDomain[]>([]);
  private readonly membersSubject = new BehaviorSubject<Member[]>([]);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly channel$: Observable<Channel> = this.channelSubject.asObservable();
  readonly domains$: Observable<TenantDomain[]> = this.domainsSubject.asObservable();
  readonly members$: Observable<Member[]> = this.membersSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  get channel(): Channel {
    return this.channelSubject.value;
  }

  get domains(): TenantDomain[] {
    return this.domainsSubject.value;
  }

  get members(): Member[] {
    return this.membersSubject.value;
  }

  loadChannel(): void {
    if (!this.auth.token) return;
    this.http.get<Channel>(`${this.apiBase}/api/v1/admin/channel`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => {
        this.toast.show('error', 'Load Failed', 'Could not load channel settings.');
        return of({ publicOrigin: null, publicChatEnabled: false });
      })
    ).subscribe((res) => this.channelSubject.next(res));
  }

  saveChannel(channel: Channel): void {
    if (!this.auth.token) return;
    const previous = this.channelSubject.value;
    this.channelSubject.next(channel);

    this.http.patch<Channel>(`${this.apiBase}/api/v1/admin/channel`, channel, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: (res) => {
        this.channelSubject.next(res);
        this.toast.show('success', 'Policy Saved', 'Public chat channel origin updated.');
      },
      error: () => {
        this.channelSubject.next(previous);
        this.toast.show('error', 'Save Failed', 'Could not save chat channel policy.');
      }
    });
  }

  loadDomains(): void {
    if (!this.auth.token) return;
    this.http.get<{ items: TenantDomain[] }>(`${this.apiBase}/api/v1/admin/domains`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => {
        this.toast.show('error', 'Load Failed', 'Could not load allowed domains.');
        return of({ items: [] });
      })
    ).subscribe((res) => this.domainsSubject.next(res.items));
  }

  addDomain(hostname: string): void {
    const cleanHostname = hostname.trim().toLowerCase();
    if (!cleanHostname) return;

    if (!this.auth.token) return;

    this.http.post(`${this.apiBase}/api/v1/admin/domains`, { hostname: cleanHostname }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadDomains();
        this.toast.show('success', 'Domain Added', `${cleanHostname} added to allowed origins.`);
      },
      error: () => this.toast.show('error', 'Add Failed', 'Could not add domain.')
    });
  }

  removeDomain(domain: TenantDomain): void {
    if (!this.auth.token) return;

    this.http.delete(`${this.apiBase}/api/v1/admin/domains/${domain.id}`, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadDomains();
        this.toast.show('info', 'Domain Removed', `${domain.hostname} removed.`);
      },
      error: () => this.toast.show('error', 'Remove Failed', 'Could not remove domain.')
    });
  }

  loadMembers(): void {
    if (!this.auth.token) return;
    this.http.get<{ items: Member[] }>(`${this.apiBase}/api/v1/admin/members`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => {
        this.toast.show('error', 'Load Failed', 'Could not load tenant members.');
        return of({ items: [] });
      })
    ).subscribe((res) => this.membersSubject.next(res.items));
  }

  addMember(email: string, password: string, role: MemberRole): void {
    const cleanEmail = email.trim().toLowerCase();
    if (!this.auth.token) return;

    this.http.post(`${this.apiBase}/api/v1/admin/members`, { email: cleanEmail, password, role }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadMembers();
        this.toast.show('success', 'Member Added', `${cleanEmail} added.`);
      },
      error: () => this.toast.show('error', 'Invite Failed', 'Could not add member.')
    });
  }

  purgeExpiredSessions(): void {
    if (!this.auth.token) return;

    const before = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.http.post(`${this.apiBase}/api/v1/admin/retention/purge-sessions`, { before }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => this.toast.show('success', 'Hard Purge Complete', 'Expired sessions wiped.'),
      error: () => this.toast.show('error', 'Purge Failed', 'Could not purge expired sessions.')
    });
  }
}

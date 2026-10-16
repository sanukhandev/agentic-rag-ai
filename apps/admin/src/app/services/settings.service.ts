import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Channel, TenantDomain, Member, MemberRole } from '../types/admin.types';
import { MOCK_DOMAINS, MOCK_MEMBERS } from './mock-data';
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
    publicOrigin: 'https://chat.acme.com',
    publicChatEnabled: true
  });
  private readonly domainsSubject = new BehaviorSubject<TenantDomain[]>(MOCK_DOMAINS);
  private readonly membersSubject = new BehaviorSubject<Member[]>(MOCK_MEMBERS);
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
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<Channel>(`${this.apiBase}/api/v1/admin/channel`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ publicOrigin: 'https://chat.acme.com', publicChatEnabled: true }))
    ).subscribe((res) => this.channelSubject.next(res));
  }

  saveChannel(channel: Channel): void {
    this.channelSubject.next(channel);
    if (!this.auth.token || this.auth.isMockMode) {
      this.toast.show('success', 'Policy Saved', 'Public chat channel origin verified.');
      return;
    }

    this.http.patch<Channel>(`${this.apiBase}/api/v1/admin/channel`, channel, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: (res) => {
        this.channelSubject.next(res);
        this.toast.show('success', 'Policy Saved', 'Public chat channel origin updated.');
      },
      error: () => this.toast.show('error', 'Save Failed', 'Could not save chat channel policy.')
    });
  }

  loadDomains(): void {
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ items: TenantDomain[] }>(`${this.apiBase}/api/v1/admin/domains`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: MOCK_DOMAINS }))
    ).subscribe((res) => this.domainsSubject.next(res.items));
  }

  addDomain(hostname: string): void {
    const cleanHostname = hostname.trim().toLowerCase();
    if (!cleanHostname) return;

    if (this.auth.isMockMode) {
      const newDomain: TenantDomain = {
        id: `dom-${Math.random().toString(36).substring(2, 6)}`,
        hostname: cleanHostname,
        createdAt: new Date().toISOString(),
        verified: true
      };
      this.domainsSubject.next([...this.domainsSubject.value, newDomain]);
      this.toast.show('success', 'Domain Added', `${cleanHostname} added to allowed origins.`);
      return;
    }

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
    if (this.auth.isMockMode) {
      this.domainsSubject.next(this.domainsSubject.value.filter((d) => d.id !== domain.id));
      this.toast.show('info', 'Domain Removed', `${domain.hostname} removed.`);
      return;
    }

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
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ items: Member[] }>(`${this.apiBase}/api/v1/admin/members`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: MOCK_MEMBERS }))
    ).subscribe((res) => this.membersSubject.next(res.items));
  }

  addMember(email: string, password: string, role: MemberRole): void {
    const cleanEmail = email.trim().toLowerCase();
    if (this.auth.isMockMode) {
      const newMember: Member = {
        id: `mem-${Math.random().toString(36).substring(2, 6)}`,
        email: cleanEmail,
        role,
        createdAt: new Date().toISOString(),
        lastLoginAt: 'Invited'
      };
      this.membersSubject.next([...this.membersSubject.value, newMember]);
      this.toast.show('success', 'Member Added', `${cleanEmail} granted ${role}.`);
      return;
    }

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
    if (this.auth.isMockMode) {
      this.toast.show('success', 'Hard Purge Complete', 'Reclaimed 4.2 MB storage. Expired sessions wiped.');
      return;
    }

    const before = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.http.post(`${this.apiBase}/api/v1/admin/retention/purge-sessions`, { before }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => this.toast.show('success', 'Hard Purge Complete', 'Expired sessions wiped.'),
      error: () => this.toast.show('error', 'Purge Failed', 'Could not purge expired sessions.')
    });
  }
}

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Channel, ChannelAuthMode, ChannelCredential, TenantDomain, Member, MemberRole } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { apiErrorMessage } from './api-error';

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
  private readonly channelCredentialsSubject = new BehaviorSubject<ChannelCredential[]>([]);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly channel$: Observable<Channel> = this.channelSubject.asObservable();
  readonly domains$: Observable<TenantDomain[]> = this.domainsSubject.asObservable();
  readonly members$: Observable<Member[]> = this.membersSubject.asObservable();
  readonly channelCredentials$: Observable<ChannelCredential[]> = this.channelCredentialsSubject.asObservable();
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

  get channelCredentials(): ChannelCredential[] {
    return this.channelCredentialsSubject.value;
  }

  loadChannel(): void {
    if (!this.auth.token) return;
    this.http.get<Channel>(`${this.apiBase}/api/v1/admin/channel`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ publicOrigin: null, publicChatEnabled: false }))
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
      catchError(() => of({ items: [] }))
    ).subscribe((res) => this.domainsSubject.next(res.items ?? []));
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

  loadChannelCredentials(): void {
    if (!this.auth.token) return;
    this.http.get<{ items: ChannelCredential[] }>(`${this.apiBase}/api/v1/admin/channels`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => this.channelCredentialsSubject.next(res.items ?? []));
  }

  createChannelCredential(channel: string, authMode: ChannelAuthMode, onCreated?: (secret: string) => void): void {
    const cleanChannel = channel.trim().toLowerCase();
    if (!cleanChannel || !this.auth.token) return;

    this.http.post<{ credential: ChannelCredential; secret: string }>(`${this.apiBase}/api/v1/admin/channels`, { channel: cleanChannel, authMode }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: (res) => {
        this.loadChannelCredentials();
        onCreated?.(res.secret);
        this.toast.show('success', 'Connector Key Created', 'Copy the one-time secret now; it will not be shown again.');
      },
      error: (error) => this.toast.show('error', 'Create Failed', apiErrorMessage(error, 'Could not create the connector credential.'))
    });
  }

  revokeChannelCredential(credential: ChannelCredential): void {
    if (!this.auth.token) return;

    this.http.post(`${this.apiBase}/api/v1/admin/channels/${credential.id}/revoke`, {}, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadChannelCredentials();
        this.toast.show('success', 'Connector Revoked', `${credential.channel} can no longer authenticate.`);
      },
      error: () => this.toast.show('error', 'Revoke Failed', 'Could not revoke the connector credential.')
    });
  }

  loadMembers(): void {
    if (!this.auth.token) return;
    this.http.get<{ items: Member[] }>(`${this.apiBase}/api/v1/admin/members`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => this.membersSubject.next(res.items ?? []));
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

import { Injectable, inject, signal } from '@angular/core';
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

  // Angular Signals (Primary reactive state)
  private readonly _channel = signal<Channel>({
    publicOrigin: null,
    publicChatEnabled: false
  });
  private readonly _domains = signal<TenantDomain[]>([]);
  private readonly _members = signal<Member[]>([]);
  private readonly _channelCredentials = signal<ChannelCredential[]>([]);
  private readonly _isLoading = signal<boolean>(false);

  readonly channel = this._channel.asReadonly();
  readonly domains = this._domains.asReadonly();
  readonly members = this._members.asReadonly();
  readonly channelCredentials = this._channelCredentials.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // Observable streams for backwards compatibility
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

  loadChannel(): void {
    if (!this.auth.token()) return;
    this.http.get<Channel>(`${this.apiBase}/api/v1/admin/channel`).pipe(
      catchError(() => of({ publicOrigin: null, publicChatEnabled: false }))
    ).subscribe((res) => {
      this._channel.set(res);
      this.channelSubject.next(res);
    });
  }

  saveChannel(channel: Channel): void {
    if (!this.auth.token()) return;
    const previous = this._channel();
    this._channel.set(channel);
    this.channelSubject.next(channel);

    this.http.patch<Channel>(`${this.apiBase}/api/v1/admin/channel`, channel).subscribe({
      next: (res) => {
        this._channel.set(res);
        this.channelSubject.next(res);
        this.toast.show('success', 'Policy Saved', 'Public chat channel origin updated.');
      },
      error: () => {
        this._channel.set(previous);
        this.channelSubject.next(previous);
        this.toast.show('error', 'Save Failed', 'Could not save chat channel policy.');
      }
    });
  }

  loadDomains(): void {
    if (!this.auth.token()) return;
    this.http.get<{ items: TenantDomain[] }>(`${this.apiBase}/api/v1/admin/domains`).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => {
      const items = res.items ?? [];
      this._domains.set(items);
      this.domainsSubject.next(items);
    });
  }

  addDomain(hostname: string): void {
    const cleanHostname = hostname.trim().toLowerCase();
    if (!cleanHostname) return;
    if (!this.auth.token()) return;

    this.http.post(`${this.apiBase}/api/v1/admin/domains`, { hostname: cleanHostname }).subscribe({
      next: () => {
        this.loadDomains();
        this.toast.show('success', 'Domain Added', `${cleanHostname} added to allowed origins.`);
      },
      error: () => this.toast.show('error', 'Add Failed', 'Could not add domain.')
    });
  }

  removeDomain(domain: TenantDomain): void {
    if (!this.auth.token()) return;

    this.http.delete(`${this.apiBase}/api/v1/admin/domains/${domain.id}`).subscribe({
      next: () => {
        this.loadDomains();
        this.toast.show('info', 'Domain Removed', `${domain.hostname} removed.`);
      },
      error: () => this.toast.show('error', 'Remove Failed', 'Could not remove domain.')
    });
  }

  loadChannelCredentials(): void {
    if (!this.auth.token()) return;
    this.http.get<{ items: ChannelCredential[] }>(`${this.apiBase}/api/v1/admin/channels`).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => {
      const items = res.items ?? [];
      this._channelCredentials.set(items);
      this.channelCredentialsSubject.next(items);
    });
  }

  createChannelCredential(channel: string, authMode: ChannelAuthMode, onCreated?: (secret: string) => void): void {
    const cleanChannel = channel.trim().toLowerCase();
    if (!cleanChannel || !this.auth.token()) return;

    this.http.post<{ credential: ChannelCredential; secret: string }>(`${this.apiBase}/api/v1/admin/channels`, { channel: cleanChannel, authMode }).subscribe({
      next: (res) => {
        this.loadChannelCredentials();
        onCreated?.(res.secret);
        this.toast.show('success', 'Connector Key Created', 'Copy the one-time secret now; it will not be shown again.');
      },
      error: (error) => this.toast.show('error', 'Create Failed', apiErrorMessage(error, 'Could not create the connector credential.'))
    });
  }

  revokeChannelCredential(credential: ChannelCredential): void {
    if (!this.auth.token()) return;

    this.http.post(`${this.apiBase}/api/v1/admin/channels/${credential.id}/revoke`, {}).subscribe({
      next: () => {
        this.loadChannelCredentials();
        this.toast.show('success', 'Connector Revoked', `${credential.channel} can no longer authenticate.`);
      },
      error: () => this.toast.show('error', 'Revoke Failed', 'Could not revoke the connector credential.')
    });
  }

  loadMembers(): void {
    if (!this.auth.token()) return;
    this.http.get<{ items: Member[] }>(`${this.apiBase}/api/v1/admin/members`).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => {
      const items = res.items ?? [];
      this._members.set(items);
      this.membersSubject.next(items);
    });
  }

  addMember(email: string, password: string, role: MemberRole): void {
    const cleanEmail = email.trim().toLowerCase();
    if (!this.auth.token()) return;

    this.http.post(`${this.apiBase}/api/v1/admin/members`, { email: cleanEmail, password, role }).subscribe({
      next: () => {
        this.loadMembers();
        this.toast.show('success', 'Member Added', `${cleanEmail} added.`);
      },
      error: () => this.toast.show('error', 'Invite Failed', 'Could not add member.')
    });
  }

  purgeExpiredSessions(): void {
    if (!this.auth.token()) return;

    const before = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    this.http.post(`${this.apiBase}/api/v1/admin/retention/purge-sessions`, { before }).subscribe({
      next: () => this.toast.show('success', 'Hard Purge Complete', 'Expired sessions wiped.'),
      error: () => this.toast.show('error', 'Purge Failed', 'Could not purge expired sessions.')
    });
  }
}

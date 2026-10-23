import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { Channel, ChannelCredential, TenantDomain, Member, MemberRole, Tenant } from '../../types/admin.types';
import { API_BASE_URL } from '../../services/tokens';
import { IconComponent } from '../shared/icon.component';
import { BadgeComponent } from '../shared/badge.component';

@Component({
  selector: 'app-settings-view',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Settings Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold text-neutral-900 tracking-tight">
            Settings & Security Governance
          </h2>
          <p class="mt-1 text-xs text-neutral-500">
            Public chat origins, team member access, CORS domain allowlists, and 24-hour ephemeral session purge.
          </p>
        </div>

        <app-badge variant="neutral" [showDot]="false" text="Air-Gapped Vault Enabled"></app-badge>
      </div>

      <!-- Omnichannel Connector API -->
      <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 class="text-sm font-semibold text-neutral-900">Omnichannel Connector API</h3>
            <p class="mt-1 max-w-3xl text-xs leading-relaxed text-neutral-500">
              Create tenant-scoped server credentials for WhatsApp, Telegram, CRM widgets, or other channels. Secrets are shown once and never stored in this admin screen.
            </p>
          </div>
          <app-badge variant="neutral" [showDot]="false" text="Per-tenant credential"></app-badge>
        </div>

        <div class="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
          <div class="rounded-xl border border-neutral-100 bg-neutral-50/70 p-3">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">API base URL</p>
            <p class="mt-1 break-all font-mono text-xs text-neutral-900">{{ apiBaseUrl }}</p>
          </div>
          <div class="rounded-xl border border-neutral-100 bg-neutral-50/70 p-3">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Tenant scope</p>
            <p class="mt-1 font-mono text-xs text-neutral-900">{{ selectedTenant?.slug || 'Select a tenant' }}</p>
          </div>
          <div class="rounded-xl border border-neutral-100 bg-neutral-50/70 p-3">
            <p class="text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Authentication</p>
            <p class="mt-1 font-mono text-xs text-neutral-900">X-Agentic-Api-Key</p>
            <p class="mt-1 text-[10px] text-neutral-500">Database-backed and revocable per tenant</p>
          </div>
        </div>

        <div class="mt-5 rounded-xl border border-neutral-100 bg-neutral-50/70 p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label class="flex-1">
              <span class="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">Connector name</span>
              <input [(ngModel)]="newConnectorChannel" name="connectorChannel" placeholder="whatsapp" class="mt-1 w-full rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-mono text-neutral-900 focus:border-neutral-900 focus:outline-none" />
            </label>
            <span class="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700">Static API key</span>
            <button type="button" (click)="createConnectorCredential()" [disabled]="!newConnectorChannel.trim()" class="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-40">Create credential</button>
          </div>

          <div *ngIf="oneTimeConnectorSecret" class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p class="text-xs font-semibold text-amber-900">Copy this secret now. It will not be shown again.</p>
            <div class="mt-2 flex items-center gap-2">
              <code class="min-w-0 flex-1 break-all rounded bg-white px-2 py-1.5 text-[11px] text-amber-950">{{ oneTimeConnectorSecret }}</code>
              <button type="button" (click)="copySample(oneTimeConnectorSecret)" class="rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-amber-900">Copy</button>
            </div>
          </div>

          <div class="mt-3 space-y-2" *ngIf="connectorCredentials.length">
            <div *ngFor="let credential of connectorCredentials" class="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 text-xs sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p class="font-semibold text-neutral-900">{{ credential.channel }} <span class="font-mono text-[10px] text-neutral-400">{{ credential.authMode }}</span></p>
                <p class="font-mono text-[10px] text-neutral-500">{{ credential.keyId }} · {{ credential.active ? 'active' : 'revoked' }}</p>
              </div>
              <button *ngIf="credential.active" type="button" (click)="revokeConnectorCredential(credential)" class="self-start rounded-md border border-rose-200 px-2.5 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-50 sm:self-auto">Revoke</button>
            </div>
          </div>
          <p class="mt-3 text-[10px] leading-relaxed text-neutral-500">Legacy VM fallback: <code>OMNI_CHANNEL_API_KEY</code>. Use it only until a database credential is created and distributed to the connector.</p>
        </div>

        <div class="mt-5 space-y-3">
          <div *ngFor="let sample of apiSamples" class="rounded-xl border border-neutral-100 bg-[#fbfbfb] p-3">
            <div class="mb-2 flex items-center justify-between gap-3">
              <p class="text-xs font-semibold text-neutral-900">{{ sample.label }}</p>
              <button type="button" (click)="copySample(sample.value)" class="rounded-md border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-50">Copy curl</button>
            </div>
            <pre class="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-neutral-700">{{ sample.value }}</pre>
          </div>
        </div>
      </section>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        <!-- Left Column: Channel & Domains -->
        <div class="space-y-6">
          
          <!-- Public Chat Channel Configuration -->
          <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
            <h3 class="text-sm font-semibold text-neutral-900">Public Web Chat Channel</h3>
            <p class="mt-1 text-xs text-neutral-500">
              Browser sessions are accepted strictly from this exact HTTP(S) origin when enabled. Direct client calls to AI or n8n are forbidden.
            </p>

            <form (ngSubmit)="saveChannel()" class="mt-4 space-y-4">
              <div>
                <label class="block text-xs font-semibold text-neutral-800">Public Web Origin</label>
                <input
                  [(ngModel)]="channel.publicOrigin"
                  name="publicOrigin"
                  type="url"
                  placeholder="https://chat.acme.com"
                  class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <div class="flex items-center justify-between rounded-xl border border-neutral-100 bg-neutral-50/60 p-3.5">
                <div>
                  <span class="text-xs font-semibold text-neutral-900">Enable Public Chat</span>
                  <p class="text-[11px] text-neutral-500">Allow visitor sessions from the authorized origin.</p>
                </div>
                <label class="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    [(ngModel)]="channel.publicChatEnabled"
                    name="publicChatEnabled"
                    class="sr-only peer"
                  />
                  <div class="w-9 h-5 bg-neutral-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-neutral-900"></div>
                </label>
              </div>

              <button
                type="submit"
                class="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 transition-all button-press"
              >
                Save Channel Policy
              </button>
            </form>
          </section>

          <!-- Allowed Chat Domains -->
          <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-semibold text-neutral-900">Allowed Chat Domains</h3>
                <p class="mt-1 text-xs text-neutral-500">CORS domain allowlist for embedded chat widget.</p>
              </div>
              <span class="font-mono text-xs text-neutral-400">{{ domains.length }} domains</span>
            </div>

            <!-- Add Domain Form -->
            <form (ngSubmit)="addDomain()" class="mt-4 flex gap-2">
              <input
                [(ngModel)]="newHostname"
                name="newHostname"
                required
                placeholder="portal.acme.global"
                class="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-mono text-neutral-900 focus:border-neutral-900 focus:outline-none"
              />
              <button
                type="submit"
                [disabled]="!newHostname"
                class="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-40 transition-all button-press"
              >
                Add Domain
              </button>
            </form>

            <!-- Domain List -->
            <div class="mt-4 space-y-2">
              <div
                *ngFor="let d of domains"
                class="flex items-center justify-between rounded-xl border border-neutral-100 bg-[#fbfbfb] p-3 text-xs"
              >
                <div class="flex items-center gap-2">
                  <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span class="font-mono text-neutral-800">{{ d.hostname }}</span>
                  <span *ngIf="d.verified" class="text-[10px] text-emerald-600 font-medium">Verified</span>
                </div>
                <button
                  type="button"
                  (click)="removeDomain(d)"
                  class="text-[11px] text-neutral-400 hover:text-rose-600 transition-colors"
                >
                  Remove
                </button>
              </div>
            </div>
          </section>

        </div>

        <!-- Right Column: Members & Retention Purge -->
        <div class="space-y-6">
          
          <!-- Tenant Team & Member Roles -->
          <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
            <h3 class="text-sm font-semibold text-neutral-900">Team Members & Access Roles</h3>
            <p class="mt-1 text-xs text-neutral-500">
              Role-based access control for tenant administration, source staging, and audit review.
            </p>

            <!-- Add Member Form -->
            <form (ngSubmit)="addMember()" class="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                [(ngModel)]="newEmail"
                name="newEmail"
                type="email"
                required
                placeholder="colleague@acme.com"
                class="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
              />
              <input
                [(ngModel)]="newPassword"
                name="newPassword"
                type="password"
                required
                placeholder="Temp password"
                class="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
              />
              <select
                [(ngModel)]="newRole"
                name="newRole"
                class="rounded-lg border border-neutral-200 px-2 py-1.5 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
              >
                <option value="tenant_editor">Knowledge Editor</option>
                <option value="tenant_viewer">Compliance Viewer</option>
                <option value="tenant_agent">Customer Agent</option>
              </select>

              <button
                type="submit"
                [disabled]="!newEmail || !newPassword"
                class="sm:col-span-3 rounded-lg bg-neutral-900 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-40 transition-all button-press"
              >
                + Invite Member
              </button>
            </form>

            <!-- Member List -->
            <div class="mt-4 space-y-2">
              <div
                *ngFor="let m of members"
                class="flex items-center justify-between rounded-xl border border-neutral-100 bg-[#fbfbfb] p-3 text-xs"
              >
                <div>
                  <p class="font-medium text-neutral-900">{{ m.email }}</p>
                  <p class="text-[10px] text-neutral-400 font-mono">{{ m.lastLoginAt || 'Recent' }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <span class="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-mono text-neutral-700">
                    {{ m.role.replace('tenant_', '') }}
                  </span>
                </div>
              </div>
            </div>
          </section>

          <!-- Ephemeral Data Retention & 24hr Session Purge -->
          <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
            <div class="flex items-center gap-2">
              <app-icon name="trash" classNames="w-4 h-4 text-rose-600"></app-icon>
              <h3 class="text-sm font-semibold text-neutral-900">Data Retention & Hard Purge</h3>
            </div>
            <p class="mt-1 text-xs text-neutral-500 leading-relaxed">
              In accordance with enterprise privacy invariants, customer chat conversation records older than 24 hours are deleted from storage. Reversible token mappings are discarded.
            </p>

            <div class="mt-4 rounded-xl border border-neutral-100 bg-neutral-50/70 p-4 flex items-center justify-between">
              <div>
                <span class="text-xs font-semibold text-neutral-900">Session Retention Rule</span>
                <p class="text-[11px] text-neutral-500 font-mono">Cutoff: 24 Hours</p>
              </div>

              <button
                type="button"
                (click)="purgeExpiredSessions()"
                class="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50 transition-colors button-press"
              >
                Purge Expired Sessions Now
              </button>
            </div>
          </section>

        </div>

      </div>

    </div>
  `
})
export class SettingsViewComponent implements OnInit {
  private readonly state = inject(AdminStateService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly apiBase = inject(API_BASE_URL);

  channel: Channel = { publicOrigin: null, publicChatEnabled: false };
  selectedTenant: Tenant | null = null;
  domains: TenantDomain[] = [];
  members: Member[] = [];
  connectorCredentials: ChannelCredential[] = [];

  newHostname = '';
  newEmail = '';
  newPassword = '';
  newRole: MemberRole = 'tenant_editor';
  newConnectorChannel = 'omnichannel-api';
  oneTimeConnectorSecret = '';

  get apiBaseUrl(): string {
    return this.apiBase;
  }

  get apiSamples(): Array<{ label: string; value: string }> {
    const base = this.apiBase.replace(/\/$/, '');
    return [
      { label: 'Health', value: `curl -sS ${base}/api/v1/health/live` },
      { label: 'Tenant configuration', value: `curl -sS ${base}/api/v1/chat/config \\\n  -H "X-Agentic-Api-Key: $CHANNEL_API_KEY"` },
      { label: 'Create session', value: `curl -sS -X POST ${base}/api/v1/chat/sessions \\\n  -H "X-Agentic-Api-Key: $CHANNEL_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  --data '{}'` },
      { label: 'Send conversation message', value: `SESSION_ID='paste-session-id'\n\ncurl -sS -X POST ${base}/api/v1/chat/messages \\\n  -H "X-Agentic-Api-Key: $CHANNEL_API_KEY" \\\n  -H 'Content-Type: application/json' \\\n  --data "{\\"sessionId\\":\\"$SESSION_ID\\",\\"message\\":\\"Hello\\",\\"clientMessageId\\":\\"$(cat /proc/sys/kernel/random/uuid)\\"}"` }
    ];
  }

  constructor() {
    this.state.channel$.subscribe((c) => {
      this.channel = { ...c };
      this.cdr.markForCheck();
    });
    this.state.selectedTenant$.subscribe((tenant) => {
      this.selectedTenant = tenant;
      this.cdr.markForCheck();
    });
    this.state.domains$.subscribe((d) => {
      this.domains = d;
      this.cdr.markForCheck();
    });
    this.state.members$.subscribe((m) => {
      this.members = m;
      this.cdr.markForCheck();
    });
    this.state.channelCredentials$.subscribe((credentials) => {
      this.connectorCredentials = credentials;
      this.cdr.markForCheck();
    });
  }

  ngOnInit(): void {
    this.state.loadChannel();
    this.state.loadDomains();
    this.state.loadMembers();
    this.state.loadChannelCredentials();
  }

  copySample(value: string): void {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    void navigator.clipboard.writeText(value);
    this.state.showToast('success', 'Curl Copied', 'The connector example is ready to paste into a server terminal.');
  }

  saveChannel(): void {
    this.state.settings.saveChannel(this.channel);
  }

  addDomain(): void {
    if (!this.newHostname.trim()) return;
    this.state.settings.addDomain(this.newHostname);
    this.newHostname = '';
  }

  removeDomain(d: TenantDomain): void {
    this.state.settings.removeDomain(d);
  }

  addMember(): void {
    if (!this.newEmail || !this.newPassword) return;
    this.state.settings.addMember(this.newEmail, this.newPassword, this.newRole);
    this.newEmail = '';
    this.newPassword = '';
  }

  createConnectorCredential(): void {
    const channel = this.newConnectorChannel.trim().toLowerCase();
    if (!channel) return;
    this.state.settings.createChannelCredential(channel, 'api_key', (secret) => {
      this.oneTimeConnectorSecret = secret;
      this.cdr.markForCheck();
    });
  }

  revokeConnectorCredential(credential: ChannelCredential): void {
    if (window.confirm(`Revoke the ${credential.channel} connector credential?`)) {
      this.state.settings.revokeChannelCredential(credential);
    }
  }

  purgeExpiredSessions(): void {
    if (window.confirm('Execute cryptographic purge of chat sessions older than 24 hours? This action is permanent.')) {
      this.state.settings.purgeExpiredSessions();
    }
  }
}

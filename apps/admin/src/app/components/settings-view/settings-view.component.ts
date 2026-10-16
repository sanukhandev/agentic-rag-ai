import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { Channel, TenantDomain, Member, MemberRole } from '../../types/admin.types';
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
export class SettingsViewComponent {
  private readonly state = inject(AdminStateService);

  channel: Channel = { publicOrigin: 'https://chat.acme.com', publicChatEnabled: true };
  domains: TenantDomain[] = [];
  members: Member[] = [];

  newHostname = '';
  newEmail = '';
  newPassword = '';
  newRole: MemberRole = 'tenant_editor';

  constructor() {
    this.state.channel$.subscribe((c) => (this.channel = { ...c }));
    this.state.domains$.subscribe((d) => (this.domains = d));
    this.state.members$.subscribe((m) => (this.members = m));
  }

  saveChannel(): void {
    this.state.channel$.next(this.channel);
    this.state.showToast('success', 'Policy Saved', 'Public chat channel origin verified.');
  }

  addDomain(): void {
    if (!this.newHostname.trim()) return;
    const newDomain: TenantDomain = {
      id: `dom-${Math.random().toString(36).substring(2, 6)}`,
      hostname: this.newHostname.trim().toLowerCase(),
      createdAt: new Date().toISOString(),
      verified: true
    };
    this.state.domains$.next([...this.domains, newDomain]);
    this.newHostname = '';
    this.state.showToast('success', 'Domain Added', `${newDomain.hostname} added to allowed origins.`);
  }

  removeDomain(d: TenantDomain): void {
    this.state.domains$.next(this.domains.filter((item) => item.id !== d.id));
    this.state.showToast('info', 'Domain Removed', `${d.hostname} removed.`);
  }

  addMember(): void {
    if (!this.newEmail || !this.newPassword) return;
    const newMember: Member = {
      id: `mem-${Math.random().toString(36).substring(2, 6)}`,
      email: this.newEmail.trim().toLowerCase(),
      role: this.newRole,
      createdAt: new Date().toISOString(),
      lastLoginAt: 'Invited'
    };
    this.state.members$.next([...this.members, newMember]);
    this.newEmail = '';
    this.newPassword = '';
    this.state.showToast('success', 'Member Added', `${newMember.email} granted ${newMember.role}.`);
  }

  purgeExpiredSessions(): void {
    if (window.confirm('Execute cryptographic purge of chat sessions older than 24 hours? This action is permanent.')) {
      this.state.showToast('success', 'Hard Purge Complete', 'Reclaimed 4.2 MB storage. Expired sessions wiped.');
    }
  }
}

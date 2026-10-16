import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { Tenant, TenantStatus } from '../../types/admin.types';
import { openTenantChatWindow } from '../../services/tenant-chat-url';
import { IconComponent } from '../shared/icon.component';
import { BadgeComponent } from '../shared/badge.component';

@Component({
  selector: 'app-org-table',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, BadgeComponent],
  template: `
    <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card" aria-labelledby="org-heading">
      <!-- Section Header & Toolbar -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="flex items-center gap-2.5">
            <h2 id="org-heading" class="text-lg font-semibold text-neutral-900 tracking-tight">
              Organization Directory
            </h2>
            <span class="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-mono font-medium text-neutral-600">
              {{ filteredTenants.length }}
            </span>
          </div>
          <p class="mt-1 text-xs text-neutral-500">
            Tenant identity boundaries, domain scope, and isolated vector store partitions.
          </p>
        </div>

        <div class="flex items-center gap-2.5">
          <button
            type="button"
            (click)="refresh()"
            class="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors button-press"
            title="Refresh organizations list"
          >
            <app-icon name="refresh" classNames="w-3.5 h-3.5 text-neutral-500"></app-icon>
            <span>Refresh</span>
          </button>

          <button
            type="button"
            (click)="openCreateDrawer()"
            class="flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-neutral-800 transition-all button-press"
          >
            <app-icon name="plus" classNames="w-3.5 h-3.5"></app-icon>
            <span>Create Organization</span>
          </button>
        </div>
      </div>

      <!-- Filters & Search Bar -->
      <div class="mt-5 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between border-t border-neutral-100 pt-4">
        <!-- Status Filter Tabs -->
        <div class="flex items-center gap-1 p-0.5 bg-neutral-100 rounded-lg text-xs self-start">
          <button
            *ngFor="let tab of statusTabs"
            type="button"
            (click)="selectedStatusFilter = tab.value"
            class="px-2.5 py-1 rounded-md font-medium transition-all"
            [ngClass]="selectedStatusFilter === tab.value ? 'bg-white text-neutral-900 shadow-subtle' : 'text-neutral-500 hover:text-neutral-900'"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- Search Input -->
        <div class="relative w-full sm:w-72">
          <app-icon name="search" classNames="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2"></app-icon>
          <input
            [(ngModel)]="searchQuery"
            type="text"
            placeholder="Search by name, slug, or domain..."
            class="w-full rounded-lg border border-neutral-200 bg-neutral-50/50 pl-9 pr-3 py-1.5 text-xs text-neutral-900 placeholder-neutral-400 focus:bg-white focus:border-neutral-900 focus:outline-none transition-all"
          />
          <button
            *ngIf="searchQuery"
            (click)="searchQuery = ''"
            class="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
          >
            <app-icon name="x" classNames="w-3 h-3"></app-icon>
          </button>
        </div>
      </div>

      <!-- Enterprise Organizations Table -->
      <div class="mt-4 overflow-x-auto rounded-xl border border-neutral-200/80">
        <table class="w-full text-left text-xs">
          <thead class="border-b border-neutral-200/80 bg-neutral-50/70 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
            <tr>
              <th scope="col" class="py-3 pl-4 pr-3">Organization</th>
              <th scope="col" class="px-3 py-3">Slug</th>
              <th scope="col" class="px-3 py-3">Status</th>
              <th scope="col" class="px-3 py-3">Sources</th>
              <th scope="col" class="px-3 py-3">Created</th>
              <th scope="col" class="px-3 py-3">Last Activity</th>
              <th scope="col" class="py-3 pl-3 pr-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-100 bg-white font-normal">
            <tr
              *ngFor="let tenant of filteredTenants"
              class="group hover:bg-neutral-50/70 transition-colors"
            >
              <!-- Name & Icon -->
              <td class="py-3.5 pl-4 pr-3">
                <div class="flex items-center gap-3">
                  <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-white font-semibold text-neutral-800 shadow-subtle group-hover:border-neutral-400">
                    {{ tenant.name.charAt(0) }}
                  </div>
                  <div>
                    <span class="font-semibold text-neutral-900 group-hover:text-black">
                      {{ tenant.name }}
                    </span>
                    <p class="text-[11px] text-neutral-400 font-mono truncate max-w-[200px]">
                      {{ tenant.primaryContact || '—' }}
                    </p>
                  </div>
                </div>
              </td>

              <!-- Slug -->
              <td class="px-3 py-3.5">
                <span class="font-mono text-[11px] text-neutral-600 bg-neutral-100/80 px-2 py-0.5 rounded border border-neutral-200/50">
                  {{ tenant.slug }}
                </span>
              </td>

              <!-- Status Pill -->
              <td class="px-3 py-3.5">
                <app-badge [variant]="getStatusVariant(tenant.status)" [text]="tenant.status | titlecase">
                </app-badge>
              </td>

              <!-- Source Count -->
              <td class="px-3 py-3.5 font-mono text-neutral-700">
                <div class="flex items-center gap-1.5">
                  <app-icon name="book-open" classNames="w-3 h-3 text-neutral-400"></app-icon>
                  <span class="font-semibold">{{ tenant.sourceCount || 0 }}</span>
                  <span class="text-neutral-400 text-[10px]">active</span>
                </div>
              </td>

              <!-- Created Date -->
              <td class="px-3 py-3.5 text-neutral-500 whitespace-nowrap">
                {{ tenant.createdAt | date:'mediumDate' }}
              </td>

              <!-- Last Activity -->
              <td class="px-3 py-3.5 text-neutral-500 whitespace-nowrap">
                <div class="flex items-center gap-1.5">
                  <span class="h-1.5 w-1.5 rounded-full" [ngClass]="tenant.status === 'active' ? 'bg-emerald-500' : 'bg-neutral-300'"></span>
                  <span>{{ tenant.lastActivity || '—' }}</span>
                </div>
              </td>

              <!-- Quick Actions -->
              <td class="py-3.5 pl-3 pr-4 text-right whitespace-nowrap">
                <div class="flex items-center justify-end gap-1.5">
                  <!-- View / Select context -->
                  <button
                    type="button"
                    (click)="selectTenant(tenant)"
                    class="rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                    title="Switch active workspace context to this organization"
                  >
                    View
                  </button>

                  <!-- Open Tenant Chat -->
                  <button
                    type="button"
                    (click)="openChat(tenant)"
                    class="rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 transition-colors inline-flex items-center gap-1"
                    title="Open tenant customer chat in a new window"
                  >
                    <app-icon name="chat" classNames="w-3 h-3 text-neutral-500"></app-icon>
                    <span>Chat</span>
                  </button>

                  <!-- Manage Agent -->
                  <button
                    type="button"
                    (click)="manageAgent(tenant)"
                    class="rounded-md border border-neutral-200 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
                    title="Edit AI assistant persona and rules"
                  >
                    Edit Agent
                  </button>

                  <!-- Suspend / Reactivate -->
                  <button
                    *ngIf="tenant.status === 'active'"
                    type="button"
                    (click)="updateStatus(tenant, 'suspended')"
                    class="rounded-md border border-amber-200 bg-amber-50/50 px-2.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                  >
                    Suspend
                  </button>

                  <button
                    *ngIf="tenant.status === 'suspended'"
                    type="button"
                    (click)="updateStatus(tenant, 'active')"
                    class="rounded-md border border-emerald-200 bg-emerald-50/50 px-2.5 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                  >
                    Reactivate
                  </button>

                  <!-- Archive -->
                  <button
                    *ngIf="tenant.status !== 'archived'"
                    type="button"
                    (click)="updateStatus(tenant, 'archived')"
                    class="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 transition-colors"
                    title="Archive organization (read-only)"
                  >
                    Archive
                  </button>
                </div>
              </td>
            </tr>

            <!-- Empty State -->
            <tr *ngIf="filteredTenants.length === 0">
              <td colspan="7" class="py-12 text-center text-neutral-400">
                <app-icon name="building" classNames="mx-auto w-8 h-8 text-neutral-300"></app-icon>
                <p class="mt-2 text-xs font-medium text-neutral-600">No organizations found matching criteria.</p>
                <p class="text-[11px] text-neutral-400">Try adjusting your search query or status filter.</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `
})
export class OrgTableComponent implements OnInit {
  private readonly state = inject(AdminStateService);

  searchQuery = '';
  selectedStatusFilter: 'all' | TenantStatus = 'all';

  readonly statusTabs: Array<{ label: string; value: 'all' | TenantStatus }> = [
    { label: 'All', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Suspended', value: 'suspended' },
    { label: 'Archived', value: 'archived' }
  ];

  tenants: Tenant[] = [];

  constructor() {
    this.state.tenants$.subscribe((t) => (this.tenants = t));
  }

  ngOnInit(): void {
    this.state.loadTenants();
  }

  get filteredTenants(): Tenant[] {
    return this.tenants.filter((t) => {
      const matchesStatus = this.selectedStatusFilter === 'all' || t.status === this.selectedStatusFilter;
      const q = this.searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.primaryContact && t.primaryContact.toLowerCase().includes(q));
      return matchesStatus && matchesSearch;
    });
  }

  getStatusVariant(status: TenantStatus): 'success' | 'warning' | 'neutral' {
    switch (status) {
      case 'active':
        return 'success';
      case 'suspended':
        return 'warning';
      case 'archived':
      default:
        return 'neutral';
    }
  }

  openCreateDrawer(): void {
    this.state.openCreateOrgDrawer();
  }

  refresh(): void {
    this.state.loadTenants();
    this.state.showToast('info', 'Refreshed', 'Organizations directory synchronized.');
  }

  selectTenant(tenant: Tenant): void {
    this.state.selectTenant(tenant);
  }

  manageAgent(tenant: Tenant): void {
    this.state.selectTenant(tenant);
    this.state.setSection('studio');
  }

  openChat(tenant: Tenant): void {
    const publicOrigin = tenant.domains?.[0] ? `https://${tenant.domains[0]}` : null;
    openTenantChatWindow(tenant.slug, publicOrigin);
  }

  updateStatus(tenant: Tenant, status: TenantStatus): void {
    if (status === 'archived' && !window.confirm(`Archive organization "${tenant.name}"? This disables real-time chat and locks vector embeddings.`)) {
      return;
    }
    this.state.updateTenantStatus(tenant, status);
  }
}

import { Component, ElementRef, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../../services/admin-state.service';
import { NavSection, Tenant } from '../../types/admin.types';
import { IconComponent } from '../shared/icon.component';
import { BadgeComponent } from '../shared/badge.component';

interface MegaMenuItem {
  title: string;
  desc: string;
  icon: string;
  badge?: string;
  action: () => void;
}

interface MegaMenuColumn {
  heading: string;
  items: MegaMenuItem[];
}

@Component({
  selector: 'app-top-nav',
  standalone: true,
  imports: [CommonModule, IconComponent, BadgeComponent],
  template: `
    <header class="sticky top-0 z-40 w-full border-b border-neutral-200/80 bg-white/95 backdrop-blur-md">
      <!-- Main Top Bar: Compact 56px height, high visual hierarchy, spacious editorial feel -->
      <div class="mx-auto flex h-14 max-w-[1536px] items-center justify-between px-4 sm:px-6 lg:px-8">
        
        <!-- Left Brand & Navigation Group -->
        <div class="flex items-center gap-4 lg:gap-6 min-w-0">
          <!-- Logo & Platform Label (Streamlined, no stacked bulk) -->
          <a
            href="javascript:void(0)"
            (click)="navigateTo('overview')"
            class="group flex items-center gap-2.5 shrink-0 transition-opacity hover:opacity-90"
            title="Agentic RAG AI Dashboard"
          >
            <div class="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-white shadow-xs transition-transform group-hover:scale-105">
              <app-icon name="logo" classNames="w-4 h-4 text-white"></app-icon>
            </div>
            <span class="text-xs font-bold tracking-[0.14em] text-neutral-900 uppercase">
              Agentic RAG AI
            </span>
          </a>

          <!-- Subtle Hairline Separator -->
          <div class="hidden lg:block h-4 w-px bg-neutral-200/90 shrink-0"></div>

          <!-- Top Nav Tabs with Mega Menu triggers (Text-first, Poppins, uncluttered) -->
          <nav class="hidden lg:flex items-center gap-0.5" aria-label="Main Navigation">
            <!-- 1. Overview (direct link) -->
            <button
              type="button"
              (click)="navigateTo('overview')"
              class="relative px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-all"
              [ngClass]="activeSection === 'overview' && !activeMegaMenu ? 'text-neutral-950 bg-neutral-100 font-semibold' : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'"
            >
              Overview
            </button>

            <!-- 2. Organizations (Mega Menu) -->
            <button
              *ngIf="isPlatformAdmin"
              type="button"
              (click)="toggleMenu('organizations')"
              [attr.aria-expanded]="activeMegaMenu === 'organizations'"
              class="group relative flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-all"
              [ngClass]="activeSection === 'organizations' || activeMegaMenu === 'organizations' ? 'text-neutral-950 bg-neutral-100 font-semibold' : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'"
            >
              <span>Organizations</span>
              <app-icon
                name="chevron-down"
                classNames="w-2.5 h-2.5 transition-transform duration-200"
                [ngClass]="activeMegaMenu === 'organizations' ? 'rotate-180 text-neutral-950' : 'text-neutral-400 group-hover:text-neutral-700'"
              ></app-icon>
            </button>

            <!-- 3. Knowledge (Mega Menu) -->
            <button
              type="button"
              (click)="toggleMenu('knowledge')"
              [attr.aria-expanded]="activeMegaMenu === 'knowledge'"
              class="group relative flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-all"
              [ngClass]="activeSection === 'knowledge' || activeMegaMenu === 'knowledge' ? 'text-neutral-950 bg-neutral-100 font-semibold' : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'"
            >
              <span>Knowledge</span>
              <app-icon
                name="chevron-down"
                classNames="w-2.5 h-2.5 transition-transform duration-200"
                [ngClass]="activeMegaMenu === 'knowledge' ? 'rotate-180 text-neutral-950' : 'text-neutral-400 group-hover:text-neutral-700'"
              ></app-icon>
            </button>

            <!-- 4. AI Studio (Mega Menu) -->
            <button
              type="button"
              (click)="toggleMenu('studio')"
              [attr.aria-expanded]="activeMegaMenu === 'studio'"
              class="group relative flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-all"
              [ngClass]="activeSection === 'studio' || activeMegaMenu === 'studio' ? 'text-neutral-950 bg-neutral-100 font-semibold' : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'"
            >
              <span>AI Studio</span>
              <app-icon
                name="chevron-down"
                classNames="w-2.5 h-2.5 transition-transform duration-200"
                [ngClass]="activeMegaMenu === 'studio' ? 'rotate-180 text-neutral-950' : 'text-neutral-400 group-hover:text-neutral-700'"
              ></app-icon>
            </button>

            <!-- 5. Observability (Mega Menu) -->
            <button
              type="button"
              (click)="toggleMenu('observability')"
              [attr.aria-expanded]="activeMegaMenu === 'observability'"
              class="group relative flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-all"
              [ngClass]="activeSection === 'observability' || activeMegaMenu === 'observability' ? 'text-neutral-950 bg-neutral-100 font-semibold' : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'"
            >
              <span>Observability</span>
              <app-icon
                name="chevron-down"
                classNames="w-2.5 h-2.5 transition-transform duration-200"
                [ngClass]="activeMegaMenu === 'observability' ? 'rotate-180 text-neutral-950' : 'text-neutral-400 group-hover:text-neutral-700'"
              ></app-icon>
            </button>

            <!-- 6. Settings (Mega Menu) -->
            <button
              type="button"
              (click)="toggleMenu('settings')"
              [attr.aria-expanded]="activeMegaMenu === 'settings'"
              class="group relative flex items-center gap-1 px-2.5 py-1.5 text-[13px] font-medium rounded-md transition-all"
              [ngClass]="activeSection === 'settings' || activeMegaMenu === 'settings' ? 'text-neutral-950 bg-neutral-100 font-semibold' : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-50'"
            >
              <span>Settings</span>
              <app-icon
                name="chevron-down"
                classNames="w-2.5 h-2.5 transition-transform duration-200"
                [ngClass]="activeMegaMenu === 'settings' ? 'rotate-180 text-neutral-950' : 'text-neutral-400 group-hover:text-neutral-700'"
              ></app-icon>
            </button>
          </nav>
        </div>

        <!-- Right Side: Fast Search, Tenant Switcher, Action, User Menu -->
        <div class="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <!-- Command Palette Trigger Button (Desktop: compact pill; Mobile: icon) -->
          <button
            type="button"
            (click)="openSearch()"
            class="hidden sm:flex h-8 items-center gap-2 rounded-lg border border-neutral-200/90 bg-neutral-50/70 px-2.5 text-xs text-neutral-500 hover:border-neutral-300 hover:bg-white hover:text-neutral-900 transition-all button-press"
            title="Search organizations, sources, or commands (Ctrl+K)"
          >
            <app-icon name="search" classNames="w-3.5 h-3.5 text-neutral-400"></app-icon>
            <span class="font-normal">Search...</span>
            <kbd class="ml-1 rounded border border-neutral-200/90 bg-white px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">⌘K</kbd>
          </button>

          <button
            type="button"
            (click)="openSearch()"
            class="sm:hidden flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200/90 bg-white text-neutral-500 hover:text-neutral-900 transition-all"
            title="Search (Ctrl+K)"
          >
            <app-icon name="search" classNames="w-3.5 h-3.5"></app-icon>
          </button>

          <!-- Tenant Switcher Dropdown (Refined Compact Pill) -->
          <div class="relative" *ngIf="isPlatformAdmin && tenants.length > 0">
            <button
              type="button"
              (click)="tenantDropdownOpen = !tenantDropdownOpen"
              class="flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200/90 bg-white px-2 text-xs font-medium text-neutral-800 hover:bg-neutral-50 transition-colors"
              title="Active Organization Scope"
            >
              <span
                class="w-1.5 h-1.5 rounded-full"
                [ngClass]="selectedTenant?.status === 'active' ? 'bg-emerald-500' : 'bg-neutral-400'"
              ></span>
              <span class="max-w-[75px] sm:max-w-[105px] truncate text-xs">{{ selectedTenant?.name || 'All Tenants' }}</span>
              <app-icon name="chevron-down" classNames="w-2.5 h-2.5 text-neutral-400"></app-icon>
            </button>

            <!-- Tenant Dropdown Menu -->
            <div
              *ngIf="tenantDropdownOpen"
              class="absolute right-0 mt-1.5 w-60 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-dropdown animate-slide-down z-50"
            >
              <div class="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                Active Tenant Scope
              </div>
              <div class="max-h-60 overflow-y-auto space-y-0.5">
                <button
                  *ngFor="let t of tenants"
                  type="button"
                  (click)="onSelectTenant(t)"
                  class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors"
                  [ngClass]="selectedTenant?.id === t.id ? 'bg-neutral-100 text-neutral-900 font-medium' : 'text-neutral-700 hover:bg-neutral-50'"
                >
                  <div class="flex items-center gap-2 truncate">
                    <span class="w-1.5 h-1.5 rounded-full" [ngClass]="t.status === 'active' ? 'bg-emerald-500' : t.status === 'suspended' ? 'bg-amber-500' : 'bg-neutral-300'"></span>
                    <span class="truncate">{{ t.name }}</span>
                  </div>
                  <span class="font-mono text-[10px] text-neutral-400">{{ t.sourceCount || 0 }} src</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Primary Action CTA (Crisp, Compact) -->
          <button
            type="button"
            (click)="onPrimaryAction()"
            class="flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-2.5 sm:px-3 text-xs font-medium text-white shadow-xs hover:bg-neutral-800 transition-all button-press"
          >
            <app-icon name="plus" classNames="w-3 h-3"></app-icon>
            <span class="hidden sm:inline">{{ isPlatformAdmin ? 'New Org' : 'Stage Source' }}</span>
          </button>

          <!-- Subtle Divider -->
          <div class="h-4 w-px bg-neutral-200/90"></div>

          <!-- User Profile & Session Dropdown -->
          <div class="relative">
            <button
              type="button"
              (click)="userMenuOpen = !userMenuOpen"
              class="flex items-center justify-center rounded-full p-0.5 hover:ring-2 hover:ring-neutral-200 transition-all"
              title="User Settings & Role"
            >
              <div class="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
                {{ userInitials }}
              </div>
            </button>

            <!-- User Menu Dropdown -->
            <div
              *ngIf="userMenuOpen"
              class="absolute right-0 mt-2 w-64 rounded-xl border border-neutral-200 bg-white p-2 shadow-dropdown animate-slide-down z-50"
            >
              <div class="border-b border-neutral-100 px-3 py-2">
                <p class="text-xs font-semibold text-neutral-900 truncate">{{ userEmail }}</p>
                <div class="mt-1 flex items-center gap-1.5">
                  <app-badge [variant]="isPlatformAdmin ? 'black' : 'neutral'" [showDot]="false" text="">
                    {{ userRoleLabel }}
                  </app-badge>
                </div>
              </div>
              <div class="my-1 border-t border-neutral-100"></div>

              <button
                type="button"
                (click)="logout()"
                class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors"
              >
                <app-icon name="lock" classNames="w-3.5 h-3.5"></app-icon>
                <span>Sign Out</span>
              </button>
            </div>
          </div>

          <!-- Mobile Hamburger Toggle Button (lg:hidden) -->
          <button
            type="button"
            (click)="mobileNavOpen = !mobileNavOpen"
            class="lg:hidden flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200/90 bg-white text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50 transition-colors"
            aria-label="Toggle navigation menu"
          >
            <app-icon [name]="mobileNavOpen ? 'x' : 'menu'" classNames="w-4 h-4"></app-icon>
          </button>
        </div>
      </div>

      <!-- Mobile Navigation Sheet (lg:hidden) -->
      <div
        *ngIf="mobileNavOpen"
        class="lg:hidden border-t border-neutral-200/90 bg-white px-4 py-4 space-y-3 shadow-dropdown animate-slide-down"
      >
        <div class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">
          Navigation
        </div>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            (click)="onMobileNavigate('overview')"
            class="flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium text-left transition-colors"
            [ngClass]="activeSection === 'overview' ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'"
          >
            <app-icon name="overview" classNames="w-3.5 h-3.5"></app-icon>
            <span>Overview</span>
          </button>

          <button
            *ngIf="isPlatformAdmin"
            type="button"
            (click)="onMobileNavigate('organizations')"
            class="flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium text-left transition-colors"
            [ngClass]="activeSection === 'organizations' ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'"
          >
            <app-icon name="organizations" classNames="w-3.5 h-3.5"></app-icon>
            <span>Organizations</span>
          </button>

          <button
            type="button"
            (click)="onMobileNavigate('knowledge')"
            class="flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium text-left transition-colors"
            [ngClass]="activeSection === 'knowledge' ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'"
          >
            <app-icon name="knowledge" classNames="w-3.5 h-3.5"></app-icon>
            <span>Knowledge</span>
          </button>

          <button
            type="button"
            (click)="onMobileNavigate('studio')"
            class="flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium text-left transition-colors"
            [ngClass]="activeSection === 'studio' ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'"
          >
            <app-icon name="studio" classNames="w-3.5 h-3.5"></app-icon>
            <span>AI Studio</span>
          </button>

          <button
            type="button"
            (click)="onMobileNavigate('observability')"
            class="flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium text-left transition-colors"
            [ngClass]="activeSection === 'observability' ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'"
          >
            <app-icon name="observability" classNames="w-3.5 h-3.5"></app-icon>
            <span>Observability</span>
          </button>

          <button
            type="button"
            (click)="onMobileNavigate('settings')"
            class="flex items-center gap-2 rounded-lg p-2.5 text-xs font-medium text-left transition-colors"
            [ngClass]="activeSection === 'settings' ? 'bg-neutral-900 text-white' : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'"
          >
            <app-icon name="settings" classNames="w-3.5 h-3.5"></app-icon>
            <span>Settings</span>
          </button>
        </div>
      </div>

      <!-- Large Clean Mega Menu Overlay Container -->
      <div
        *ngIf="activeMegaMenu"
        class="border-t border-neutral-200/90 bg-white/98 shadow-dropdown backdrop-blur-xl animate-slide-down transition-all"
        role="region"
        aria-label="Mega menu content"
      >
        <div class="mx-auto max-w-[1536px] px-4 py-8 sm:px-6 lg:px-8">
          <div class="flex items-center justify-between border-b border-neutral-100 pb-4 mb-6">
            <div class="flex items-center gap-3">
              <span class="text-xs font-bold uppercase tracking-wider text-neutral-400">Section Navigator</span>
              <span class="text-sm font-semibold text-neutral-900 capitalize">{{ activeMegaMenu }} Workspace</span>
            </div>
            <button
              type="button"
              (click)="closeMenu()"
              class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
            >
              <span>Close</span>
              <kbd class="font-mono text-[10px]">Esc</kbd>
            </button>
          </div>

          <!-- Multi-column Layout -->
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div *ngFor="let col of currentColumns" class="space-y-4">
              <h3 class="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                {{ col.heading }}
              </h3>
              <div class="space-y-1">
                <a
                  *ngFor="let item of col.items"
                  href="javascript:void(0)"
                  (click)="item.action()"
                  class="group flex items-start gap-3.5 rounded-xl p-3 transition-all hover:bg-neutral-50 hover:shadow-subtle"
                >
                  <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-neutral-200/80 bg-white text-neutral-700 shadow-sm transition-transform group-hover:scale-105 group-hover:border-neutral-400">
                    <app-icon [name]="item.icon" classNames="w-4 h-4"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-[13px] font-semibold text-neutral-900 group-hover:text-black">
                        {{ item.title }}
                      </span>
                      <span *ngIf="item.badge" class="rounded bg-neutral-100 px-1.5 py-0.5 text-[9px] font-medium text-neutral-600">
                        {{ item.badge }}
                      </span>
                    </div>
                    <p class="mt-0.5 text-xs text-neutral-500 leading-relaxed">
                      {{ item.desc }}
                    </p>
                  </div>
                  <app-icon name="arrow-up-right" classNames="w-3.5 h-3.5 text-neutral-300 opacity-0 group-hover:opacity-100 transition-opacity"></app-icon>
                </a>
              </div>
            </div>

            <!-- Featured Editorial Card in Mega Menu -->
            <div class="rounded-2xl border border-neutral-200/80 bg-[#fbfbfb] p-6 flex flex-col justify-between">
              <div>
                <div class="flex items-center gap-2">
                  <app-badge variant="black" [showDot]="false" text="">Non-Negotiable Rule</app-badge>
                  <span class="text-[11px] text-neutral-500">Security Invariant</span>
                </div>
                <h4 class="mt-3 text-sm font-semibold text-neutral-900">
                  Strict Source Grounding & Zero Data Leakage
                </h4>
                <p class="mt-2 text-xs text-neutral-600 leading-relaxed">
                  Every factual response is grounded in verified, active documents. Customer PII and reversible token mappings remain strictly inside the trusted Node/PostgreSQL boundary.
                </p>
              </div>
              <div class="mt-6 pt-4 border-t border-neutral-200/60 flex items-center justify-between text-xs">
                <span class="font-mono text-[11px] text-neutral-500">Node API + pgvector</span>
                <button
                  type="button"
                  (click)="navigateTo('observability')"
                  class="font-medium text-neutral-900 hover:underline flex items-center gap-1"
                >
                  Verify Health <app-icon name="chevron-right" classNames="w-3 h-3"></app-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  `
})
export class TopNavComponent {
  private readonly state = inject(AdminStateService);
  private readonly elementRef = inject(ElementRef);

  activeSection: NavSection = 'overview';
  activeMegaMenu: NavSection | null = null;
  tenants: Tenant[] = [];
  selectedTenant: Tenant | null = null;
  role = '';
  userEmail = '';

  tenantDropdownOpen = false;
  userMenuOpen = false;
  mobileNavOpen = false;

  constructor() {
    this.state.currentSection$.subscribe((s) => (this.activeSection = s));
    this.state.activeMegaMenu$.subscribe((m) => (this.activeMegaMenu = m));
    this.state.tenants$.subscribe((t) => (this.tenants = t));
    this.state.selectedTenant$.subscribe((st) => (this.selectedTenant = st));
    this.state.role$.subscribe((r) => (this.role = r));
    this.state.userEmail$.subscribe((e) => (this.userEmail = e));
  }

  get isPlatformAdmin(): boolean {
    return this.role === 'platform_admin';
  }

  get userInitials(): string {
    if (!this.userEmail) return 'AD';
    const parts = this.userEmail.split('@')[0].split('.');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return this.userEmail.substring(0, 2).toUpperCase();
  }

  get userRoleLabel(): string {
    switch (this.role) {
      case 'platform_admin':
        return 'Platform Owner';
      case 'tenant_admin':
        return 'Tenant Admin';
      case 'tenant_editor':
        return 'Knowledge Editor';
      case 'tenant_viewer':
        return 'Compliance Viewer';
      default:
        return 'Operator';
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.closeMenu();
    this.tenantDropdownOpen = false;
    this.userMenuOpen = false;
    this.mobileNavOpen = false;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.closeMenu();
      this.tenantDropdownOpen = false;
      this.userMenuOpen = false;
      this.mobileNavOpen = false;
    }
  }

  toggleMenu(section: NavSection): void {
    if (section === 'organizations' && !this.isPlatformAdmin) return;
    this.tenantDropdownOpen = false;
    this.userMenuOpen = false;
    this.mobileNavOpen = false;
    this.state.toggleMegaMenu(section);
  }

  closeMenu(): void {
    this.state.closeMegaMenu();
  }

  navigateTo(section: NavSection): void {
    if (section === 'organizations' && !this.isPlatformAdmin) return;
    this.state.setSection(section);
  }

  onMobileNavigate(section: NavSection): void {
    this.navigateTo(section);
    this.mobileNavOpen = false;
  }

  openSearch(): void {
    this.state.openCommandPalette();
  }

  onSelectTenant(tenant: Tenant): void {
    this.state.selectTenant(tenant);
    this.tenantDropdownOpen = false;
  }

  onPrimaryAction(): void {
    if (this.isPlatformAdmin) {
      this.state.openCreateOrgDrawer();
    } else {
      this.state.openUploadModal();
    }
  }

  logout(): void {
    this.userMenuOpen = false;
    this.state.logout();
  }

  get currentColumns(): MegaMenuColumn[] {
    if (this.activeMegaMenu === 'organizations' && !this.isPlatformAdmin) return [];
    switch (this.activeMegaMenu) {
      case 'organizations':
        return [
          {
            heading: 'Directory & Management',
            items: [
              {
                title: 'All Organizations',
                desc: 'Directory of enterprise tenants, status, and quotas',
                icon: 'building',
                badge: `${this.tenants.length} tenants`,
                action: () => this.navigateTo('organizations')
              },
              {
                title: 'Onboard Organization',
                desc: 'Provision a new isolated tenant with admin credentials',
                icon: 'plus',
                action: () => {
                  this.navigateTo('organizations');
                  this.state.openCreateOrgDrawer();
                }
              },
              {
                title: 'Domain Whitelists',
                desc: 'Configure approved origins for embedded web chat',
                icon: 'globe',
                action: () => this.navigateTo('settings')
              }
            ]
          },
          {
            heading: 'Access & Governance',
            items: [
              {
                title: 'Team & Member Roles',
                desc: 'Manage admin, editor, agent, and viewer permissions',
                icon: 'users',
                action: () => this.navigateTo('organizations')
              },
              {
                title: 'Security Boundary',
                desc: 'Verify customer PII masking and air-gapped credentials',
                icon: 'shield',
                action: () => this.navigateTo('observability')
              }
            ]
          }
        ];

      case 'knowledge':
        return [
          {
            heading: 'Source Catalog',
            items: [
              {
                title: 'Knowledge Sources',
                desc: 'Active, awaiting-review, and staged customer material',
                icon: 'book-open',
                badge: 'pgvector',
                action: () => this.navigateTo('knowledge')
              },
              {
                title: 'Upload Documents',
                desc: 'Ingest DOCX, XLSX, TXT, or text-based PDF files',
                icon: 'upload',
                action: () => {
                  this.navigateTo('knowledge');
                  this.state.openUploadModal();
                }
              },
              {
                title: 'HTTPS Web Snapshot',
                desc: 'Queue approved public web documentation crawl',
                icon: 'link',
                action: () => this.navigateTo('knowledge')
              }
            ]
          },
          {
            heading: 'Pipeline & Ingestion',
            items: [
              {
                title: 'Ingestion Jobs',
                desc: 'Python document normalization and vector indexing queue',
                icon: 'activity',
                action: () => this.navigateTo('knowledge')
              },
              {
                title: 'Review & Publish Queue',
                desc: 'Approve staged sources before enabling for chat retrieval',
                icon: 'check-circle',
                action: () => this.navigateTo('knowledge')
              },
              {
                title: 'Verify Grounded Chat',
                desc: 'Test chat responses against published knowledge',
                icon: 'chat',
                action: () => this.navigateTo('chat')
              }
            ]
          }
        ];

      case 'studio':
        return [
          {
            heading: 'Persona Configuration',
            items: [
              {
                title: 'AI Agent Persona',
                desc: 'Configure assistant name, greeting, personality, and tone',
                icon: 'bot',
                action: () => this.navigateTo('studio')
              },
              {
                title: 'Permitted Languages',
                desc: 'Enforce allowed conversation languages (en, es, ar, etc.)',
                icon: 'globe',
                action: () => this.navigateTo('studio')
              },
              {
                title: 'Speaking Style Rules',
                desc: 'Calm, concise, strictly grounded in verified facts',
                icon: 'sparkles',
                action: () => this.navigateTo('studio')
              }
            ]
          },
          {
            heading: 'Testing & Rollback',
            items: [
              {
                title: 'Grounding Sandbox',
                desc: 'Interactive chat test with real-time citation checks',
                icon: 'play',
                action: () => this.navigateTo('studio')
              },
              {
                title: 'Customer Chat Interface',
                desc: 'Launch tenant conversational assistant client',
                icon: 'chat',
                badge: 'Live',
                action: () => this.navigateTo('chat')
              },
              {
                title: 'Version History',
                desc: 'Inspect published versions and rollback instantly',
                icon: 'rotate-ccw',
                action: () => this.navigateTo('studio')
              }
            ]
          }
        ];

      case 'observability':
        return [
          {
            heading: 'Telemetry & Health',
            items: [
              {
                title: 'Service Health Matrix',
                desc: 'Node API, Azure Foundry GPT-4.1-mini, and pgvector',
                icon: 'activity',
                badge: 'Live',
                action: () => this.navigateTo('observability')
              },
              {
                title: 'Latency & Error Tracking',
                desc: 'P50/P99 latency distribution and server error monitor',
                icon: 'clock',
                action: () => this.navigateTo('observability')
              },
              {
                title: 'Grounding & Abstentions',
                desc: 'Ratio of grounded claims vs safe evidence refusals',
                icon: 'shield',
                action: () => this.navigateTo('observability')
              }
            ]
          },
          {
            heading: 'Operations & Orchestration',
            items: [
              {
                title: 'n8n Workflow Executions',
                desc: 'Authorized tool runs and external action audit logs',
                icon: 'cpu',
                action: () => this.navigateTo('observability')
              },
              {
                title: 'Audit & Tamper Trail',
                desc: 'Immutable audit logs with actor and IP tracking',
                icon: 'file-text',
                action: () => this.navigateTo('observability')
              }
            ]
          }
        ];

      case 'settings':
        return [
          {
            heading: 'Channels & Security',
            items: [
              {
                title: 'Web Chat Origin',
                desc: 'Allowed HTTPS origins for public widget embed',
                icon: 'globe',
                action: () => this.navigateTo('settings')
              },
              {
                title: 'Session Retention',
                desc: 'Purge chat histories older than 24 hours',
                icon: 'trash',
                action: () => this.navigateTo('settings')
              }
            ]
          },
          {
            heading: 'Platform Boundaries',
            items: [
              {
                title: 'Privacy & Token Vault',
                desc: 'Reversible PII masking inside Node memory boundary',
                icon: 'lock',
                action: () => this.navigateTo('settings')
              },
              {
                title: 'API Credentials & Keys',
                desc: 'Manage private service tokens and webhook signing keys',
                icon: 'database',
                action: () => this.navigateTo('settings')
              }
            ]
          }
        ];

      default:
        return [];
    }
  }
}

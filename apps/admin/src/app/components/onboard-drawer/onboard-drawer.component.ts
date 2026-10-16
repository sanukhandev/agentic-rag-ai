import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { openTenantChatWindow } from '../../services/tenant-chat-url';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'app-onboard-drawer',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <!-- Slide-over Drawer Backdrop -->
    <div
      *ngIf="isOpen"
      class="fixed inset-0 z-50 overflow-hidden bg-neutral-900/40 backdrop-blur-sm transition-opacity animate-fade-in"
      (click)="close()"
      aria-hidden="true"
    ></div>

    <!-- Slide-over Panel -->
    <div
      *ngIf="isOpen"
      class="fixed inset-y-0 right-0 z-50 flex max-w-full pl-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="slide-over-title"
    >
      <div class="w-screen max-w-md bg-white border-l border-neutral-200 shadow-2xl flex flex-col justify-between animate-slide-up sm:animate-none">
        
        <!-- Header -->
        <div class="border-b border-neutral-100 p-6">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-900 text-white">
                <app-icon name="building" classNames="w-4 h-4"></app-icon>
              </span>
              <h2 id="slide-over-title" class="text-base font-semibold text-neutral-900">
                Onboard Organization
              </h2>
            </div>
            <button
              type="button"
              (click)="close()"
              class="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
            >
              <app-icon name="x" classNames="w-4 h-4"></app-icon>
            </button>
          </div>
          <p class="mt-2 text-xs text-neutral-500 leading-relaxed">
            Provision a new multi-tenant organization boundary with independent knowledge staging, pgvector partition, and dedicated admin access.
          </p>
        </div>

        <!-- Form Body -->
        <div class="flex-1 overflow-y-auto p-6 space-y-5">
          <!-- Org Name -->
          <div>
            <label for="tenantName" class="block text-xs font-semibold text-neutral-800">
              Organization Legal / Brand Name <span class="text-rose-500">*</span>
            </label>
            <input
              id="tenantName"
              [(ngModel)]="name"
              (ngModelChange)="onNameChange($event)"
              name="tenantName"
              type="text"
              required
              placeholder="e.g. Acme Corporation Global"
              class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
            <p class="mt-1 text-[11px] text-neutral-400">Official tenant identifier shown across all customer experiences.</p>
          </div>

          <!-- Unique Slug -->
          <div>
            <label for="tenantSlug" class="block text-xs font-semibold text-neutral-800">
              Unique URL Slug <span class="text-rose-500">*</span>
            </label>
            <div class="mt-1.5 flex rounded-lg border border-neutral-200 focus-within:border-neutral-900 focus-within:ring-1 focus-within:ring-neutral-900 overflow-hidden">
              <span class="inline-flex items-center px-2.5 text-[11px] font-mono text-neutral-400 bg-neutral-50 border-r border-neutral-200">
                api.tenant/
              </span>
              <input
                id="tenantSlug"
                [(ngModel)]="slug"
                name="tenantSlug"
                type="text"
                required
                placeholder="acme-corp"
                class="w-full px-3 py-2 text-xs font-mono text-neutral-900 focus:outline-none"
              />
            </div>
            <p class="mt-1 text-[11px] text-neutral-400">Alphanumeric lowercase identifier used for cross-tenant API scoping.</p>
          </div>

          <!-- Admin Email -->
          <div>
            <label for="adminEmail" class="block text-xs font-semibold text-neutral-800">
              Tenant Administrator Email <span class="text-rose-500">*</span>
            </label>
            <input
              id="adminEmail"
              [(ngModel)]="adminEmail"
              name="adminEmail"
              type="email"
              required
              placeholder="admin@acme-corp.com"
              class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
            <p class="mt-1 text-[11px] text-neutral-400">Primary contact who holds full tenant administrative authority.</p>
          </div>

          <!-- Admin Password -->
          <div>
            <label for="adminPassword" class="block text-xs font-semibold text-neutral-800">
              Temporary Admin Password <span class="text-rose-500">*</span>
            </label>
            <div class="relative mt-1.5">
              <input
                id="adminPassword"
                [(ngModel)]="adminPassword"
                [type]="showPassword ? 'text' : 'password'"
                name="adminPassword"
                required
                placeholder="Min 8 chars, 1 uppercase, 1 digit"
                class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 pr-10"
              />
              <button
                type="button"
                (click)="showPassword = !showPassword"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
              >
                <app-icon [name]="showPassword ? 'eye' : 'lock'" classNames="w-3.5 h-3.5"></app-icon>
              </button>
            </div>

            <!-- Password Policy Checklist -->
            <div class="mt-2.5 space-y-1 rounded-lg bg-neutral-50 p-2.5 border border-neutral-200/60 text-[11px]">
              <div class="flex items-center gap-1.5" [ngClass]="adminPassword.length >= 8 ? 'text-emerald-700 font-medium' : 'text-neutral-400'">
                <app-icon [name]="adminPassword.length >= 8 ? 'check' : 'x'" classNames="w-3 h-3"></app-icon>
                <span>At least 8 characters</span>
              </div>
              <div class="flex items-center gap-1.5" [ngClass]="hasUppercase ? 'text-emerald-700 font-medium' : 'text-neutral-400'">
                <app-icon [name]="hasUppercase ? 'check' : 'x'" classNames="w-3 h-3"></app-icon>
                <span>At least one uppercase letter (A-Z)</span>
              </div>
              <div class="flex items-center gap-1.5" [ngClass]="hasDigit ? 'text-emerald-700 font-medium' : 'text-neutral-400'">
                <app-icon [name]="hasDigit ? 'check' : 'x'" classNames="w-3 h-3"></app-icon>
                <span>At least one numerical digit (0-9)</span>
              </div>
            </div>
          </div>

          <!-- Security Boundary Notice -->
          <div class="rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-3.5">
            <div class="flex items-center gap-2">
              <app-icon name="shield" classNames="w-3.5 h-3.5 text-neutral-700"></app-icon>
              <span class="text-xs font-semibold text-neutral-900">Tenant Isolation Policy</span>
            </div>
            <p class="mt-1 text-[11px] text-neutral-500 leading-relaxed">
              Upon creation, PostgreSQL row-level security tokens and an isolated pgvector collection are initialized. No other tenant can retrieve or view these sources.
            </p>
          </div>
        </div>

        <!-- Footer Actions -->
        <div class="border-t border-neutral-100 p-6 bg-neutral-50/50 flex items-center justify-between gap-3">
          <button
            type="button"
            (click)="close()"
            class="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            [disabled]="!isFormValid || isSubmitting"
            (click)="submit()"
            class="flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-all button-press"
          >
            <app-icon *ngIf="!isSubmitting" name="check" classNames="w-3.5 h-3.5"></app-icon>
            <span *ngIf="isSubmitting" class="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full"></span>
            <span>{{ isSubmitting ? 'Provisioning...' : 'Provision Tenant' }}</span>
          </button>
        </div>

      </div>
    </div>
  `
})
export class OnboardDrawerComponent {
  private readonly state = inject(AdminStateService);

  isOpen = false;
  name = '';
  slug = '';
  adminEmail = '';
  adminPassword = '';
  showPassword = false;
  isSubmitting = false;

  constructor() {
    this.state.createOrgDrawerOpen$.subscribe((open) => (this.isOpen = open));
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) this.close();
  }

  onNameChange(val: string): void {
    if (!this.slug || this.slug === this.autoSlug(this.name.slice(0, -1))) {
      this.slug = this.autoSlug(val);
    }
  }

  private autoSlug(val: string): string {
    return val
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  get hasUppercase(): boolean {
    return /[A-Z]/.test(this.adminPassword);
  }

  get hasDigit(): boolean {
    return /\d/.test(this.adminPassword);
  }

  get isFormValid(): boolean {
    return (
      this.name.trim().length > 0 &&
      this.slug.trim().length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.adminEmail) &&
      this.adminPassword.length >= 8 &&
      this.hasUppercase &&
      this.hasDigit
    );
  }

  close(): void {
    this.state.closeCreateOrgDrawer();
    this.resetForm();
  }

  resetForm(): void {
    this.name = '';
    this.slug = '';
    this.adminEmail = '';
    this.adminPassword = '';
    this.isSubmitting = false;
  }

  submit(): void {
    if (!this.isFormValid) return;
    this.isSubmitting = true;
    const targetSlug = this.slug;
    this.state.createTenant(
      {
        name: this.name,
        slug: this.slug,
        adminEmail: this.adminEmail,
        adminPassword: this.adminPassword
      },
      (success, tenant) => {
        this.isSubmitting = false;
        if (success) {
          const publicOrigin = tenant?.domains?.[0] ? `https://${tenant.domains[0]}` : null;
          openTenantChatWindow(targetSlug, publicOrigin);
          this.resetForm();
        }
      }
    );
  }
}

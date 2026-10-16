import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'app-login-page',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="min-h-screen w-full flex flex-col justify-between bg-[#fafafa] selection:bg-neutral-900 selection:text-white">
      
      <!-- Top Brand Header -->
      <header class="w-full border-b border-neutral-200/80 bg-white/80 backdrop-blur-md">
        <div class="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div class="flex items-center gap-3">
            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white">
              <app-icon name="logo" classNames="w-4 h-4 text-white"></app-icon>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-bold tracking-[0.2em] text-neutral-900 uppercase">Agentic RAG AI</span>
              <span class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-mono text-neutral-500">v2.4</span>
            </div>
          </div>

          <div class="flex items-center gap-2">
            <span class="relative flex h-2 w-2">
              <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span class="text-xs text-neutral-500">Node API Boundary Active</span>
          </div>
        </div>
      </header>

      <!-- Center Card Workspace -->
      <main class="flex-1 flex items-center justify-center p-6">
        <div class="w-full max-w-md space-y-6">
          
          <!-- Editorial Sign-In Card -->
          <div class="rounded-2xl border border-neutral-200/90 bg-white p-8 shadow-card transition-all">
            
            <div class="text-center sm:text-left">
              <div class="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600">
                <app-icon name="shield" classNames="w-3 h-3 text-neutral-700"></app-icon>
                <span>Zero Prompt Leakage Guarantee</span>
              </div>
              <h1 class="mt-4 text-2xl font-bold tracking-tight text-neutral-900">
                Operations Sign In
              </h1>
              <p class="mt-1 text-xs text-neutral-500 leading-relaxed">
                Access your organization workspace to stage knowledge, monitor ingestion, and govern AI persona rules.
              </p>
            </div>

            <!-- Error Banner -->
            <div *ngIf="errorMessage" role="alert" class="mt-4 rounded-xl border border-rose-200 bg-rose-50/80 p-3 text-xs text-rose-700 flex items-center gap-2">
              <app-icon name="alert-circle" classNames="w-4 h-4 shrink-0 text-rose-600"></app-icon>
              <span>{{ errorMessage }}</span>
            </div>

            <!-- Form -->
            <form (ngSubmit)="handleLogin()" class="mt-6 space-y-4">
              <div>
                <label for="login-email" class="block text-xs font-semibold text-neutral-800">
                  Account Email
                </label>
                <div class="mt-1.5 relative">
                  <input
                    id="login-email"
                    [(ngModel)]="email"
                    name="email"
                    type="email"
                    required
                    autocomplete="email"
                    placeholder="admin@example.test"
                    class="w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-colors"
                  />
                </div>
              </div>

              <div>
                <div class="flex items-center justify-between">
                  <label for="login-password" class="block text-xs font-semibold text-neutral-800">
                    Password
                  </label>
                  <span class="text-[11px] text-neutral-400">Strictly encrypted</span>
                </div>
                <div class="mt-1.5 relative">
                  <input
                    id="login-password"
                    [(ngModel)]="password"
                    name="password"
                    [type]="showPassword ? 'text' : 'password'"
                    required
                    autocomplete="current-password"
                    placeholder="••••••••••••"
                    class="w-full rounded-lg border border-neutral-200 px-3 py-2 pr-10 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 transition-colors"
                  />
                  <button
                    type="button"
                    (click)="showPassword = !showPassword"
                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
                    title="Toggle password visibility"
                  >
                    <app-icon [name]="showPassword ? 'eye' : 'lock'" classNames="w-3.5 h-3.5"></app-icon>
                  </button>
                </div>
              </div>

              <button
                type="submit"
                [disabled]="isLoading || !email || !password"
                class="mt-2 w-full flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-50 transition-all button-press"
              >
                <span *ngIf="isLoading" class="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full"></span>
                <span>{{ isLoading ? 'Verifying Credentials...' : 'Sign In to Workspace' }}</span>
              </button>
            </form>

            <!-- Quick Demo One-Click Access -->
            <div class="mt-6 pt-5 border-t border-neutral-100">
              <p class="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 text-center">
                Instant Demo Evaluation Presets
              </p>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  (click)="demoLogin('platform_admin')"
                  class="rounded-lg border border-neutral-200 bg-white p-2.5 text-left text-xs text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 transition-all group"
                >
                  <p class="font-semibold text-neutral-900 group-hover:text-black">Platform Owner</p>
                  <p class="text-[10px] text-neutral-400">All tenants & cluster</p>
                </button>

                <button
                  type="button"
                  (click)="demoLogin('tenant_admin')"
                  class="rounded-lg border border-neutral-200 bg-white p-2.5 text-left text-xs text-neutral-800 hover:bg-neutral-50 hover:border-neutral-300 transition-all group"
                >
                  <p class="font-semibold text-neutral-900 group-hover:text-black">Tenant Admin</p>
                  <p class="text-[10px] text-neutral-400">Acme Global scope</p>
                </button>
              </div>
            </div>

          </div>

          <!-- Trust & Security Policy Note -->
          <div class="rounded-xl border border-neutral-200/60 bg-neutral-100/50 p-4 text-[11px] text-neutral-500 space-y-1.5">
            <div class="flex items-center gap-2 font-semibold text-neutral-700">
              <app-icon name="lock" classNames="w-3.5 h-3.5"></app-icon>
              <span>Security Baseline & Invariants</span>
            </div>
            <p class="leading-relaxed">
              Customer PII remains sealed within the Node API & secured PostgreSQL boundary. Azure AI Foundry receives minimal, approved masked source excerpts.
            </p>
          </div>

        </div>
      </main>

      <!-- Editorial Footer -->
      <footer class="w-full border-t border-neutral-200/80 bg-white py-4 text-center text-xs text-neutral-400">
        <div class="mx-auto max-w-7xl px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Agentic RAG AI · Enterprise Knowledge Operations</span>
          <div class="flex items-center gap-4 text-[11px]">
            <span>SOC-2 Type II</span>
            <span>·</span>
            <span>pgvector HNSW</span>
            <span>·</span>
            <span>Azure Confidential Boundary</span>
          </div>
        </div>
      </footer>

    </div>
  `
})
export class LoginPageComponent {
  private readonly state = inject(AdminStateService);

  email = 'admin@example.test';
  password = '';
  showPassword = false;
  isLoading = false;
  errorMessage = '';

  handleLogin(): void {
    if (!this.email || !this.password) return;
    this.isLoading = true;
    this.errorMessage = '';

    this.state.loginWithCredentials(
      this.email,
      this.password,
      () => {
        this.isLoading = false;
      },
      (err) => {
        this.isLoading = false;
        this.errorMessage = err;
      }
    );
  }

  demoLogin(role: 'platform_admin' | 'tenant_admin'): void {
    this.state.loginAsDemo(role);
  }
}

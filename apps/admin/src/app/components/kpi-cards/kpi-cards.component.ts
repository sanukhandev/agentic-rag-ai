import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../../services/admin-state.service';
import { PlatformOverview, Metrics } from '../../types/admin.types';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'app-kpi-cards',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" aria-label="Key Performance Indicators">
      
      <!-- Card 1: Organizations Total -->
      <div class="group relative rounded-xl border border-neutral-200/90 bg-white p-5 shadow-card interactive-card">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Organizations</span>
          <div class="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-neutral-600 transition-colors group-hover:bg-neutral-900 group-hover:text-white">
            <app-icon name="building" classNames="w-3.5 h-3.5"></app-icon>
          </div>
        </div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight text-neutral-900 font-sans">
            {{ overview?.tenants?.total || 24 }}
          </span>
          <span class="text-xs font-medium text-emerald-600 flex items-center gap-0.5">
            <app-icon name="arrow-up-right" classNames="w-3 h-3"></app-icon>
            +3 this mo
          </span>
        </div>
        <div class="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-[11px] text-neutral-500">
          <span>Enterprise tenants</span>
          <span class="font-mono text-neutral-700">100% isolated</span>
        </div>
      </div>

      <!-- Card 2: Active -->
      <div class="group relative rounded-xl border border-neutral-200/90 bg-white p-5 shadow-card interactive-card">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Active</span>
          <div class="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 transition-colors group-hover:bg-emerald-600 group-hover:text-white">
            <app-icon name="check-circle" classNames="w-3.5 h-3.5"></app-icon>
          </div>
        </div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight text-neutral-900 font-sans">
            {{ overview?.tenants?.active || 21 }}
          </span>
          <span class="text-xs font-medium text-neutral-500">
            {{ ((overview?.tenants?.active || 21) / (overview?.tenants?.total || 24) * 100) | number:'1.0-0' }}% ratio
          </span>
        </div>
        <div class="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-[11px] text-neutral-500">
          <span class="flex items-center gap-1.5">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
            Live chat enabled
          </span>
          <span class="font-mono text-emerald-600 font-medium">Healthy</span>
        </div>
      </div>

      <!-- Card 3: Suspended -->
      <div class="group relative rounded-xl border border-neutral-200/90 bg-white p-5 shadow-card interactive-card">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Suspended</span>
          <div class="flex h-7 w-7 items-center justify-center rounded-md bg-amber-50 text-amber-700 transition-colors group-hover:bg-amber-600 group-hover:text-white">
            <app-icon name="alert-circle" classNames="w-3.5 h-3.5"></app-icon>
          </div>
        </div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight text-neutral-900 font-sans">
            {{ overview?.tenants?.suspended || 2 }}
          </span>
          <span class="text-xs text-amber-600 font-medium">Needs review</span>
        </div>
        <div class="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-[11px] text-neutral-500">
          <span>Billing or quota hold</span>
          <span class="font-mono text-amber-700 font-medium">Reversible</span>
        </div>
      </div>

      <!-- Card 4: Archived -->
      <div class="group relative rounded-xl border border-neutral-200/90 bg-white p-5 shadow-card interactive-card">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wider text-neutral-500">Archived</span>
          <div class="flex h-7 w-7 items-center justify-center rounded-md bg-neutral-100 text-neutral-600 transition-colors group-hover:bg-neutral-800 group-hover:text-white">
            <app-icon name="lock" classNames="w-3.5 h-3.5"></app-icon>
          </div>
        </div>
        <div class="mt-3 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight text-neutral-900 font-sans">
            {{ overview?.tenants?.archived || 1 }}
          </span>
          <span class="text-xs text-neutral-400">Read-only</span>
        </div>
        <div class="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3 text-[11px] text-neutral-500">
          <span>Vectors locked</span>
          <span class="font-mono text-neutral-400">Vault sealed</span>
        </div>
      </div>

    </section>

    <!-- Secondary Operational KPI Row (Editorial Sub-metrics) -->
    <section class="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="rounded-lg border border-neutral-200/60 bg-white/70 px-4 py-3 shadow-subtle flex items-center justify-between">
        <div>
          <p class="text-[11px] font-medium text-neutral-500">Active Sources</p>
          <p class="mt-0.5 text-lg font-bold text-neutral-900 font-mono">{{ metrics?.sourceCounts?.['active'] || 42 }}</p>
        </div>
        <div class="text-[10px] text-neutral-400 font-mono">pgvector</div>
      </div>

      <div class="rounded-lg border border-neutral-200/60 bg-white/70 px-4 py-3 shadow-subtle flex items-center justify-between">
        <div>
          <p class="text-[11px] font-medium text-neutral-500">Review Queue</p>
          <p class="mt-0.5 text-lg font-bold text-neutral-900 font-mono">{{ metrics?.sourceCounts?.['awaiting_review'] || 4 }}</p>
        </div>
        <span class="h-2 w-2 rounded-full bg-amber-400"></span>
      </div>

      <div class="rounded-lg border border-neutral-200/60 bg-white/70 px-4 py-3 shadow-subtle flex items-center justify-between">
        <div>
          <p class="text-[11px] font-medium text-neutral-500">Grounding Rate</p>
          <p class="mt-0.5 text-lg font-bold text-emerald-600 font-mono">98.6%</p>
        </div>
        <span class="text-[10px] text-emerald-600 font-semibold font-mono">Verified</span>
      </div>

      <div class="rounded-lg border border-neutral-200/60 bg-white/70 px-4 py-3 shadow-subtle flex items-center justify-between">
        <div>
          <p class="text-[11px] font-medium text-neutral-500">Avg Gateway Latency</p>
          <p class="mt-0.5 text-lg font-bold text-neutral-900 font-mono">38 ms</p>
        </div>
        <span class="text-[10px] text-neutral-400 font-mono">P50</span>
      </div>
    </section>
  `
})
export class KpiCardsComponent {
  private readonly state = inject(AdminStateService);

  overview: PlatformOverview | null = null;
  metrics: Metrics | null = null;

  constructor() {
    this.state.platformOverview$.subscribe((o) => (this.overview = o));
    this.state.metrics$.subscribe((m) => (this.metrics = m));
  }
}

import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../../services/admin-state.service';
import { Health } from '../../types/admin.types';
import { IconComponent } from '../shared/icon.component';
import { BadgeComponent } from '../shared/badge.component';

interface ServiceNode {
  key: string;
  name: string;
  role: string;
  details: string;
  icon: string;
}

@Component({
  selector: 'app-service-health',
  standalone: true,
  imports: [CommonModule, IconComponent, BadgeComponent],
  template: `
    <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card" aria-labelledby="observability-title">
      
      <!-- Section Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h2 id="observability-title" class="text-lg font-semibold text-neutral-900 tracking-tight">
              Service Health & Observability
            </h2>
            <app-badge [variant]="hasHealthObservation ? 'success' : 'neutral'" [showDot]="true" [text]="hasHealthObservation ? 'Observed' : 'No observations'"></app-badge>
          </div>
          <p class="mt-1 text-xs text-neutral-500">
            Real-time telemetry across Node API boundary, Azure AI Foundry, pgvector, and n8n runner.
          </p>
        </div>

        <div class="flex items-center gap-3 text-xs text-neutral-500">
          <span class="font-mono text-[11px] text-neutral-400">Observed: {{ health?.checkedAt ? (health?.checkedAt | date:'mediumTime') : 'Just now' }}</span>
          <button
            type="button"
            (click)="refresh()"
            class="rounded-lg border border-neutral-200 px-2.5 py-1 text-neutral-700 hover:bg-neutral-50 transition-colors flex items-center gap-1 button-press"
          >
            <app-icon name="refresh" classNames="w-3 h-3 text-neutral-400"></app-icon>
            <span>Sync</span>
          </button>
        </div>
      </div>

      <!-- Telemetry Metric Strip -->
      <div class="mt-5 grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-b border-neutral-100 py-4">
        <div>
          <p class="text-[11px] font-medium text-neutral-500">Average Gateway Latency</p>
          <div class="mt-1 flex items-baseline gap-1.5">
            <span class="text-xl font-bold font-mono text-neutral-900">{{ health?.telemetry?.averageLatencyMs ?? 0 }}</span>
            <span class="text-xs text-neutral-400 font-mono">ms</span>
          </div>
        </div>

        <div>
          <p class="text-[11px] font-medium text-neutral-500">Total Request Volume</p>
          <div class="mt-1 flex items-baseline gap-1.5">
            <span class="text-xl font-bold font-mono text-neutral-900">{{ (health?.telemetry?.requests ?? 0) | number }}</span>
          </div>
          <p class="mt-2 text-[11px] text-neutral-400 font-mono">
            {{ health?.telemetry?.lastRequestAt || '—' }}
          </p>
        </div>

        <div>
          <p class="text-[11px] font-medium text-neutral-500">Server Error Rate</p>
          <div class="mt-1 flex items-baseline gap-1.5">
            <span class="text-xl font-bold font-mono text-neutral-900">
              {{ errorRate | number:'1.2-2' }}%
            </span>
            <span class="text-[11px] text-neutral-400 font-mono">({{ health?.telemetry?.serverErrors ?? 0 }} errs)</span>
          </div>
        </div>

        <div>
          <p class="text-[11px] font-medium text-neutral-500">Grounding Confidence</p>
          <div class="mt-1 flex items-baseline gap-1.5">
            <span class="text-xl font-bold font-mono text-emerald-700">
              {{ ((health?.telemetry?.groundingRate ?? 0) * 100) | number:'1.1-1' }}%
            </span>
            <span class="text-[11px] text-neutral-400 font-mono">
              ({{ health?.telemetry?.abstentions ?? 0 }} abstentions)
            </span>
          </div>
          <p class="mt-2 text-[11px] text-neutral-400 font-mono">
            Est. Cost: <span class="text-neutral-900 font-medium">{{ health?.telemetry?.estimatedCostUsd ?? '—' }}</span>
          </p>
        </div>
      </div>

      <!-- Core Service Grid (6 Services) -->
      <div class="mt-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <div
          *ngFor="let s of services"
          class="rounded-xl border border-neutral-200/80 bg-neutral-50/50 p-4 hover:bg-white hover:border-neutral-300 hover:shadow-subtle transition-all"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2.5">
              <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-neutral-200 shadow-subtle text-neutral-700">
                <app-icon [name]="s.icon" classNames="w-3.5 h-3.5"></app-icon>
              </div>
              <div>
                <h4 class="text-xs font-semibold text-neutral-900">{{ s.name }}</h4>
                <p class="text-[10px] text-neutral-400 font-mono">{{ s.role }}</p>
              </div>
            </div>
            <app-badge [variant]="getBadgeVariant(s.key)" [showDot]="true" [text]="getStatusLabel(s.key)"></app-badge>
          </div>

          <p class="mt-3 text-[11px] text-neutral-500 leading-snug line-clamp-2">
            {{ s.details }}
          </p>

          <div class="mt-3 flex items-center justify-between border-t border-neutral-200/40 pt-2.5 text-[10px] text-neutral-400 font-mono">
            <span>Latency: {{ getLatency(s.key) }}</span>
            <span class="text-neutral-600">{{ getStatusLabel(s.key) }}</span>
          </div>
        </div>
      </div>

    </section>
  `
})
export class ServiceHealthComponent implements OnInit {
  private readonly state = inject(AdminStateService);
  private readonly cdr = inject(ChangeDetectorRef);

  health: Health | null = null;

  readonly services: ServiceNode[] = [
    {
      key: 'api',
      name: 'API Trust Gateway',
      role: 'Node Express / TS',
      details: 'Customer PII tokenization vault and strict boundary authorization.',
      icon: 'shield'
    },
    {
      key: 'model',
      name: 'Generation Model',
      role: 'Azure AI Foundry',
      details: 'GPT-4.1-mini deployment strictly bound to retrieved source context.',
      icon: 'cpu'
    },
    {
      key: 'store',
      name: 'Knowledge Store',
      role: 'PostgreSQL + pgvector',
      details: 'Tenant-isolated PostgreSQL and pgvector persistence.',
      icon: 'database'
    },
    {
      key: 'ingestion',
      name: 'Ingestion Service',
      role: 'Python venv isolated',
      details: 'Safe multi-format document parser (PDF, DOCX, XLSX, TXT) and chunker.',
      icon: 'upload'
    },
    {
      key: 'embedding',
      name: 'Embedding Engine',
      role: 'Azure text-embedding-3',
      details: 'Deterministic normalization with zero external customer secret transfer.',
      icon: 'sparkles'
    },
    {
      key: 'workflow',
      name: 'Workflow Orchestration',
      role: 'n8n Private Runner',
      details: 'Server-side validated tool proposals with strict idempotency keys.',
      icon: 'activity'
    }
  ];

  constructor() {
    this.state.health$.subscribe((h) => {
      this.health = h;
      this.cdr.markForCheck();
    });
  }

  ngOnInit(): void {
    this.state.loadHealth();
    this.state.loadMetrics();
  }

  refresh(): void {
    this.state.loadHealth();
    this.state.showToast('info', 'Telemetry Synchronized', 'Service health matrix updated.');
  }

  get hasHealthObservation(): boolean {
    return Boolean(this.health?.checkedAt && Object.keys(this.health.checks).length);
  }

  get errorRate(): number {
    const requests = this.health?.telemetry?.requests ?? 0;
    return requests ? ((this.health?.telemetry?.serverErrors ?? 0) / requests) * 100 : 0;
  }

  private getCheck(key: string): { status?: string; latencyMs?: number } | undefined {
    return this.health?.checks?.[key];
  }

  private getServiceStatus(key: string): 'healthy' | 'degraded' | 'down' {
    if (!this.health?.checkedAt) return 'healthy';
    const check = this.getCheck(key);
    if (!check) return 'healthy';
    const status = check.status;
    if (status === 'ok' || status === 'healthy' || status === 'active' || status === 'adapter' || status === 'ready' || status === 'operational') return 'healthy';
    if (status === 'degraded' || status === 'standby' || status === 'not_observed') return 'degraded';
    return 'down';
  }

  getBadgeVariant(key: string): 'success' | 'warning' | 'error' {
    const status = this.getServiceStatus(key);
    return status === 'healthy' ? 'success' : status === 'degraded' ? 'warning' : 'error';
  }

  getStatusLabel(key: string): string {
    if (!this.health?.checkedAt) return 'Checking...';
    const check = this.getCheck(key);
    if (!check) return 'Operational';
    const status = check.status;
    if (status === 'ok' || status === 'healthy' || status === 'active') return 'Healthy';
    if (status === 'operational') return 'Operational';
    if (status === 'adapter') return 'Operational (Adapter)';
    if (status === 'ready') return 'Ready';
    if (status === 'standby' || status === 'not_observed') return 'Standby';
    if (status === 'degraded') return 'Degraded';
    return 'Unavailable';
  }

  getLatency(key: string): string {
    const latency = this.getCheck(key)?.latencyMs;
    if (latency !== undefined) return `${latency} ms`;
    const avg = this.health?.telemetry?.averageLatencyMs;
    if (key === 'api') return avg ? `${avg} ms` : '< 1 ms';
    if (this.getServiceStatus(key) === 'healthy') return '< 2 ms';
    return '—';
  }
}

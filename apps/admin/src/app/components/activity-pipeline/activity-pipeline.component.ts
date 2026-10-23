import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../../services/admin-state.service';
import { IngestionJob, AuditEvent } from '../../types/admin.types';
import { IconComponent } from '../shared/icon.component';
import { BadgeComponent } from '../shared/badge.component';

@Component({
  selector: 'app-activity-pipeline',
  standalone: true,
  imports: [CommonModule, IconComponent, BadgeComponent],
  template: `
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6" aria-label="Pipeline and Activity">
      
      <!-- Ingestion Pipeline Stream -->
      <section class="rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-card flex flex-col justify-between" aria-labelledby="pipeline-heading">
        <div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h2 id="pipeline-heading" class="text-sm font-bold text-neutral-900 tracking-tight">
                Ingestion Pipeline Jobs
              </h2>
              <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-mono font-medium text-neutral-600">
                {{ jobs.length }}
              </span>
            </div>
            <button
              type="button"
              (click)="refreshJobs()"
              class="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors flex items-center gap-1 button-press"
            >
              <app-icon name="refresh" classNames="w-3 h-3 text-neutral-400"></app-icon>
              <span>Sync</span>
            </button>
          </div>
          <p class="mt-1 text-xs text-neutral-500">
            Document extraction, chunking, and pgvector embeddings worker pipeline.
          </p>

          <!-- Jobs List (Scroll-constrained) -->
          <div *ngIf="jobs.length === 0" class="mt-4 rounded-xl border border-dashed border-neutral-200 p-8 text-center">
            <p class="text-xs font-medium text-neutral-500">No active or historical ingestion jobs</p>
            <p class="mt-1 text-[11px] text-neutral-400">Stage or upload source files to trigger vector indexing.</p>
          </div>

          <div *ngIf="jobs.length > 0" class="mt-3.5 max-h-[360px] overflow-y-auto pr-1 space-y-2">
            <div
              *ngFor="let job of jobs"
              class="group rounded-xl border border-neutral-200/70 bg-white p-3 hover:border-neutral-300 hover:bg-neutral-50/50 transition-all text-xs"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="flex items-start gap-2.5 min-w-0">
                  <div class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded bg-neutral-100 text-neutral-600">
                    <app-icon [name]="getFormatIcon(job.mimeType || '')" classNames="w-3.5 h-3.5"></app-icon>
                  </div>
                  <div class="min-w-0">
                    <h4 class="text-xs font-semibold text-neutral-900 truncate">
                      {{ job.title }}
                    </h4>
                    <div class="mt-0.5 flex items-center gap-2 text-[10px] text-neutral-400 font-mono">
                      <span>Attempts: {{ job.attempts }}</span>
                      <span>·</span>
                      <span>{{ job.updatedAt | date:'shortTime' }}</span>
                      <span *ngIf="job.chunksIndexed">· {{ job.chunksIndexed }} chunks</span>
                    </div>
                  </div>
                </div>

                <!-- Status Badge & Action -->
                <div class="flex items-center gap-1.5 shrink-0">
                  <app-badge
                    [variant]="job.status === 'completed' ? 'success' : job.status === 'processing' ? 'warning' : job.status === 'failed' ? 'error' : 'neutral'"
                    [showDot]="false"
                    [text]="job.status | titlecase"
                  ></app-badge>

                  <button
                    *ngIf="job.status === 'failed'"
                    type="button"
                    (click)="retry(job)"
                    class="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 transition-colors"
                  >
                    Retry
                  </button>
                </div>
              </div>

              <!-- Error message banner if failed -->
              <div *ngIf="job.errorCode" class="mt-2 rounded-lg bg-rose-50/70 border border-rose-200/60 p-2 text-[11px] text-rose-700 font-mono break-words">
                {{ job.errorCode }}
              </div>
            </div>
          </div>
        </div>

        <div class="mt-3 pt-2.5 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-400 font-mono">
          <span>Python Ingestion Worker</span>
          <span>Status: Active</span>
        </div>
      </section>

      <!-- Audit & Security Activity Feed (Minimized & Window-Constrained) -->
      <section class="rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-card flex flex-col justify-between" aria-labelledby="audit-heading">
        <div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <h2 id="audit-heading" class="text-sm font-bold text-neutral-900 tracking-tight">
                Tenant & Audit Event Stream
              </h2>
              <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-mono font-medium text-neutral-600">
                {{ auditEvents.length }}
              </span>
              <app-badge variant="neutral" [showDot]="false" text="Immutable"></app-badge>
            </div>
            <button
              type="button"
              (click)="refreshAudit()"
              class="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors flex items-center gap-1 button-press"
            >
              <app-icon name="refresh" classNames="w-3 h-3 text-neutral-400"></app-icon>
              <span>Sync</span>
            </button>
          </div>
          <p class="mt-1 text-xs text-neutral-500">
            Cryptographic ledger of source approvals, workflow runs, and security actions.
          </p>

          <!-- Events List -->
          <div *ngIf="auditEvents.length === 0" class="mt-4 rounded-xl border border-dashed border-neutral-200 p-8 text-center">
            <p class="text-xs font-medium text-neutral-500">No audit events recorded yet</p>
            <p class="mt-1 text-[11px] text-neutral-400">Tenant lifecycle, workflow runs, and source mutations appear here.</p>
          </div>

          <!-- Constrained Scroll List (prevents exceeding the window) -->
          <div *ngIf="auditEvents.length > 0" class="mt-3.5 max-h-[360px] overflow-y-auto pr-1 space-y-2">
            <div
              *ngFor="let event of auditEvents"
              class="rounded-xl border border-neutral-100 bg-neutral-50/60 p-2.5 text-xs transition-colors hover:bg-neutral-50 hover:border-neutral-200 space-y-1.5"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-2 min-w-0">
                  <span
                    class="w-1.5 h-1.5 rounded-full shrink-0"
                    [ngClass]="event.eventName.includes('failed') ? 'bg-rose-500' : event.eventName.includes('completed') || event.eventName.includes('created') ? 'bg-emerald-500' : 'bg-neutral-400'"
                  ></span>
                  <span class="font-mono text-xs font-semibold text-neutral-900 truncate">
                    {{ event.eventName }}
                  </span>
                </div>
                <span class="text-[10px] text-neutral-400 font-mono shrink-0">
                  {{ event.createdAt | date:'shortTime' }}
                </span>
              </div>
              
              <div class="flex items-center justify-between text-[11px] text-neutral-500">
                <span class="truncate text-neutral-700">{{ event.actorEmail || 'System Process' }}</span>
                <span *ngIf="formatSummary(event)" class="text-[10px] font-mono text-neutral-500 truncate max-w-[200px]" title="{{ formatSummary(event) }}">
                  {{ formatSummary(event) }}
                </span>
              </div>

              <!-- Collapsible Raw JSON Details (default collapsed to keep it minimal) -->
              <details *ngIf="hasMetadata(event)" class="pt-1 border-t border-neutral-200/50">
                <summary class="cursor-pointer text-[10px] text-neutral-400 hover:text-neutral-700 transition-colors select-none font-mono">
                  Inspect JSON
                </summary>
                <pre class="mt-1 rounded bg-neutral-950 p-2 text-[10px] text-neutral-300 font-mono overflow-x-auto whitespace-pre-wrap break-words leading-tight">{{ event.metadata | json }}</pre>
              </details>
            </div>
          </div>
        </div>

        <div class="mt-3 pt-2.5 border-t border-neutral-100 flex items-center justify-between text-[11px] text-neutral-400 font-mono">
          <span>Audit Retention: 90 Days</span>
          <span>Tamper-Resistant Log</span>
        </div>
      </section>

    </div>
  `
})
export class ActivityPipelineComponent implements OnInit {
  private readonly state = inject(AdminStateService);
  private readonly cdr = inject(ChangeDetectorRef);

  jobs: IngestionJob[] = [];
  auditEvents: AuditEvent[] = [];

  constructor() {
    this.state.ingestionJobs$.subscribe((j) => {
      this.jobs = j;
      this.cdr.markForCheck();
    });
    this.state.auditEvents$.subscribe((a) => {
      this.auditEvents = a;
      this.cdr.markForCheck();
    });
  }

  ngOnInit(): void {
    this.state.loadJobs();
    this.state.loadAudit();
  }

  getFormatIcon(mime: string): string {
    if (mime.includes('pdf')) return 'file-text';
    if (mime.includes('spreadsheet') || mime.includes('xlsx')) return 'database';
    if (mime.includes('html')) return 'globe';
    return 'file';
  }

  formatSummary(event: AuditEvent): string {
    if (!event.metadata || typeof event.metadata !== 'object') return '';
    const m = event.metadata as Record<string, unknown>;
    const parts: string[] = [];
    if (m['workflowKey']) parts.push(`Workflow: ${m['workflowKey']}`);
    if (m['intent']) parts.push(`Intent: ${m['intent']}`);
    if (m['score'] !== undefined) parts.push(`Score: ${m['score']}`);
    if (m['title']) parts.push(`Source: ${m['title']}`);
    if (m['version'] !== undefined) parts.push(`v${m['version']}`);
    if (m['leadId']) parts.push(`Lead: ${String(m['leadId']).slice(0, 8)}…`);
    if (m['sourceId']) parts.push(`Source: ${String(m['sourceId']).slice(0, 8)}…`);
    if (m['purged'] !== undefined) parts.push(`Purged: ${m['purged']}`);
    if (parts.length > 0) return parts.join(' · ');

    const keys = Object.keys(m).filter((k) => typeof m[k] !== 'object');
    if (keys.length > 0) {
      return keys.slice(0, 2).map((k) => `${k}: ${m[k]}`).join(' · ');
    }
    return '';
  }

  hasMetadata(event: AuditEvent): boolean {
    return !!event.metadata && typeof event.metadata === 'object' && Object.keys(event.metadata).length > 0;
  }

  refreshJobs(): void {
    this.state.loadJobs();
    this.state.showToast('info', 'Pipeline Refreshed', 'Ingestion jobs status updated.');
  }

  refreshAudit(): void {
    this.state.loadAudit();
    this.state.showToast('info', 'Audit Synchronized', 'Tamper-evident event log updated.');
  }

  retry(job: IngestionJob): void {
    this.state.retryJob(job);
  }
}

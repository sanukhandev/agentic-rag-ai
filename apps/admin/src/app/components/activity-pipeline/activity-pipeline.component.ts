import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
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
      <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card" aria-labelledby="pipeline-heading">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <h2 id="pipeline-heading" class="text-base font-semibold text-neutral-900 tracking-tight">
              Ingestion Pipeline Jobs
            </h2>
            <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-mono font-medium text-neutral-600">
              {{ jobs.length }}
            </span>
          </div>
          <button
            type="button"
            (click)="refreshJobs()"
            class="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 transition-colors flex items-center gap-1"
          >
            <app-icon name="refresh" classNames="w-3 h-3 text-neutral-400"></app-icon>
            <span>Sync</span>
          </button>
        </div>
        <p class="mt-1 text-xs text-neutral-500">
          Document parsing, token chunking, and pgvector embeddings calculation.
        </p>

        <!-- Jobs List -->
        <div *ngIf="jobs.length === 0" class="mt-4 rounded-xl border border-dashed border-neutral-200 p-8 text-center">
          <p class="text-xs font-medium text-neutral-500">No active or historical ingestion jobs</p>
          <p class="mt-1 text-[11px] text-neutral-400">Stage or upload source files to trigger the Python parser and embedding worker.</p>
        </div>

        <div *ngIf="jobs.length > 0" class="mt-4 space-y-3">
          <div
            *ngFor="let job of jobs"
            class="group rounded-xl border border-neutral-200/70 p-3.5 hover:border-neutral-300 hover:bg-neutral-50/50 transition-all"
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
                  <div class="mt-1 flex items-center gap-2 text-[11px] text-neutral-400 font-mono">
                    <span>Attempts: {{ job.attempts }}</span>
                    <span>·</span>
                    <span>{{ job.updatedAt | date:'shortTime' }}</span>
                    <span *ngIf="job.chunksIndexed">· {{ job.chunksIndexed }} chunks</span>
                  </div>
                </div>
              </div>

              <!-- Status Badge & Action -->
              <div class="flex items-center gap-2 shrink-0">
                <app-badge
                  [variant]="job.status === 'completed' ? 'success' : job.status === 'processing' ? 'warning' : job.status === 'failed' ? 'error' : 'neutral'"
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
            <div *ngIf="job.errorCode" class="mt-2.5 rounded-lg bg-rose-50/70 border border-rose-200/60 p-2 text-[11px] text-rose-700 font-mono">
              {{ job.errorCode }}
            </div>
          </div>
        </div>
      </section>

      <!-- Audit & Security Activity Feed -->
      <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card" aria-labelledby="audit-heading">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <h2 id="audit-heading" class="text-base font-semibold text-neutral-900 tracking-tight">
              Tenant & Audit Event Stream
            </h2>
            <app-badge variant="neutral" [showDot]="false" text="Immutable"></app-badge>
          </div>
          <button
            type="button"
            (click)="refreshAudit()"
            class="rounded-lg border border-neutral-200 px-2.5 py-1 text-xs text-neutral-700 hover:bg-neutral-50 transition-colors flex items-center gap-1"
          >
            <app-icon name="refresh" classNames="w-3 h-3 text-neutral-400"></app-icon>
            <span>Sync</span>
          </button>
        </div>
        <p class="mt-1 text-xs text-neutral-500">
          Chained tamper-evident log of publish approvals, persona updates, and origin verifications.
        </p>

        <!-- Events List -->
        <div *ngIf="auditEvents.length === 0" class="mt-4 rounded-xl border border-dashed border-neutral-200 p-8 text-center">
          <p class="text-xs font-medium text-neutral-500">No audit events recorded yet</p>
          <p class="mt-1 text-[11px] text-neutral-400">Tenant lifecycle, persona publishing, and source approvals are cryptographically tracked here.</p>
        </div>

        <div *ngIf="auditEvents.length > 0" class="mt-4 space-y-3">
          <div
            *ngFor="let event of auditEvents"
            class="rounded-xl border border-neutral-100 bg-[#fdfdfd] p-3 text-xs space-y-1.5"
          >
            <div class="flex items-center justify-between">
              <span class="font-mono text-xs font-semibold text-neutral-900">
                {{ event.eventName }}
              </span>
              <span class="text-[11px] text-neutral-400 font-mono">
                {{ event.createdAt | date:'shortTime' }}
              </span>
            </div>
            
            <p class="text-[11px] text-neutral-500 flex items-center gap-2">
              <span class="text-neutral-700 font-medium">{{ event.actorEmail || 'System Process' }}</span>
              <span *ngIf="event.ip" class="text-neutral-400 font-mono">({{ event.ip }})</span>
            </p>

            <div class="rounded bg-neutral-100/70 p-1.5 text-[10px] font-mono text-neutral-600 break-all">
              {{ event.metadata | json }}
            </div>
          </div>
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

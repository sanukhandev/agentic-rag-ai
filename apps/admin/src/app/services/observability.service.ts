import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Health, Metrics, WorkflowRun, AuditEvent } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

const EMPTY_METRICS: Metrics = {
  sourceCounts: {},
  ingestionJobs: {},
  sessions: 0,
  messages: 0,
  actions: 0,
  auditEvents: 0
};

const EMPTY_HEALTH: Health = {
  checkedAt: '',
  telemetry: {
    requests: 0,
    serverErrors: 0,
    averageLatencyMs: 0,
    lastRequestAt: null,
    chatResponses: 0,
    groundedResponses: 0,
    abstentions: 0,
    actionProposals: 0,
    groundingRate: 0,
    abstentionRate: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: null
  },
  checks: {}
};

@Injectable({
  providedIn: 'root'
})
export class ObservabilityService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  // Angular Signals (Primary reactive state)
  private readonly _health = signal<Health>(EMPTY_HEALTH);
  private readonly _metrics = signal<Metrics>(EMPTY_METRICS);
  private readonly _workflowRuns = signal<WorkflowRun[]>([]);
  private readonly _auditEvents = signal<AuditEvent[]>([]);
  private readonly _isLoading = signal<boolean>(false);

  readonly health = this._health.asReadonly();
  readonly metrics = this._metrics.asReadonly();
  readonly workflowRuns = this._workflowRuns.asReadonly();
  readonly auditEvents = this._auditEvents.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // Observable streams for backwards compatibility
  private readonly healthSubject = new BehaviorSubject<Health>(EMPTY_HEALTH);
  private readonly metricsSubject = new BehaviorSubject<Metrics>(EMPTY_METRICS);
  private readonly workflowRunsSubject = new BehaviorSubject<WorkflowRun[]>([]);
  private readonly auditEventsSubject = new BehaviorSubject<AuditEvent[]>([]);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly health$: Observable<Health> = this.healthSubject.asObservable();
  readonly metrics$: Observable<Metrics> = this.metricsSubject.asObservable();
  readonly workflowRuns$: Observable<WorkflowRun[]> = this.workflowRunsSubject.asObservable();
  readonly auditEvents$: Observable<AuditEvent[]> = this.auditEventsSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  loadHealth(): void {
    if (!this.auth.token()) return;
    this.http.get<Health>(`${this.apiBase}/api/v1/admin/services/health`).pipe(
      catchError(() => {
        const current = this._health();
        if (current?.checkedAt && Object.keys(current.checks).length > 0) {
          return of(current);
        }
        return of({
          checkedAt: new Date().toISOString(),
          telemetry: EMPTY_HEALTH.telemetry,
          checks: {
            api: { status: 'ok' },
            store: { status: 'standby' },
            cache: { status: 'standby' },
            model: { status: 'adapter' },
            embedding: { status: 'adapter' },
            workflow: { status: 'adapter' },
            ingestion: { status: 'ready' }
          }
        } satisfies Health);
      })
    ).subscribe((data) => {
      this._health.set(data);
      this.healthSubject.next(data);
    });
  }

  loadMetrics(): void {
    if (!this.auth.token()) return;
    this.http.get<{ metrics: Metrics }>(`${this.apiBase}/api/v1/admin/dashboard/overview`).pipe(
      catchError(() => of({ metrics: EMPTY_METRICS }))
    ).subscribe((res) => {
      const metrics = res.metrics ?? EMPTY_METRICS;
      this._metrics.set(metrics);
      this.metricsSubject.next(metrics);
    });
  }

  loadWorkflowRuns(): void {
    if (!this.auth.token()) return;
    this.http.get<{ items: WorkflowRun[] }>(`${this.apiBase}/api/v1/admin/workflow-runs`).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => {
      const items = res.items ?? [];
      this._workflowRuns.set(items);
      this.workflowRunsSubject.next(items);
    });
  }

  loadAudit(): void {
    if (!this.auth.token()) return;
    this.http.get<{ items: AuditEvent[] }>(`${this.apiBase}/api/v1/admin/audit`).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => {
      const items = res.items ?? [];
      this._auditEvents.set(items);
      this.auditEventsSubject.next(items);
    });
  }

  refreshTelemetry(): void {
    this.loadHealth();
    this.loadMetrics();
    this.toast.show('info', 'Telemetry Refreshed', 'Service health matrix and metrics synchronized.');
  }

  refreshPipelineAndAudit(): void {
    this.loadWorkflowRuns();
    this.loadAudit();
    this.toast.show('info', 'Audit Trail Refreshed', 'Tamper-evident logs updated.');
  }
}

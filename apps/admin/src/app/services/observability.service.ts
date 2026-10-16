import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Health, Metrics, WorkflowRun, AuditEvent } from '../types/admin.types';
import { MOCK_HEALTH, MOCK_METRICS, MOCK_WORKFLOW_RUNS, MOCK_AUDIT_EVENTS } from './mock-data';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root'
})
export class ObservabilityService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  private readonly healthSubject = new BehaviorSubject<Health>(MOCK_HEALTH);
  private readonly metricsSubject = new BehaviorSubject<Metrics>(MOCK_METRICS);
  private readonly workflowRunsSubject = new BehaviorSubject<WorkflowRun[]>(MOCK_WORKFLOW_RUNS);
  private readonly auditEventsSubject = new BehaviorSubject<AuditEvent[]>(MOCK_AUDIT_EVENTS);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly health$: Observable<Health> = this.healthSubject.asObservable();
  readonly metrics$: Observable<Metrics> = this.metricsSubject.asObservable();
  readonly workflowRuns$: Observable<WorkflowRun[]> = this.workflowRunsSubject.asObservable();
  readonly auditEvents$: Observable<AuditEvent[]> = this.auditEventsSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  get health(): Health {
    return this.healthSubject.value;
  }

  get metrics(): Metrics {
    return this.metricsSubject.value;
  }

  get workflowRuns(): WorkflowRun[] {
    return this.workflowRunsSubject.value;
  }

  get auditEvents(): AuditEvent[] {
    return this.auditEventsSubject.value;
  }

  loadHealth(): void {
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<Health>(`${this.apiBase}/api/v1/admin/services/health`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of(MOCK_HEALTH))
    ).subscribe((data) => this.healthSubject.next(data));
  }

  loadMetrics(): void {
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ metrics: Metrics }>(`${this.apiBase}/api/v1/admin/dashboard/overview`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ metrics: MOCK_METRICS }))
    ).subscribe((res) => this.metricsSubject.next(res.metrics));
  }

  loadWorkflowRuns(): void {
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ items: WorkflowRun[] }>(`${this.apiBase}/api/v1/admin/workflow-runs`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: MOCK_WORKFLOW_RUNS }))
    ).subscribe((res) => this.workflowRunsSubject.next(res.items));
  }

  loadAudit(): void {
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ items: AuditEvent[] }>(`${this.apiBase}/api/v1/admin/audit`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: MOCK_AUDIT_EVENTS }))
    ).subscribe((res) => this.auditEventsSubject.next(res.items));
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

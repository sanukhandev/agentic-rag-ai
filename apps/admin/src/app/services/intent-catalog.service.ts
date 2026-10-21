import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of, switchMap, takeWhile, timer } from 'rxjs';
import { IngestionJob, IntentCatalogVersion } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { isCatalogJobPending } from './intent-catalog-utils';
import { apiErrorMessage } from './api-error';

const CATALOG_MIME_TYPE = 'application/vnd.agentic.intent-catalog+excel';

@Injectable({ providedIn: 'root' })
export class IntentCatalogService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly versionsSubject = new BehaviorSubject<IntentCatalogVersion[]>([]);
  private readonly catalogJobSubject = new BehaviorSubject<IngestionJob | null>(null);
  private readonly catalogErrorSubject = new BehaviorSubject<string | null>(null);
  private watchedJobId: string | null = null;
  readonly versions$: Observable<IntentCatalogVersion[]> = this.versionsSubject.asObservable();
  readonly catalogJob$: Observable<IngestionJob | null> = this.catalogJobSubject.asObservable();
  readonly catalogError$: Observable<string | null> = this.catalogErrorSubject.asObservable();

  load(): void {
    if (!this.auth.token) return;
    this.catalogErrorSubject.next(null);
    this.http.get<{ items: IntentCatalogVersion[] }>(`${this.apiBase}/api/v1/admin/intent-catalog/versions`, { headers: this.auth.authHeaders }).pipe(catchError((error) => {
      const message = apiErrorMessage(error, 'Could not load the intent catalog.');
      this.catalogErrorSubject.next(message);
      this.toast.show('error', 'Intent catalog unavailable', message);
      return of({ items: [] });
    })).subscribe((response) => this.versionsSubject.next(response.items ?? []));
  }

  resumePendingJob(): void {
    if (!this.auth.token || this.watchedJobId) return;
    this.http.get<{ items: IngestionJob[] }>(`${this.apiBase}/api/v1/admin/ingestion-jobs`, { headers: this.auth.authHeaders }).pipe(catchError((error) => {
      const message = apiErrorMessage(error, 'Could not load catalog ingestion jobs.');
      this.catalogErrorSubject.next(message);
      this.toast.show('error', 'Catalog status unavailable', message);
      return of({ items: [] });
    })).subscribe(({ items }) => {
      const job = (items ?? [])
        .filter((candidate) => candidate.mimeType === CATALOG_MIME_TYPE)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
      if (job && isCatalogJobPending(job.status)) {
        this.catalogJobSubject.next(job);
        this.watchJob(job.id);
      } else if (job?.status === 'failed') {
        this.catalogJobSubject.next(job);
      }
    });
  }

  upload(file: File): void {
    if (!this.auth.token) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',', 2)[1] : '';
      this.http.post<{ job: IngestionJob }>(`${this.apiBase}/api/v1/admin/intent-catalog/upload`, { fileName: file.name, contentBase64: result }, { headers: this.auth.authHeaders }).subscribe({
        next: ({ job }) => {
          this.catalogJobSubject.next(job);
          this.load();
          this.toast.show('success', 'Catalog queued', 'The Python worker is validating the workbook. This page will refresh when the draft is ready.');
          this.watchJob(job.id);
        },
        error: (error) => this.toast.show('error', 'Catalog upload failed', apiErrorMessage(error, 'Could not upload the workbook.'))
      });
    };
    reader.onerror = () => this.toast.show('error', 'Catalog upload failed', 'The workbook could not be read.');
    reader.readAsDataURL(file);
  }

  private watchJob(jobId: string): void {
    if (this.watchedJobId === jobId) return;
    this.watchedJobId = jobId;
    timer(0, 2000).pipe(
      switchMap(() => this.http.get<{ job: IngestionJob }>(`${this.apiBase}/api/v1/admin/ingestion-jobs/${jobId}`, { headers: this.auth.authHeaders })),
      takeWhile(({ job }) => isCatalogJobPending(job.status), true),
      catchError((error) => {
        this.catalogJobSubject.next(null);
        const message = apiErrorMessage(error, 'Could not check the catalog ingestion status.');
        this.catalogErrorSubject.next(message);
        this.toast.show('error', 'Catalog status unavailable', message);
        return of(null);
      })
    ).subscribe({
      next: (response) => {
        if (!response) return;
        const { job } = response;
        if (isCatalogJobPending(job.status)) {
          this.catalogJobSubject.next(job);
          return;
        }
        if (job.status === 'completed') {
          this.catalogJobSubject.next(null);
          this.load();
          this.toast.show('success', 'Catalog imported', 'The validated draft is now available for review.');
        } else {
          this.catalogJobSubject.next(job);
          this.toast.show('error', 'Catalog import failed', job.errorCode || 'The workbook could not be imported.');
        }
      },
      complete: () => { if (this.watchedJobId === jobId) this.watchedJobId = null; }
    });
  }

  publish(version: IntentCatalogVersion): void {
    if (!this.auth.token) return;
    this.http.post(`${this.apiBase}/api/v1/admin/intent-catalog/versions/${version.id}/publish`, {}, { headers: this.auth.authHeaders }).subscribe({
      next: () => { this.load(); this.toast.show('success', 'Catalog published', `Intent catalog v${version.version} is now active.`); },
      error: (error) => this.toast.show('error', 'Publish failed', apiErrorMessage(error, 'Could not publish the catalog.'))
    });
  }

  saveDraft(version: IntentCatalogVersion, catalog: unknown, onSaved: () => void): void {
    if (!this.auth.token) return;
    this.http.post<{ version: IntentCatalogVersion }>(`${this.apiBase}/api/v1/admin/intent-catalog/versions/${version.id}/drafts`, { catalog }, { headers: this.auth.authHeaders }).subscribe({
      next: () => { this.load(); onSaved(); this.toast.show('success', 'Catalog draft saved', 'Review the new draft, then publish it when ready.'); },
      error: (error) => this.toast.show('error', 'Catalog edit failed', apiErrorMessage(error, 'Could not save the catalog draft.'))
    });
  }
}

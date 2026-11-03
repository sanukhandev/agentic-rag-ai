import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of, switchMap, takeWhile, timer } from 'rxjs';
import { IngestionJob, IntentCatalogVersion, IntentCatalogV2Version } from '../types/admin.types';
import { apiErrorMessage } from './api-error';
import { AuthService } from './auth.service';
import { isCatalogJobPending } from './intent-catalog-utils';
import { ToastService } from './toast.service';
import { API_BASE_URL } from './tokens';

export const CATALOG_MIME_TYPE = 'application/vnd.agentic.intent-catalog+excel';

@Injectable({ providedIn: 'root' })
export class IntentCatalogService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  // Angular Signals (Primary reactive state)
  private readonly _versions = signal<IntentCatalogVersion[]>([]);
  private readonly _v2Versions = signal<IntentCatalogV2Version[]>([]);
  private readonly _v2CatalogError = signal<string | null>(null);
  private v2LoadRevision = 0;
  private readonly _catalogJob = signal<IngestionJob | null>(null);
  private readonly _catalogError = signal<string | null>(null);
  private watchedJobId: string | null = null;

  readonly versions = this._versions.asReadonly();
  readonly v2Versions = this._v2Versions.asReadonly();
  readonly v2CatalogError = this._v2CatalogError.asReadonly();
  readonly catalogJob = this._catalogJob.asReadonly();
  readonly catalogError = this._catalogError.asReadonly();

  // Observable streams for backwards compatibility
  private readonly versionsSubject = new BehaviorSubject<IntentCatalogVersion[]>([]);
  private readonly catalogJobSubject = new BehaviorSubject<IngestionJob | null>(null);
  private readonly catalogErrorSubject = new BehaviorSubject<string | null>(null);

  readonly versions$: Observable<IntentCatalogVersion[]> = this.versionsSubject.asObservable();
  readonly catalogJob$: Observable<IngestionJob | null> = this.catalogJobSubject.asObservable();
  readonly catalogError$: Observable<string | null> = this.catalogErrorSubject.asObservable();

  load(): void {
    if (!this.auth.token()) return;
    this.loadV2();
    this._catalogError.set(null);
    this.catalogErrorSubject.next(null);

    this.http.get<{ items: IntentCatalogVersion[] }>(`${this.apiBase}/api/v1/admin/intent-catalog/versions`).pipe(catchError((error) => {
      const message = apiErrorMessage(error, 'Could not load the intent catalog.');
      this._catalogError.set(message);
      this.catalogErrorSubject.next(message);
      this.toast.show('error', 'Intent catalog unavailable', message);
      return of({ items: [] });
    })).subscribe((response) => {
      const items = response.items ?? [];
      this._versions.set(items);
      this.versionsSubject.next(items);
    });
  }

  /** V2 versions live in a separate tenant-scoped API and database table. */
  loadV2(): void {
    if (!this.auth.token()) return;
    const revision = ++this.v2LoadRevision;
    this._v2CatalogError.set(null);
    this._v2Versions.set([]);
    this.http.get<{ items: IntentCatalogV2Version[] }>(`${this.apiBase}/api/v2/admin/intent-catalog/versions`).subscribe({
      next: ({ items }) => {
        if (revision !== this.v2LoadRevision) return;
        this._v2Versions.set(items ?? []);
      },
      error: (error) => {
        if (revision !== this.v2LoadRevision) return;
        const message = apiErrorMessage(error, 'Could not load V2 intent catalog versions.');
        this._v2CatalogError.set(message);
        this.toast.show('error', 'V2 catalog unavailable', message);
      }
    });
  }

  publishV2(version: IntentCatalogV2Version): void {
    if (!this.auth.token()) return;
    this.http.post(
      `${this.apiBase}/api/v2/admin/intent-catalog/versions/${version.id}/publish`, {}
    ).subscribe({
      next: () => {
        this.loadV2();
        this.toast.show('success', 'V2 catalog published', `V2 catalog version ${version.version} is now active.`);
      },
      error: (error) => this.toast.show('error', 'V2 publish failed', apiErrorMessage(error, 'Could not publish the V2 catalog.'))
    });
  }

  exportPublishedV2(): Observable<Blob> {
    return this.http.get(`${this.apiBase}/api/v2/admin/intent-catalog/published/export`, { responseType: 'blob' });
  }

  resumePendingJob(): void {
    if (!this.auth.token() || this.watchedJobId) return;
    this.http.get<{ items: IngestionJob[] }>(`${this.apiBase}/api/v1/admin/ingestion-jobs`).pipe(catchError((error) => {
      const message = apiErrorMessage(error, 'Could not load catalog ingestion jobs.');
      this._catalogError.set(message);
      this.catalogErrorSubject.next(message);
      this.toast.show('error', 'Catalog status unavailable', message);
      return of({ items: [] });
    })).subscribe(({ items }) => {
      const job = (items ?? [])
        .filter((candidate) => candidate.mimeType === CATALOG_MIME_TYPE)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
      if (job && isCatalogJobPending(job.status)) {
        this._catalogJob.set(job);
        this.catalogJobSubject.next(job);
        this.watchJob(job.id);
      } else if (job?.status === 'failed') {
        this._catalogJob.set(job);
        this.catalogJobSubject.next(job);
      }
    });
  }

  upload(file: File): void {
    if (!this.auth.token()) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',', 2)[1] : '';
      this.http.post<{ job: IngestionJob }>(`${this.apiBase}/api/v1/admin/intent-catalog/upload`, { fileName: file.name, contentBase64: result }).subscribe({
        next: ({ job }) => {
          this._catalogJob.set(job);
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
      switchMap(() => this.http.get<{ job: IngestionJob }>(`${this.apiBase}/api/v1/admin/ingestion-jobs/${jobId}`)),
      takeWhile(({ job }) => isCatalogJobPending(job.status), true),
      catchError((error) => {
        this._catalogJob.set(null);
        this.catalogJobSubject.next(null);
        const message = apiErrorMessage(error, 'Could not check the catalog ingestion status.');
        this._catalogError.set(message);
        this.catalogErrorSubject.next(message);
        this.toast.show('error', 'Catalog status unavailable', message);
        return of(null);
      })
    ).subscribe({
      next: (response) => {
        if (!response) return;
        const { job } = response;
        if (isCatalogJobPending(job.status)) {
          this._catalogJob.set(job);
          this.catalogJobSubject.next(job);
          return;
        }
        if (job.status === 'completed') {
          this._catalogJob.set(null);
          this.catalogJobSubject.next(null);
          this.load();
          this.toast.show('success', 'Catalog imported', 'The validated draft is now available for review.');
        } else {
          this._catalogJob.set(job);
          this.catalogJobSubject.next(job);
          this.toast.show('error', 'Catalog import failed', job.errorCode || 'The workbook could not be imported.');
        }
      },
      complete: () => { if (this.watchedJobId === jobId) this.watchedJobId = null; }
    });
  }

  publish(version: IntentCatalogVersion): void {
    if (!this.auth.token()) return;
    this.http.post(`${this.apiBase}/api/v1/admin/intent-catalog/versions/${version.id}/publish`, {}).subscribe({
      next: () => { this.load(); this.toast.show('success', 'Catalog published', `Intent catalog v${version.version} is now active.`); },
      error: (error) => this.toast.show('error', 'Publish failed', apiErrorMessage(error, 'Could not publish the catalog.'))
    });
  }

  exportPublished(): Observable<Blob> {
    return this.http.get(`${this.apiBase}/api/v1/admin/intent-catalog/published/export`, { responseType: 'blob' });
  }

  saveDraft(version: IntentCatalogVersion, catalog: unknown, onSaved: () => void): void {
    if (!this.auth.token()) return;
    this.http.post<{ version: IntentCatalogVersion }>(`${this.apiBase}/api/v1/admin/intent-catalog/versions/${version.id}/drafts`, { catalog }).subscribe({
      next: () => { this.load(); onSaved(); this.toast.show('success', 'Catalog draft saved', 'Review the new draft, then publish it when ready.'); },
      error: (error) => this.toast.show('error', 'Catalog edit failed', apiErrorMessage(error, 'Could not save the catalog draft.'))
    });
  }
}

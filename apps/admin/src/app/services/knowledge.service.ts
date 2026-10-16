import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Source, IngestionJob, SourceAudience } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root'
})
export class KnowledgeService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  private readonly sourcesSubject = new BehaviorSubject<Source[]>([]);
  private readonly jobsSubject = new BehaviorSubject<IngestionJob[]>([]);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly sources$: Observable<Source[]> = this.sourcesSubject.asObservable();
  readonly jobs$: Observable<IngestionJob[]> = this.jobsSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  get sources(): Source[] {
    return this.sourcesSubject.value;
  }

  get jobs(): IngestionJob[] {
    return this.jobsSubject.value;
  }

  loadSources(): void {
    if (!this.auth.token) return;
    this.http.get<{ items: Source[] }>(`${this.apiBase}/api/v1/admin/sources`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => this.sourcesSubject.next(res.items ?? []));
  }

  loadJobs(): void {
    if (!this.auth.token) return;
    this.http.get<{ items: IngestionJob[] }>(`${this.apiBase}/api/v1/admin/ingestion-jobs`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => this.jobsSubject.next(res.items ?? []));
  }

  stageSource(title: string, audience: SourceAudience, content: string, onComplete?: () => void): void {
    if (!this.auth.token) return;

    this.http.post(`${this.apiBase}/api/v1/admin/sources`, { title, mimeType: 'text/plain', audience, content }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.loadJobs();
        this.toast.show('success', 'Source Staged', `${title} staged for review.`);
        if (onComplete) onComplete();
      },
      error: () => this.toast.show('error', 'Staging Failed', 'Could not stage source.')
    });
  }

  publishSource(source: Source, onComplete?: () => void): void {
    if (!this.auth.token) return;

    this.http.post(`${this.apiBase}/api/v1/admin/sources/${source.id}/publish`, {}, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.toast.show('success', 'Source Published', `${source.title} is now active.`);
        onComplete?.();
      },
      error: () => this.toast.show('error', 'Publish Failed', 'Failed to publish source.')
    });
  }

  revokeSource(source: Source, onComplete?: () => void): void {
    if (!this.auth.token) return;

    this.http.post(`${this.apiBase}/api/v1/admin/sources/${source.id}/revoke`, {}, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.toast.show('warning', 'Source Revoked', `${source.title} has been revoked.`);
        onComplete?.();
      },
      error: () => this.toast.show('error', 'Revoke Failed', 'Failed to revoke source.')
    });
  }

  purgeSource(source: Source, onComplete?: () => void): void {
    if (!this.auth.token) return;

    this.http.delete(`${this.apiBase}/api/v1/admin/sources/${source.id}`, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.toast.show('info', 'Source Purged', `${source.title} deleted.`);
        onComplete?.();
      },
      error: () => this.toast.show('error', 'Purge Failed', 'Only revoked sources can be purged.')
    });
  }

  reindexSource(source: Source): void {
    if (!this.auth.token) return;

    this.http.post(`${this.apiBase}/api/v1/admin/sources/${source.id}/reindex`, {}, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.loadJobs();
        this.toast.show('info', 'Reindexing Queued', `${source.title} scheduled for recalculation.`);
      },
      error: () => this.toast.show('error', 'Reindex Failed', 'Could not queue reindexing.')
    });
  }

  retryJob(job: IngestionJob): void {
    if (!this.auth.token) return;

    this.http.post(`${this.apiBase}/api/v1/admin/ingestion-jobs/${job.id}/retry`, {}, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadJobs();
        this.toast.show('info', 'Job Retried', `Retry triggered for ${job.title}`);
      },
      error: () => this.toast.show('error', 'Retry Failed', 'Only failed jobs can be retried.')
    });
  }

  queueFileUpload(title: string, fileName: string, mimeType: string, audience: SourceAudience, contentBase64: string, onComplete?: () => void): void {
    if (!this.auth.token) return;
    this.http.post<{ job: IngestionJob }>(`${this.apiBase}/api/v1/admin/sources/upload`, { title, fileName, mimeType, audience, contentBase64 }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.loadJobs();
        this.toast.show('success', 'File Ingestion Queued', `${title} submitted to the Python worker.`);
        onComplete?.();
      },
      error: (err) => this.toast.show('error', 'Upload Failed', err.error?.error?.message || 'Could not queue file ingestion.')
    });
  }

  queueCrawl(title: string, url: string, onComplete?: () => void): void {
    if (!this.auth.token) return;
    this.http.post<{ job: IngestionJob }>(`${this.apiBase}/api/v1/admin/ingestion-jobs`, { title, sourceUrl: url, mimeType: 'text/html', audience: 'public' }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadJobs();
        this.toast.show('success', 'URL Crawl Queued', `Crawling approved URL ${url}.`);
        onComplete?.();
      },
      error: (err) => this.toast.show('error', 'Crawl Failed', err.error?.error?.message || 'Could not queue URL crawl.')
    });
  }
}

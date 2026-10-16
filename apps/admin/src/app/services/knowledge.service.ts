import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Source, IngestionJob, SourceAudience } from '../types/admin.types';
import { MOCK_SOURCES, MOCK_JOBS } from './mock-data';
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

  private readonly sourcesSubject = new BehaviorSubject<Source[]>(MOCK_SOURCES);
  private readonly jobsSubject = new BehaviorSubject<IngestionJob[]>(MOCK_JOBS);
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
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ items: Source[] }>(`${this.apiBase}/api/v1/admin/sources`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: MOCK_SOURCES }))
    ).subscribe((res) => this.sourcesSubject.next(res.items));
  }

  loadJobs(): void {
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ items: IngestionJob[] }>(`${this.apiBase}/api/v1/admin/ingestion-jobs`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: MOCK_JOBS }))
    ).subscribe((res) => this.jobsSubject.next(res.items));
  }

  stageSource(title: string, audience: SourceAudience, content: string, onComplete?: () => void): void {
    if (this.auth.isMockMode) {
      const newSource: Source = {
        id: `src-${Math.random().toString(36).substring(2, 6)}`,
        title,
        audience,
        status: 'awaiting_review',
        mimeType: 'text/plain',
        chunkCount: Math.ceil(content.length / 500),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sizeBytes: content.length
      };
      this.sourcesSubject.next([newSource, ...this.sourcesSubject.value]);
      this.toast.show('success', 'Source Staged', `${title} staged for review.`);
      if (onComplete) onComplete();
      return;
    }

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

  publishSource(source: Source): void {
    if (this.auth.isMockMode) {
      const updated = this.sourcesSubject.value.map((s) => (s.id === source.id ? { ...s, status: 'active' as const } : s));
      this.sourcesSubject.next(updated);
      this.toast.show('success', 'Source Published', `${source.title} is now active and retrievable.`);
      return;
    }

    this.http.post(`${this.apiBase}/api/v1/admin/sources/${source.id}/publish`, {}, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.toast.show('success', 'Source Published', `${source.title} is now active.`);
      },
      error: () => this.toast.show('error', 'Publish Failed', 'Failed to publish source.')
    });
  }

  revokeSource(source: Source): void {
    if (this.auth.isMockMode) {
      const updated = this.sourcesSubject.value.map((s) => (s.id === source.id ? { ...s, status: 'revoked' as const } : s));
      this.sourcesSubject.next(updated);
      this.toast.show('warning', 'Source Revoked', `${source.title} has been revoked.`);
      return;
    }

    this.http.post(`${this.apiBase}/api/v1/admin/sources/${source.id}/revoke`, {}, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.toast.show('warning', 'Source Revoked', `${source.title} has been revoked.`);
      },
      error: () => this.toast.show('error', 'Revoke Failed', 'Failed to revoke source.')
    });
  }

  purgeSource(source: Source): void {
    if (this.auth.isMockMode) {
      const updated = this.sourcesSubject.value.filter((s) => s.id !== source.id);
      this.sourcesSubject.next(updated);
      this.toast.show('info', 'Source Purged', `${source.title} deleted permanently.`);
      return;
    }

    this.http.delete(`${this.apiBase}/api/v1/admin/sources/${source.id}`, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadSources();
        this.toast.show('info', 'Source Purged', `${source.title} deleted.`);
      },
      error: () => this.toast.show('error', 'Purge Failed', 'Only revoked sources can be purged.')
    });
  }

  reindexSource(source: Source): void {
    if (this.auth.isMockMode) {
      this.toast.show('info', 'Reindexing Queued', `${source.title} scheduled for vector recalculation.`);
      return;
    }

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
    if (this.auth.isMockMode) {
      const updated = this.jobsSubject.value.map((j) => (j.id === job.id ? { ...j, status: 'processing' as const, attempts: j.attempts + 1, errorCode: null } : j));
      this.jobsSubject.next(updated);
      this.toast.show('info', 'Job Retried', `Retrying ingestion for ${job.title}...`);

      setTimeout(() => {
        this.jobsSubject.next(
          this.jobsSubject.value.map((j) => (j.id === job.id ? { ...j, status: 'completed' as const, chunksIndexed: 62 } : j))
        );
      }, 1500);
      return;
    }

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

  queueOptimisticUpload(title: string, mime: string, audience: SourceAudience, chunks = 84): void {
    const fakeJobId = `job-${Math.random().toString(36).substring(2, 6)}`;
    const newJob: IngestionJob = {
      id: fakeJobId,
      title,
      sourceUrl: null,
      status: 'processing',
      attempts: 1,
      errorCode: null,
      updatedAt: new Date().toISOString(),
      mimeType: mime
    };
    this.jobsSubject.next([newJob, ...this.jobsSubject.value]);
    this.toast.show('success', 'File Ingestion Queued', `${title} submitted to Python worker.`);

    setTimeout(() => {
      this.jobsSubject.next(
        this.jobsSubject.value.map((j) => (j.id === fakeJobId ? { ...j, status: 'completed' as const, chunksIndexed: chunks } : j))
      );
      this.sourcesSubject.next([
        {
          id: `src-${Math.random().toString(36).substring(2, 6)}`,
          title,
          status: 'awaiting_review',
          audience,
          mimeType: mime,
          chunkCount: chunks,
          createdAt: new Date().toISOString()
        },
        ...this.sourcesSubject.value
      ]);
      this.toast.show('info', 'Document Ready for Review', `${title} chunked into ${chunks} vectors.`);
    }, 2000);
  }

  queueOptimisticCrawl(title: string, url: string): void {
    const fakeJobId = `job-${Math.random().toString(36).substring(2, 6)}`;
    const newJob: IngestionJob = {
      id: fakeJobId,
      title,
      sourceUrl: url,
      status: 'processing',
      attempts: 1,
      errorCode: null,
      updatedAt: new Date().toISOString(),
      mimeType: 'text/html'
    };
    this.jobsSubject.next([newJob, ...this.jobsSubject.value]);
    this.toast.show('success', 'URL Crawl Queued', `Crawling snapshot for ${url}`);

    setTimeout(() => {
      this.jobsSubject.next(
        this.jobsSubject.value.map((j) => (j.id === fakeJobId ? { ...j, status: 'completed' as const, chunksIndexed: 35 } : j))
      );
      this.sourcesSubject.next([
        {
          id: `src-${Math.random().toString(36).substring(2, 6)}`,
          title: `Snapshot: ${url}`,
          status: 'awaiting_review',
          audience: 'public',
          mimeType: 'text/html',
          chunkCount: 35,
          createdAt: new Date().toISOString()
        },
        ...this.sourcesSubject.value
      ]);
    }, 2000);
  }
}

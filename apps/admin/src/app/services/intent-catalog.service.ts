import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { IntentCatalogVersion } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class IntentCatalogService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly versionsSubject = new BehaviorSubject<IntentCatalogVersion[]>([]);
  readonly versions$: Observable<IntentCatalogVersion[]> = this.versionsSubject.asObservable();

  load(): void {
    if (!this.auth.token) return;
    this.http.get<{ items: IntentCatalogVersion[] }>(`${this.apiBase}/api/v1/admin/intent-catalog/versions`, { headers: this.auth.authHeaders }).pipe(catchError(() => of({ items: [] }))).subscribe((response) => this.versionsSubject.next(response.items ?? []));
  }

  upload(file: File): void {
    if (!this.auth.token) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result.split(',', 2)[1] : '';
      this.http.post(`${this.apiBase}/api/v1/admin/intent-catalog/upload`, { fileName: file.name, contentBase64: result }, { headers: this.auth.authHeaders }).subscribe({
        next: () => { this.toast.show('success', 'Catalog queued', 'The Python worker is validating the workbook. Refresh shortly to review the draft.'); },
        error: (error) => this.toast.show('error', 'Catalog upload failed', error.error?.error?.message || 'Could not upload the workbook.')
      });
    };
    reader.onerror = () => this.toast.show('error', 'Catalog upload failed', 'The workbook could not be read.');
    reader.readAsDataURL(file);
  }

  publish(version: IntentCatalogVersion): void {
    if (!this.auth.token) return;
    this.http.post(`${this.apiBase}/api/v1/admin/intent-catalog/versions/${version.id}/publish`, {}, { headers: this.auth.authHeaders }).subscribe({
      next: () => { this.load(); this.toast.show('success', 'Catalog published', `Intent catalog v${version.version} is now active.`); },
      error: (error) => this.toast.show('error', 'Publish failed', error.error?.error?.message || 'Could not publish the catalog.')
    });
  }
}

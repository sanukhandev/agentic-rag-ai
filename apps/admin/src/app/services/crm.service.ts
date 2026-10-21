import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { CrmLead } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class CrmService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly leadsSubject = new BehaviorSubject<CrmLead[]>([]);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly leads$: Observable<CrmLead[]> = this.leadsSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  get leads(): CrmLead[] { return this.leadsSubject.value; }

  loadLeads(): void {
    if (!this.auth.token) return;
    this.isLoadingSubject.next(true);
    this.http.get<{ items: CrmLead[] }>(`${this.apiBase}/api/v1/admin/crm/leads`, { headers: this.auth.authHeaders }).pipe(
      catchError(() => of({ items: [] })),
    ).subscribe((response) => {
      this.leadsSubject.next(response.items ?? []);
      this.isLoadingSubject.next(false);
    });
  }

  downloadDocument(documentId: string): Observable<Blob> {
    return this.http.get(`${this.apiBase}/api/v1/admin/crm/documents/${documentId}/download`, { headers: this.auth.authHeaders, responseType: 'blob' });
  }
}

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { CrmLead } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { apiErrorMessage } from './api-error';

@Injectable({ providedIn: 'root' })
export class CrmService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  // Angular Signals (Primary reactive state)
  private readonly _leads = signal<CrmLead[]>([]);
  private readonly _isLoading = signal<boolean>(false);

  readonly leads = this._leads.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // Observable streams for backwards compatibility
  private readonly leadsSubject = new BehaviorSubject<CrmLead[]>([]);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly leads$: Observable<CrmLead[]> = this.leadsSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  loadLeads(silent = false): void {
    if (!this.auth.token()) return;
    if (!silent) {
      this._isLoading.set(true);
      this.isLoadingSubject.next(true);
    }
    this.http.get<{ items: CrmLead[] }>(`${this.apiBase}/api/v1/admin/crm/leads`).pipe(
      catchError((error) => {
        if (!silent) this.toast.show('error', 'Leads unavailable', apiErrorMessage(error, 'Could not load CRM leads.'));
        return of({ items: this._leads() });
      }),
    ).subscribe((response) => {
      const items = response.items ?? [];
      this._leads.set(items);
      this.leadsSubject.next(items);
      if (!silent) {
        this._isLoading.set(false);
        this.isLoadingSubject.next(false);
      }
    });
  }

  updateLead(lead: CrmLead): void {
    const updated = this._leads().map((item) => (item.id === lead.id ? lead : item));
    this._leads.set(updated);
    this.leadsSubject.next(updated);
  }

  downloadDocument(documentId: string): Observable<Blob> {
    return this.http.get(`${this.apiBase}/api/v1/admin/crm/documents/${documentId}/download`, { responseType: 'blob' });
  }

  summarizeLead(leadId: string): Observable<{ lead: CrmLead; aiGenerated: boolean }> {
    return this.http.post<{ lead: CrmLead; aiGenerated: boolean }>(`${this.apiBase}/api/v1/admin/crm/leads/${leadId}/summarize`, {});
  }
}

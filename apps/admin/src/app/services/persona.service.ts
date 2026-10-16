import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Persona, PersonaVersion } from '../types/admin.types';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

const EMPTY_PERSONA: Persona = {
  name: '',
  greeting: '',
  personality: '',
  tone: '',
  speakingStyle: '',
  permittedLanguages: []
};

@Injectable({
  providedIn: 'root'
})
export class PersonaService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  private readonly personaSubject = new BehaviorSubject<Persona>(EMPTY_PERSONA);
  private readonly personaVersionsSubject = new BehaviorSubject<PersonaVersion[]>([]);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly persona$: Observable<Persona> = this.personaSubject.asObservable();
  readonly personaVersions$: Observable<PersonaVersion[]> = this.personaVersionsSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  get persona(): Persona {
    return this.personaSubject.value;
  }

  get personaVersions(): PersonaVersion[] {
    return this.personaVersionsSubject.value;
  }

  loadPersona(): void {
    if (!this.auth.token) return;
    this.http.get<{ persona: Persona | null }>(`${this.apiBase}/api/v1/admin/persona`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => {
        this.toast.show('error', 'Load Failed', 'Could not load the AI persona.');
        return of({ persona: null });
      })
    ).subscribe((res) => this.personaSubject.next(res.persona ?? EMPTY_PERSONA));
  }

  loadPersonaVersions(): void {
    if (!this.auth.token) return;
    this.http.get<{ items: PersonaVersion[] }>(`${this.apiBase}/api/v1/admin/persona/versions`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => {
        this.toast.show('error', 'Load Failed', 'Could not load persona versions.');
        return of({ items: [] });
      })
    ).subscribe((res) => this.personaVersionsSubject.next(res.items));
  }

  saveDraft(persona: Persona): void {
    if (!this.auth.token) return;
    this.http.post<{ version: PersonaVersion }>(`${this.apiBase}/api/v1/admin/persona/drafts`, persona, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: ({ version }) => {
        this.personaVersionsSubject.next([version, ...this.personaVersionsSubject.value.filter((item) => item.id !== version.id)]);
        this.toast.show('info', 'Draft Saved', `Persona v${version.version} saved as draft.`);
      },
      error: (err) => this.toast.show('error', 'Save Failed', err.error?.error?.message || 'Could not save the persona draft.')
    });
  }

  publishVersion(persona: Persona): void {
    if (!this.auth.token) return;
    this.http.put<{ persona: Persona }>(`${this.apiBase}/api/v1/admin/persona`, persona, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: ({ persona: savedPersona }) => {
        this.personaSubject.next(savedPersona);
        this.loadPersonaVersions();
        this.toast.show('success', 'Persona Published', 'The AI persona is now active across all channels.');
      },
      error: (err) => this.toast.show('error', 'Publish Failed', err.error?.error?.message || 'Could not publish the persona.')
    });
  }

  rollbackTo(version: PersonaVersion): void {
    if (!this.auth.token) return;
    this.http.post<{ version: PersonaVersion }>(`${this.apiBase}/api/v1/admin/persona/versions/${version.id}/publish`, {}, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: () => {
        this.loadPersona();
        this.loadPersonaVersions();
        this.toast.show('info', 'Rollback Executed', `Active persona reverted to v${version.version}.`);
      },
      error: (err) => this.toast.show('error', 'Rollback Failed', err.error?.error?.message || 'Could not roll back the persona.')
    });
  }

  preview(persona: Persona, message: string, onComplete: (preview: { answer: string; grounded: boolean; citations: Array<{ citation: { title: string; locator: string } }> }) => void): void {
    if (!this.auth.token) return;
    this.http.post<{ preview: { answer: string; grounded: boolean; citations: Array<{ citation: { title: string; locator: string } }> } }>(`${this.apiBase}/api/v1/admin/persona/preview`, { ...persona, message }, {
      headers: this.auth.authHeaders
    }).subscribe({
      next: ({ preview }) => onComplete(preview),
      error: (err) => this.toast.show('error', 'Preview Failed', err.error?.error?.message || 'Could not run the persona preview.')
    });
  }
}

import { Injectable, inject, signal } from '@angular/core';
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
  permittedLanguages: [],
  contextWindowMessages: 10,
  voiceName: '',
  voiceLanguage: 'en-US',
  voiceRate: 1,
  voicePitch: 1,
  voiceVolume: 1
};

@Injectable({
  providedIn: 'root'
})
export class PersonaService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  // Angular Signals (Primary reactive state)
  private readonly _persona = signal<Persona>(EMPTY_PERSONA);
  private readonly _personaDraft = signal<Persona | null>(null);
  private readonly _personaVersions = signal<PersonaVersion[]>([]);
  private readonly _isLoading = signal<boolean>(false);

  readonly persona = this._persona.asReadonly();
  readonly personaDraft = this._personaDraft.asReadonly();
  readonly personaVersions = this._personaVersions.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // Observable streams for backwards compatibility
  private readonly personaSubject = new BehaviorSubject<Persona>(EMPTY_PERSONA);
  private readonly personaDraftSubject = new BehaviorSubject<Persona | null>(null);
  private readonly personaVersionsSubject = new BehaviorSubject<PersonaVersion[]>([]);
  private readonly isLoadingSubject = new BehaviorSubject<boolean>(false);

  readonly persona$: Observable<Persona> = this.personaSubject.asObservable();
  readonly personaDraft$: Observable<Persona | null> = this.personaDraftSubject.asObservable();
  readonly personaVersions$: Observable<PersonaVersion[]> = this.personaVersionsSubject.asObservable();
  readonly isLoading$: Observable<boolean> = this.isLoadingSubject.asObservable();

  setDraft(persona: Persona): void {
    const draft = { ...persona, permittedLanguages: [...persona.permittedLanguages] };
    this._personaDraft.set(draft);
    this.personaDraftSubject.next(draft);
  }

  clearDraft(): void {
    this._personaDraft.set(null);
    this.personaDraftSubject.next(null);
  }

  loadPersona(): void {
    if (!this.auth.token()) return;
    this.http.get<{ persona: Persona | null }>(`${this.apiBase}/api/v1/admin/persona`).pipe(
      catchError(() => of({ persona: null }))
    ).subscribe((res) => {
      const p = res.persona ?? EMPTY_PERSONA;
      this._persona.set(p);
      this.personaSubject.next(p);
    });
  }

  loadPersonaVersions(): void {
    if (!this.auth.token()) return;
    this.http.get<{ items: PersonaVersion[] }>(`${this.apiBase}/api/v1/admin/persona/versions`).pipe(
      catchError(() => of({ items: [] }))
    ).subscribe((res) => {
      const items = res.items ?? [];
      this._personaVersions.set(items);
      this.personaVersionsSubject.next(items);
    });
  }

  saveDraft(persona: Persona): void {
    if (!this.auth.token()) return;
    this.http.post<{ version: PersonaVersion }>(`${this.apiBase}/api/v1/admin/persona/drafts`, persona).subscribe({
      next: ({ version }) => {
        const nextList = [version, ...this._personaVersions().filter((item) => item.id !== version.id)];
        this._personaVersions.set(nextList);
        this.personaVersionsSubject.next(nextList);
        this.toast.show('info', 'Draft Saved', `Persona v${version.version} saved as draft.`);
      },
      error: (err) => this.toast.show('error', 'Save Failed', err.error?.error?.message || 'Could not save the persona draft.')
    });
  }

  publishVersion(persona: Persona): void {
    if (!this.auth.token()) return;
    this.http.put<{ persona: Persona }>(`${this.apiBase}/api/v1/admin/persona`, persona).subscribe({
      next: ({ persona: savedPersona }) => {
        this.clearDraft();
        this._persona.set(savedPersona);
        this.personaSubject.next(savedPersona);
        this.loadPersonaVersions();
        this.toast.show('success', 'Persona Published', 'The AI persona is now active across all channels.');
      },
      error: (err) => this.toast.show('error', 'Publish Failed', err.error?.error?.message || 'Could not publish the persona.')
    });
  }

  rollbackTo(version: PersonaVersion): void {
    if (!this.auth.token()) return;
    this.http.post<{ version: PersonaVersion }>(`${this.apiBase}/api/v1/admin/persona/versions/${version.id}/publish`, {}).subscribe({
      next: () => {
        this.clearDraft();
        this.loadPersona();
        this.loadPersonaVersions();
        this.toast.show('info', 'Rollback Executed', `Active persona reverted to v${version.version}.`);
      },
      error: (err) => this.toast.show('error', 'Rollback Failed', err.error?.error?.message || 'Could not roll back the persona.')
    });
  }

  preview(persona: Persona, message: string, onComplete: (preview: { answer: string; grounded: boolean; citations: Array<{ citation: { title: string; locator: string } }> }) => void): void {
    if (!this.auth.token()) return;
    this.http.post<{ preview: { answer: string; grounded: boolean; citations: Array<{ citation: { title: string; locator: string } }> } }>(`${this.apiBase}/api/v1/admin/persona/preview`, { ...persona, message }).subscribe({
      next: ({ preview }) => onComplete(preview),
      error: (err) => this.toast.show('error', 'Preview Failed', err.error?.error?.message || 'Could not run the persona preview.')
    });
  }
}

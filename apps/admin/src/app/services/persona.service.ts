import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, of } from 'rxjs';
import { Persona, PersonaVersion } from '../types/admin.types';
import { MOCK_PERSONA, MOCK_PERSONA_VERSIONS } from './mock-data';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

@Injectable({
  providedIn: 'root'
})
export class PersonaService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(API_BASE_URL);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  private readonly personaSubject = new BehaviorSubject<Persona>(MOCK_PERSONA);
  private readonly personaVersionsSubject = new BehaviorSubject<PersonaVersion[]>(MOCK_PERSONA_VERSIONS);
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
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ persona: Persona | null }>(`${this.apiBase}/api/v1/admin/persona`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ persona: MOCK_PERSONA }))
    ).subscribe((res) => {
      if (res.persona) this.personaSubject.next(res.persona);
    });
  }

  loadPersonaVersions(): void {
    if (!this.auth.token || this.auth.isMockMode) return;
    this.http.get<{ items: PersonaVersion[] }>(`${this.apiBase}/api/v1/admin/persona/versions`, {
      headers: this.auth.authHeaders
    }).pipe(
      catchError(() => of({ items: MOCK_PERSONA_VERSIONS }))
    ).subscribe((res) => this.personaVersionsSubject.next(res.items));
  }

  saveDraft(persona: Persona): void {
    const newVersion: PersonaVersion = {
      ...persona,
      id: `pv-${Math.random().toString(36).substring(2, 6)}`,
      version: this.personaVersionsSubject.value.length + 1,
      status: 'draft',
      createdAt: new Date().toISOString(),
      publishedAt: null
    };
    this.personaVersionsSubject.next([newVersion, ...this.personaVersionsSubject.value]);
    this.toast.show('info', 'Draft Saved', `Persona v${newVersion.version} saved as draft.`);
  }

  publishVersion(persona: Persona): void {
    const newVersion: PersonaVersion = {
      ...persona,
      id: `pv-${Math.random().toString(36).substring(2, 6)}`,
      version: this.personaVersionsSubject.value.length + 1,
      status: 'published',
      createdAt: new Date().toISOString(),
      publishedAt: new Date().toISOString()
    };
    const updated = this.personaVersionsSubject.value.map((v) => ({ ...v, status: 'draft' as const }));
    this.personaVersionsSubject.next([newVersion, ...updated]);
    this.personaSubject.next(persona);
    this.toast.show('success', 'Persona Published', `v${newVersion.version} is now active across all channels.`);
  }

  rollbackTo(version: PersonaVersion): void {
    const updated = this.personaVersionsSubject.value.map((v) => ({
      ...v,
      status: v.id === version.id ? ('published' as const) : ('draft' as const),
      publishedAt: v.id === version.id ? new Date().toISOString() : v.publishedAt
    }));
    this.personaVersionsSubject.next(updated);
    this.personaSubject.next({
      name: version.name,
      greeting: version.greeting,
      personality: version.personality,
      tone: version.tone,
      speakingStyle: version.speakingStyle,
      permittedLanguages: [...version.permittedLanguages]
    });
    this.toast.show('info', 'Rollback Executed', `Active persona reverted to v${version.version}.`);
  }
}

import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Source = { id: string; title: string; status: string; audience: string; mimeType: string };
type Metrics = { sourceCounts: Record<string, number>; sessions: number; messages: number; actions: number; auditEvents: number };
type Persona = { name: string; greeting: string; personality: string; tone: string; speakingStyle: string; permittedLanguages: string[] };
const api = 'http://localhost:4000';

@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './app.component.html' })
export class AppComponent {
  private readonly http = inject(HttpClient);
  email = 'admin@example.test'; password = ''; token = ''; error = ''; sources: Source[] = []; metrics: Metrics | null = null; persona: Persona = { name: '', greeting: '', personality: '', tone: '', speakingStyle: '', permittedLanguages: ['en'] };
  title = ''; content = ''; audience = 'public';

  login(): void { this.http.post<{ token: string }>(`${api}/api/v1/auth/login`, { email: this.email, password: this.password }).subscribe({ next: (body) => { this.token = body.token; this.loadSources(); this.loadDashboard(); this.loadPersona(); }, error: () => { this.error = 'Login failed.'; } }); }
  loadSources(): void { this.http.get<{ items: Source[] }>(`${api}/api/v1/admin/sources`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.sources = body.items; }, error: () => { this.error = 'Could not load sources.'; } }); }
  loadDashboard(): void { this.http.get<{ metrics: Metrics }>(`${api}/api/v1/admin/dashboard/overview`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.metrics = body.metrics; }, error: () => { this.error = 'Could not load dashboard metrics.'; } }); }
  loadPersona(): void { this.http.get<{ persona: Persona | null }>(`${api}/api/v1/admin/persona`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { if (body.persona) this.persona = body.persona; }, error: () => { this.error = 'Could not load persona.'; } }); }
  savePersona(): void { this.http.put(`${api}/api/v1/admin/persona`, this.persona, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.error = ''; }, error: () => { this.error = 'Persona could not be saved.'; } }); }
  stage(): void { this.http.post(`${api}/api/v1/admin/sources`, { title: this.title, mimeType: 'text/plain', audience: this.audience, content: this.content }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.title = ''; this.content = ''; this.loadSources(); }, error: () => { this.error = 'Source could not be staged.'; } }); }
  publish(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/publish`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadSources(), error: () => { this.error = 'Source could not be published.'; } }); }
  revoke(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/revoke`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadSources(), error: () => { this.error = 'Source could not be revoked.'; } }); }
  logout(): void { this.http.post(`${api}/api/v1/auth/logout`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.token = ''; this.metrics = null; }, error: () => { this.token = ''; } }); }
}

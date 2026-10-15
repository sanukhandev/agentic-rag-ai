import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Source = { id: string; title: string; status: string; audience: string; mimeType: string };
const api = 'http://localhost:4000';

@Component({ selector: 'app-root', standalone: true, imports: [CommonModule, FormsModule], templateUrl: './app.component.html' })
export class AppComponent {
  private readonly http = inject(HttpClient);
  email = 'admin@example.test'; password = ''; token = ''; error = ''; sources: Source[] = [];
  title = ''; content = ''; audience = 'public';

  login(): void { this.http.post<{ token: string }>(`${api}/api/v1/auth/login`, { email: this.email, password: this.password }).subscribe({ next: (body) => { this.token = body.token; this.loadSources(); }, error: () => { this.error = 'Login failed.'; } }); }
  loadSources(): void { this.http.get<{ items: Source[] }>(`${api}/api/v1/admin/sources`, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: (body) => { this.sources = body.items; }, error: () => { this.error = 'Could not load sources.'; } }); }
  stage(): void { this.http.post(`${api}/api/v1/admin/sources`, { title: this.title, mimeType: 'text/plain', audience: this.audience, content: this.content }, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => { this.title = ''; this.content = ''; this.loadSources(); }, error: () => { this.error = 'Source could not be staged.'; } }); }
  publish(source: Source): void { this.http.post(`${api}/api/v1/admin/sources/${source.id}/publish`, {}, { headers: { Authorization: `Bearer ${this.token}` } }).subscribe({ next: () => this.loadSources(), error: () => { this.error = 'Source could not be published.'; } }); }
}

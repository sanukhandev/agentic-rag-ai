import { Component, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { Source } from '../../types/admin.types';
import { fileMimeType } from '../../upload-utils';
import { IconComponent } from '../shared/icon.component';
import { BadgeComponent } from '../shared/badge.component';

@Component({
  selector: 'app-knowledge-manager',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Action Bar & Tabs -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 class="text-xl font-bold text-neutral-900 tracking-tight">
            Knowledge Catalog & Ingestion
          </h2>
          <p class="mt-1 text-xs text-neutral-500">
            Approved public customer knowledge and internal operator playbooks stored in PostgreSQL pgvector.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            (click)="activeTab = 'catalog'"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            [ngClass]="activeTab === 'catalog' ? 'bg-neutral-900 text-white shadow-sm' : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'"
          >
            Source Catalog
          </button>
          <button
            type="button"
            (click)="activeTab = 'stage'"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            [ngClass]="activeTab === 'stage' ? 'bg-neutral-900 text-white shadow-sm' : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'"
          >
            + Stage Text
          </button>
          <button
            type="button"
            (click)="activeTab = 'upload'"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            [ngClass]="activeTab === 'upload' ? 'bg-neutral-900 text-white shadow-sm' : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'"
          >
            Upload File
          </button>
          <button
            type="button"
            (click)="activeTab = 'crawl'"
            class="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            [ngClass]="activeTab === 'crawl' ? 'bg-neutral-900 text-white shadow-sm' : 'bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50'"
          >
            HTTPS Crawl
          </button>
        </div>
      </div>

      <!-- Tab: Source Catalog Table -->
      <section *ngIf="activeTab === 'catalog'" class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
        <!-- Toolbar & Filter -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-neutral-100">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-neutral-700">Filter Status:</span>
            <div class="flex items-center gap-1 p-0.5 bg-neutral-100 rounded-lg text-xs">
              <button
                *ngFor="let f of ['all', 'active', 'awaiting_review', 'revoked']"
                type="button"
                (click)="selectedStatus = f"
                class="px-2.5 py-1 rounded-md font-medium capitalize transition-all"
                [ngClass]="selectedStatus === f ? 'bg-white text-neutral-900 shadow-subtle' : 'text-neutral-500 hover:text-neutral-900'"
              >
                {{ f.replace('_', ' ') }}
              </button>
            </div>
          </div>

          <button
            type="button"
            (click)="refresh()"
            class="flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            <app-icon name="refresh" classNames="w-3.5 h-3.5 text-neutral-400"></app-icon>
            <span>Refresh Sources</span>
          </button>
        </div>

        <!-- Table of Sources -->
        <div class="mt-4 overflow-x-auto rounded-xl border border-neutral-200/80">
          <table class="w-full text-left text-xs">
            <thead class="border-b border-neutral-200/80 bg-neutral-50/70 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
              <tr>
                <th scope="col" class="py-3 pl-4 pr-3">Source Title</th>
                <th scope="col" class="px-3 py-3">Audience</th>
                <th scope="col" class="px-3 py-3">Format</th>
                <th scope="col" class="px-3 py-3">Status</th>
                <th scope="col" class="px-3 py-3">Chunks</th>
                <th scope="col" class="px-3 py-3">Updated</th>
                <th scope="col" class="py-3 pl-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-neutral-100 bg-white">
              <tr *ngFor="let src of filteredSources" class="hover:bg-neutral-50/70 transition-colors">
                <td class="py-3.5 pl-4 pr-3">
                  <div class="flex items-center gap-2.5">
                    <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                      <app-icon name="file-text" classNames="w-3.5 h-3.5"></app-icon>
                    </div>
                    <span class="font-semibold text-neutral-900 max-w-sm truncate">{{ src.title }}</span>
                  </div>
                </td>
                <td class="px-3 py-3.5">
                  <span class="rounded bg-neutral-100 px-2 py-0.5 text-[11px] font-mono text-neutral-600">
                    {{ src.audience }}
                  </span>
                </td>
                <td class="px-3 py-3.5 text-[11px] font-mono text-neutral-500">
                  {{ getCleanMime(src.mimeType) }}
                </td>
                <td class="px-3 py-3.5">
                  <app-badge
                    [variant]="src.status === 'active' ? 'success' : src.status === 'awaiting_review' ? 'warning' : 'error'"
                    [text]="src.status === 'awaiting_review' ? 'Awaiting Review' : (src.status | titlecase)"
                  ></app-badge>
                </td>
                <td class="px-3 py-3.5 font-mono text-neutral-700">
                  {{ src.chunkCount || 0 }}
                </td>
                <td class="px-3 py-3.5 text-neutral-500 whitespace-nowrap">
                  {{ (src.updatedAt || src.createdAt) | date:'mediumDate' }}
                </td>
                <td class="py-3.5 pl-3 pr-4 text-right whitespace-nowrap">
                  <div class="flex items-center justify-end gap-1.5">
                    <!-- Publish -->
                    <button
                      *ngIf="src.status === 'awaiting_review'"
                      type="button"
                      (click)="publish(src)"
                      class="rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 transition-colors button-press"
                    >
                      Publish
                    </button>

                    <!-- Revoke -->
                    <button
                      *ngIf="src.status === 'active'"
                      type="button"
                      (click)="revoke(src)"
                      class="rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                    >
                      Revoke
                    </button>

                    <!-- Purge -->
                    <button
                      *ngIf="src.status === 'revoked'"
                      type="button"
                      (click)="purge(src)"
                      class="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 transition-colors"
                    >
                      Purge
                    </button>

                    <!-- Reindex -->
                    <button
                      type="button"
                      (click)="reindex(src)"
                      class="rounded-md border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600 hover:bg-neutral-100 transition-colors"
                      title="Recalculate vector embeddings"
                    >
                      Reindex
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Tab: Stage Source Text Form -->
      <section *ngIf="activeTab === 'stage'" class="max-w-3xl rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
        <h3 class="text-base font-semibold text-neutral-900">Stage Text Source for Review</h3>
        <p class="mt-1 text-xs text-neutral-500">
          Paste verified policy or FAQ text. Staged sources require administrative review before becoming retrievable in chat sessions.
        </p>

        <form (ngSubmit)="submitStage()" class="mt-5 space-y-4">
          <div>
            <label class="block text-xs font-semibold text-neutral-800">Source Title</label>
            <input
              [(ngModel)]="stageTitle"
              name="stageTitle"
              required
              placeholder="e.g. 2026 Customer Support SLA and Escalation Paths"
              class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-neutral-800">Audience Scope</label>
            <select
              [(ngModel)]="stageAudience"
              name="stageAudience"
              class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
            >
              <option value="public">Public (Permitted for customer web chat)</option>
              <option value="internal">Internal (Only visible to internal operators)</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-semibold text-neutral-800">Approved Text Content</label>
            <textarea
              [(ngModel)]="stageContent"
              name="stageContent"
              rows="8"
              required
              placeholder="Paste raw markdown or clear text knowledge..."
              class="mt-1.5 w-full rounded-lg border border-neutral-200 p-3 text-xs font-mono text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
            ></textarea>
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              (click)="activeTab = 'catalog'"
              class="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              [disabled]="!stageTitle || !stageContent"
              class="rounded-lg bg-neutral-900 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-40 transition-all button-press"
            >
              Stage for Review
            </button>
          </div>
        </form>
      </section>

      <!-- Tab: Upload File Form -->
      <section *ngIf="activeTab === 'upload'" class="max-w-2xl rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
        <h3 class="text-base font-semibold text-neutral-900">Upload Enterprise Document</h3>
        <p class="mt-1 text-xs text-neutral-500">
          Supported formats: DOCX, XLSX, TXT, Markdown, text-based PDF, or ZIP bundles containing those formats. Handled via the isolated Python normalization worker.
        </p>

        <form (ngSubmit)="submitUpload()" class="mt-5 space-y-4">
          <div>
            <label class="block text-xs font-semibold text-neutral-800">Source Title (Optional)</label>
            <input
              [(ngModel)]="uploadTitle"
              name="uploadTitle"
              placeholder="Leave blank to use filename"
              class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-neutral-800">Audience Scope</label>
            <select
              [(ngModel)]="uploadAudience"
              name="uploadAudience"
              class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
            >
              <option value="public">Public (Visible to customer chat)</option>
              <option value="internal">Internal (Only visible to internal operators)</option>
            </select>
          </div>

          <!-- Drag and Drop Dropzone -->
          <div class="mt-2 flex justify-center rounded-xl border border-dashed border-neutral-300 px-6 py-8 hover:border-neutral-900 transition-colors">
            <div class="text-center">
              <app-icon name="upload" classNames="mx-auto h-8 w-8 text-neutral-400"></app-icon>
              <div class="mt-3 flex text-xs leading-6 text-neutral-600 justify-center">
                <label
                  for="file-upload"
                  class="relative cursor-pointer rounded-md font-semibold text-neutral-900 underline focus-within:outline-none"
                >
                  <span>Select a file</span>
                  <input
                    id="file-upload"
                    name="file-upload"
                    type="file"
                    accept=".pdf,.docx,.xlsx,.txt,.md,.csv,.json,.jsonl,.zip"
                    (change)="onFileChange($event)"
                    class="sr-only"
                  />
                </label>
                <p class="pl-1">or drag and drop here</p>
              </div>
              <p class="text-[11px] text-neutral-400 mt-1">PDF, DOCX, XLSX, TXT, MD, CSV, JSON, JSONL, ZIP up to 20 MiB</p>
              <p *ngIf="selectedFile" class="mt-2 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded inline-block">
                Selected: {{ selectedFile.name }} ({{ (selectedFile.size / 1024) | number:'1.0-0' }} KB)
              </p>
            </div>
          </div>

          <div class="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              (click)="activeTab = 'catalog'"
              class="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              [disabled]="!selectedFile"
              class="rounded-lg bg-neutral-900 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-40 transition-all button-press"
            >
              Queue File Ingestion
            </button>
          </div>
        </form>
      </section>

      <!-- Tab: HTTPS Snapshot Queue -->
      <section *ngIf="activeTab === 'crawl'" class="max-w-2xl rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
        <h3 class="text-base font-semibold text-neutral-900">Queue HTTPS Webpage Snapshot</h3>
        <p class="mt-1 text-xs text-neutral-500">
          Only explicitly approved HTTPS documentation links within the tenant domain scope may be ingested.
        </p>

        <form (ngSubmit)="submitCrawl()" class="mt-5 space-y-4">
          <div>
            <label class="block text-xs font-semibold text-neutral-800">Snapshot Title</label>
            <input
              [(ngModel)]="crawlTitle"
              name="crawlTitle"
              required
              placeholder="e.g. Official Pricing and Terms of Service"
              class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-neutral-800">Approved HTTPS URL</label>
            <input
              [(ngModel)]="crawlUrl"
              name="crawlUrl"
              required
              type="url"
              placeholder="https://docs.acme.com/security-architecture"
              class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
            />
          </div>

          <div class="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              (click)="activeTab = 'catalog'"
              class="rounded-lg border border-neutral-200 px-4 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              [disabled]="!crawlTitle || !crawlUrl"
              class="rounded-lg bg-neutral-900 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 disabled:opacity-40 transition-all button-press"
            >
              Queue URL Crawl
            </button>
          </div>
        </form>
      </section>

    </div>
  `
})
export class KnowledgeManagerComponent implements OnInit {
  private readonly state = inject(AdminStateService);

  activeTab: 'catalog' | 'stage' | 'upload' | 'crawl' = 'catalog';
  selectedStatus: string = 'all';
  get sources(): Source[] { return this.state.sources(); }

  // Stage form
  stageTitle = '';
  stageAudience: 'public' | 'internal' = 'public';
  stageContent = '';

  // Upload form
  uploadTitle = '';
  uploadAudience: 'public' | 'internal' = 'public';
  selectedFile: File | null = null;

  // Crawl form
  crawlTitle = '';
  crawlUrl = '';


  ngOnInit(): void {
    this.state.loadSources();
    this.state.loadJobs();
  }

  get filteredSources(): Source[] {
    if (this.selectedStatus === 'all') return this.sources;
    return this.sources.filter((s) => s.status === this.selectedStatus);
  }

  getCleanMime(mime: string): string {
    if (mime.includes('zip')) return 'ZIP';
    if (mime.includes('pdf')) return 'PDF';
    if (mime.includes('word') || mime.includes('docx')) return 'DOCX';
    if (mime.includes('spreadsheet') || mime.includes('xlsx')) return 'XLSX';
    if (mime.includes('html')) return 'HTML';
    if (mime.includes('ndjson')) return 'JSONL';
    return 'TXT';
  }

  refresh(): void {
    this.state.loadSources();
    this.state.showToast('info', 'Sources Synchronized', 'Retrieved latest vector store sources.');
  }

  publish(src: Source): void {
    this.state.publishSource(src);
  }

  revoke(src: Source): void {
    this.state.revokeSource(src);
  }

  purge(src: Source): void {
    if (window.confirm(`Permanently delete "${src.title}" and remove its embeddings from pgvector?`)) {
      this.state.purgeSource(src);
    }
  }

  reindex(src: Source): void {
    this.state.reindexSource(src);
  }

  onFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.selectedFile = input.files[0];
    }
  }

  submitStage(): void {
    if (!this.stageTitle || !this.stageContent) return;
    this.state.stageSource(this.stageTitle, this.stageAudience, this.stageContent, () => {
      this.stageTitle = '';
      this.stageContent = '';
      this.activeTab = 'catalog';
    });
  }

  submitUpload(): void {
    if (!this.selectedFile) return;
    const mime = fileMimeType(this.selectedFile.name);
    if (!mime) {
      this.state.showToast('error', 'Unsupported Format', 'Please upload a PDF, DOCX, XLSX, TXT, MD, CSV, JSON, JSONL, or ZIP file.');
      return;
    }
    if (this.selectedFile.size > 20 * 1024 * 1024) {
      this.state.showToast('error', 'File Too Large', 'Uploads are limited to 20 MiB.');
      return;
    }

    const file = this.selectedFile;
    const title = this.uploadTitle || file.name;
    const audience = this.uploadAudience;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = typeof reader.result === 'string' ? reader.result.split(',', 2)[1] : '';
      this.state.knowledge.queueFileUpload(title, file.name, mime, audience, base64, () => {
        this.selectedFile = null;
        this.uploadTitle = '';
        this.activeTab = 'catalog';
      });
    };
    reader.onerror = () => {
      this.state.showToast('error', 'Read Failed', 'The document file could not be read.');
    };
    reader.readAsDataURL(file);
  }
  submitCrawl(): void {
    if (!this.crawlTitle || !this.crawlUrl) return;
    this.state.knowledge.queueCrawl(this.crawlTitle, this.crawlUrl, () => {
      this.crawlTitle = '';
      this.crawlUrl = '';
      this.activeTab = 'catalog';
    });
  }
}

import { Component, effect, untracked, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { IntentCatalogService } from '../../services/intent-catalog.service';
import { IntentCatalogVersion, IngestionJob, Tenant } from '../../types/admin.types';
import { BadgeComponent } from '../shared/badge.component';
import { apiErrorMessage } from '../../services/api-error';

@Component({
  selector: 'app-intent-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, BadgeComponent],
  template: `
    <section class="space-y-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">Controlled routing</p>
          <h2 class="mt-1 text-xl font-bold tracking-tight text-neutral-900">Intent Catalog</h2>
          <p class="mt-1 max-w-2xl text-sm text-neutral-500">Upload the approved Excel contract, review the server-validated draft, then publish one tenant-scoped version for chat and workflow decisions.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button *ngIf="canManagePersona && publishedVersion" type="button" (click)="exportPublished()" [disabled]="isExporting" class="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-60">
            {{ isExporting ? 'Preparing Excel...' : 'Export published Excel' }}
          </button>
          <label class="cursor-pointer rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800">
            Replace with latest Excel
            <input class="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="upload($event)" />
          </label>
        </div>
      </div>
      <div *ngIf="catalogJob as job" class="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p class="font-semibold">Catalog {{ job.status }}</p>
        <p *ngIf="job.status === 'queued' || job.status === 'processing'" class="mt-1 text-blue-700">The ingestion worker is validating the workbook. The catalog list will update automatically when processing completes.</p>
        <p *ngIf="job.status === 'failed'" class="mt-1 text-red-700">Import failed: {{ job.errorCode || 'unknown error' }}{{ job.errorDetail ? ' — ' + job.errorDetail : '' }}. Upload the workbook again after fixing the reported issue.</p>
      </div>
      <div *ngIf="catalogError as error" class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900" role="alert">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p class="font-semibold">The intent catalog could not be loaded.</p><p class="mt-1 text-rose-700">{{ error }}</p></div>
          <button type="button" (click)="reload()" class="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100">Retry</button>
        </div>
      </div>
      <div *ngIf="isPlatformAdmin && !selectedTenant" class="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-sm text-amber-900">Select an organization first to view its tenant-scoped intent catalog.</div>
      <div *ngIf="!catalogError && (!isPlatformAdmin || selectedTenant) && versions.length === 0" class="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">No catalog versions have been imported yet.</div>
      <div class="space-y-3">
        <article *ngFor="let version of versions" class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-card">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div class="flex items-center gap-2"><span class="font-mono text-sm font-bold">v{{ version.version }}</span><app-badge [variant]="version.status === 'published' ? 'black' : 'outline'" [showDot]="version.status === 'published'" [text]="version.status | uppercase"></app-badge></div>
              <p class="mt-1 text-xs text-neutral-500">{{ version.sourceFileName }} · {{ version.catalog.intents.length }} intents · {{ version.catalog.signals.length }} signals · {{ version.catalog.slots.length }} slots · {{ version.catalog.workflowBindings.length }} workflow bindings</p>
              <p class="mt-1 text-[11px] text-neutral-400">Imported {{ version.createdAt | date:'medium' }}<span *ngIf="version.publishedAt"> · Published {{ version.publishedAt | date:'medium' }}</span></p>
            </div>
            <div class="flex flex-wrap gap-2">
              <button *ngIf="canManagePersona" type="button" (click)="startEdit(version)" class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Edit catalog</button>
              <button *ngIf="version.status !== 'published'" type="button" (click)="publish(version)" class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Publish version</button>
            </div>
          </div>
          <div *ngIf="editingVersionId === version.id" class="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <div class="flex items-start justify-between gap-3"><div><p class="text-sm font-semibold text-blue-950">Edit catalog JSON</p><p class="mt-1 text-xs text-blue-800">Change signals, scores, slots, or workflow bindings. The server validates the complete catalog and saves a new draft version.</p></div><button type="button" (click)="cancelEdit()" class="text-xs font-semibold text-blue-800 hover:text-blue-950">Cancel</button></div>
            <textarea [(ngModel)]="editJson" rows="18" class="mt-3 w-full rounded-lg border border-blue-300 bg-white p-3 font-mono text-xs text-neutral-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"></textarea>
            <p *ngIf="editError" class="mt-2 text-xs font-semibold text-rose-700" role="alert">{{ editError }}</p>
            <button type="button" (click)="saveEdit(version)" class="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800">Save as draft</button>
          </div>
          <div class="mt-4 grid gap-3 lg:grid-cols-2">
            <div *ngFor="let intent of version.catalog.intents" class="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
              <div class="flex items-start justify-between gap-3"><div><p class="font-semibold text-neutral-900">{{ intent.displayName }}</p><p class="mt-1 font-mono text-[11px] text-neutral-500">{{ intent.intentKey }}</p></div><app-badge [variant]="intent.active ? 'success' : 'outline'" [text]="intent.active ? 'Active' : 'Inactive'"></app-badge></div>
              <p *ngIf="intent.description" class="mt-3 text-xs leading-relaxed text-neutral-600">{{ intent.description }}</p>
              <dl class="mt-3 grid grid-cols-2 gap-2 text-[11px] text-neutral-500"><div><dt class="font-semibold uppercase tracking-wide text-neutral-400">Workflow</dt><dd class="mt-1 font-mono text-neutral-700">{{ intent.workflowKey }}</dd></div><div><dt class="font-semibold uppercase tracking-wide text-neutral-400">Threshold</dt><dd class="mt-1 text-neutral-700">{{ intent.minimumScore ?? '—' }} / {{ intent.confidenceThreshold ?? '—' }}</dd></div></dl>
              <div class="mt-3 flex flex-wrap gap-1.5"><span *ngFor="let signal of signalsFor(version, intent.intentKey)" class="rounded-full bg-white px-2 py-1 text-[10px] text-neutral-600" [class.line-through]="signal.signalType === 'exclusion'">{{ signal.value }} · {{ signal.weight }}</span></div>
            </div>
          </div>
        </article>
      </div>
    </section>
  `
})
export class IntentCatalogComponent {
  readonly service = inject(IntentCatalogService);
  readonly state = inject(AdminStateService);

  get isPlatformAdmin(): boolean { return this.state.isPlatformAdmin(); }
  get selectedTenant(): Tenant | null { return this.state.selectedTenant(); }
  get canManagePersona(): boolean { return this.state.canManagePersona(); }

  get catalogJob(): IngestionJob | null { return this.service.catalogJob(); }
  get catalogError(): string | null { return this.service.catalogError(); }
  get versions(): IntentCatalogVersion[] { return this.service.versions(); }
  get publishedVersion(): IntentCatalogVersion | null { return this.versions.find((version) => version.status === 'published') ?? null; }

  editingVersionId: string | null = null;
  editJson = '';
  editError = '';
  isExporting = false;
  private lastLoadedTenantId: string | null = null;

  constructor() {
    effect(() => {
      const tenantId = this.state.selectedTenant()?.id ?? null;
      if (tenantId && tenantId !== this.lastLoadedTenantId) {
        this.lastLoadedTenantId = tenantId;
        untracked(() => {
          this.service.load();
          this.service.resumePendingJob();
        });
      } else if (!tenantId) {
        this.lastLoadedTenantId = null;
      }
    });
  }

  upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.service.upload(file);
    input.value = '';
  }

  reload(): void {
    this.service.load();
    this.service.resumePendingJob();
  }

  signalsFor(version: IntentCatalogVersion, intentKey: string): IntentCatalogVersion['catalog']['signals'] {
    return version.catalog.signals.filter((signal) => signal.intentKey === intentKey);
  }

  startEdit(version: IntentCatalogVersion): void {
    this.editingVersionId = version.id;
    this.editJson = JSON.stringify(version.catalog, null, 2);
    this.editError = '';
  }

  cancelEdit(): void {
    this.editingVersionId = null;
    this.editJson = '';
    this.editError = '';
  }

  saveEdit(version: IntentCatalogVersion): void {
    try {
      const catalog: unknown = JSON.parse(this.editJson);
      this.service.saveDraft(version, catalog, () => this.cancelEdit());
    } catch {
      this.editError = 'The catalog editor contains invalid JSON.';
    }
  }

  publish(version: IntentCatalogVersion): void {
    this.service.publish(version);
  }

  exportPublished(): void {
    const version = this.publishedVersion;
    if (!version || this.isExporting) return;
    this.isExporting = true;
    this.service.exportPublished().subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${this.selectedTenant?.slug ?? 'tenant'}-intent-catalog-v${version.version}.xlsx`;
        anchor.click();
        URL.revokeObjectURL(url);
        this.isExporting = false;
        this.state.showToast('success', 'Catalog exported', `Published intent catalog v${version.version} downloaded.`);
      },
      error: (error) => {
        this.isExporting = false;
        this.state.showToast('error', 'Export failed', apiErrorMessage(error, 'Could not export the published catalog.'));
      }
    });
  }
}

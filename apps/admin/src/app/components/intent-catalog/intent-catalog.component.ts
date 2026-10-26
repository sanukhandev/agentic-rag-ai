import { Component, effect, untracked, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { IntentCatalogService } from '../../services/intent-catalog.service';
import { IntentCatalogVersion, IngestionJob, Tenant } from '../../types/admin.types';
import { BadgeComponent } from '../shared/badge.component';
import { IconComponent } from '../shared/icon.component';
import { ConfirmDialogComponent } from '../shared/confirm-dialog.component';
import { apiErrorMessage } from '../../services/api-error';

@Component({
  selector: 'app-intent-catalog',
  standalone: true,
  imports: [CommonModule, FormsModule, BadgeComponent, IconComponent, ConfirmDialogComponent],
  template: `
    <section class="space-y-6">
      <!-- Section Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-neutral-200/80 pb-5">
        <div>
          <div class="flex items-center gap-2">
            <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">Controlled Routing</p>
            <app-badge variant="neutral" [showDot]="false" text="Server Verified"></app-badge>
          </div>
          <h2 class="mt-1 text-2xl font-bold tracking-tight text-neutral-900 font-sans">Intent Catalog & Rules</h2>
          <p class="mt-1 max-w-2xl text-xs sm:text-sm text-neutral-500 leading-relaxed">
            Upload the approved Excel contract, review the server-validated draft, then publish one tenant-scoped version for customer chat and n8n workflow decisions.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            *ngIf="canManagePersona && publishedVersion"
            type="button"
            (click)="exportPublished()"
            [disabled]="isExporting"
            class="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-wait disabled:opacity-60 transition-colors button-press shadow-subtle"
          >
            <app-icon name="upload" classNames="w-3.5 h-3.5 rotate-180"></app-icon>
            <span>{{ isExporting ? 'Preparing Excel...' : 'Export Published Excel' }}</span>
          </button>
          <label class="flex items-center gap-1.5 cursor-pointer rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-neutral-800 transition-all button-press shadow-sm">
            <app-icon name="upload" classNames="w-3.5 h-3.5"></app-icon>
            <span>Import Excel Catalog</span>
            <input class="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="upload($event)" />
          </label>
        </div>
      </div>

      <!-- Ingestion Job Status Banner -->
      <div *ngIf="catalogJob as job" class="rounded-xl border border-blue-200 bg-blue-50/80 p-4 text-xs text-blue-900 flex items-start gap-3">
        <app-icon name="activity" classNames="w-4 h-4 text-blue-600 shrink-0 mt-0.5"></app-icon>
        <div>
          <p class="font-semibold text-sm">Catalog Ingestion: {{ job.status | titlecase }}</p>
          <p *ngIf="job.status === 'queued' || job.status === 'processing'" class="mt-1 text-blue-700">
            The Python ingestion worker is parsing sheets, validating scoring weights, and checking slot definitions.
          </p>
          <p *ngIf="job.status === 'failed'" class="mt-1 text-rose-700 font-medium">
            Import failed: {{ job.errorCode || 'unknown error' }}{{ job.errorDetail ? ' — ' + job.errorDetail : '' }}.
          </p>
        </div>
      </div>

      <!-- Error State -->
      <div *ngIf="catalogError as error" class="rounded-xl border border-rose-200 bg-rose-50/80 p-4 text-xs text-rose-900" role="alert">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex items-start gap-2.5">
            <app-icon name="alert-circle" classNames="w-4 h-4 text-rose-600 shrink-0 mt-0.5"></app-icon>
            <div>
              <p class="font-semibold text-sm">The intent catalog could not be loaded.</p>
              <p class="mt-1 text-rose-700">{{ error }}</p>
            </div>
          </div>
          <button type="button" (click)="reload()" class="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-800 hover:bg-rose-100 transition-colors">
            Retry Loading
          </button>
        </div>
      </div>

      <!-- Scope Notice -->
      <div *ngIf="isPlatformAdmin && !selectedTenant" class="rounded-2xl border border-amber-200 bg-amber-50/70 p-8 text-center text-xs text-amber-900">
        <app-icon name="building" classNames="mx-auto w-6 h-6 text-amber-600 mb-2"></app-icon>
        <p class="font-semibold text-sm">Select an organization first</p>
        <p class="mt-1 text-amber-800">Intent routing contracts are strictly scoped to the active enterprise tenant.</p>
      </div>

      <!-- Empty State -->
      <div *ngIf="!catalogError && (!isPlatformAdmin || selectedTenant) && versions.length === 0" class="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center text-xs text-neutral-500 space-y-2">
        <div class="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
          <app-icon name="workflow" classNames="w-5 h-5"></app-icon>
        </div>
        <p class="font-semibold text-sm text-neutral-800">No Intent Catalog Versions Imported</p>
        <p class="max-w-md mx-auto text-neutral-500">Upload the standard Excel workbook contract containing sheets for Intents, Signals, Slots, and Workflows.</p>
      </div>

      <!-- Search & Filter Controls -->
      <div *ngIf="versions.length > 0" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="relative w-full sm:max-w-xs">
          <app-icon name="search" classNames="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2"></app-icon>
          <input
            [(ngModel)]="searchQuery"
            type="text"
            placeholder="Search intents or signals..."
            class="w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 py-1.5 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none transition-all shadow-subtle"
          />
        </div>

        <div class="flex items-center gap-1.5 text-xs text-neutral-500">
          <span>Active Scope: <strong class="text-neutral-900 font-mono">{{ selectedTenant?.name || 'Default' }}</strong></span>
        </div>
      </div>

      <!-- Version Cards Stream -->
      <div class="space-y-4">
        <article *ngFor="let version of versions" class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card transition-all">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between border-b border-neutral-100 pb-4">
            <div>
              <div class="flex items-center gap-2.5">
                <span class="font-mono text-base font-bold text-neutral-900">v{{ version.version }}</span>
                <app-badge
                  [variant]="version.status === 'published' ? 'black' : 'outline'"
                  [showDot]="version.status === 'published'"
                  [text]="version.status | uppercase"
                ></app-badge>
              </div>
              <p class="mt-1.5 text-xs text-neutral-600 font-medium">
                {{ version.sourceFileName }} · {{ version.catalog.intents.length }} intents · {{ version.catalog.signals.length }} signals · {{ version.catalog.slots.length }} slots · {{ version.catalog.workflowBindings.length }} bindings
              </p>
              <p class="mt-1 text-[11px] text-neutral-500 font-mono">
                Imported {{ version.createdAt | date:'medium' }}<span *ngIf="version.publishedAt"> · Published {{ version.publishedAt | date:'medium' }}</span>
              </p>
            </div>

            <div class="flex flex-wrap gap-2 shrink-0">
              <button
                *ngIf="canManagePersona"
                type="button"
                (click)="startEdit(version)"
                class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors button-press shadow-subtle"
              >
                {{ editingVersionId === version.id ? 'Close Editor' : 'Edit Catalog JSON' }}
              </button>
              <button
                *ngIf="version.status !== 'published'"
                type="button"
                (click)="requestPublish(version)"
                class="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 transition-all button-press shadow-sm"
              >
                Publish Version
              </button>
            </div>
          </div>

          <!-- Structured Catalog JSON Editor View -->
          <div *ngIf="editingVersionId === version.id" class="mt-4 rounded-xl border border-neutral-300 bg-neutral-900 p-4 text-white shadow-xl animate-slide-down">
            <div class="flex items-start justify-between gap-3 pb-3 border-b border-neutral-800">
              <div>
                <p class="text-xs font-bold uppercase tracking-wider text-neutral-400">JSON Contract Editor</p>
                <p class="mt-0.5 text-xs text-neutral-300">
                  Update intents, scoring weights, slot definitions, or workflow keys. The server validates the schema upon save.
                </p>
              </div>
              <button type="button" (click)="cancelEdit()" class="text-xs text-neutral-400 hover:text-white transition-colors">
                Cancel
              </button>
            </div>

            <textarea
              [(ngModel)]="editJson"
              (ngModelChange)="validateJsonSyntax()"
              rows="16"
              class="mt-3 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-emerald-400 outline-none focus:border-neutral-600 focus:ring-1 focus:ring-neutral-600"
            ></textarea>

            <div class="mt-3 flex items-center justify-between">
              <div>
                <p *ngIf="editError" class="text-xs font-semibold text-rose-400" role="alert">⚠️ {{ editError }}</p>
                <p *ngIf="!editError && isJsonValid" class="text-xs text-emerald-400 font-mono">✓ JSON syntax valid</p>
              </div>
              <button
                type="button"
                (click)="saveEdit(version)"
                [disabled]="!isJsonValid"
                class="rounded-lg bg-white px-4 py-1.5 text-xs font-bold text-neutral-900 hover:bg-neutral-100 disabled:opacity-40 transition-colors button-press"
              >
                Save as Draft
              </button>
            </div>
          </div>

          <!-- Intent Cards Grid -->
          <div class="mt-4 grid gap-3 lg:grid-cols-2">
            <div
              *ngFor="let intent of filteredIntents(version)"
              class="rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-4 hover:bg-white hover:border-neutral-300 transition-all text-xs"
            >
              <div class="flex items-start justify-between gap-3">
                <div>
                  <p class="font-bold text-neutral-900 text-sm">{{ intent.displayName }}</p>
                  <p class="mt-0.5 font-mono text-[11px] text-neutral-500">{{ intent.intentKey }}</p>
                </div>
                <app-badge [variant]="intent.active ? 'success' : 'outline'" [text]="intent.active ? 'Active' : 'Inactive'"></app-badge>
              </div>

              <p *ngIf="intent.description" class="mt-2.5 text-xs leading-relaxed text-neutral-600">
                {{ intent.description }}
              </p>

              <dl class="mt-3 grid grid-cols-2 gap-2 text-[11px] border-t border-neutral-200/60 pt-2.5">
                <div>
                  <dt class="font-semibold uppercase tracking-wider text-[10px] text-neutral-400">Target Workflow</dt>
                  <dd class="mt-0.5 font-mono font-medium text-neutral-800">{{ intent.workflowKey }}</dd>
                </div>
                <div>
                  <dt class="font-semibold uppercase tracking-wider text-[10px] text-neutral-400">Thresholds (Min/Conf)</dt>
                  <dd class="mt-0.5 font-mono text-neutral-800">{{ intent.minimumScore ?? '—' }} / {{ intent.confidenceThreshold ?? '—' }}</dd>
                </div>
              </dl>

              <!-- Signals List -->
              <div class="mt-3">
                <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Scoring Signals:</span>
                <div class="mt-1 flex flex-wrap gap-1.5">
                  <span
                    *ngFor="let signal of signalsFor(version, intent.intentKey)"
                    class="rounded-md border border-neutral-200/70 bg-white px-2 py-0.5 text-[10px] font-mono text-neutral-700"
                    [class.line-through]="signal.signalType === 'exclusion'"
                    [class.text-rose-600]="signal.signalType === 'exclusion'"
                  >
                    {{ signal.value }} <span class="text-neutral-400">({{ signal.weight }})</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>

      <!-- Publish Confirmation Dialog -->
      <app-confirm-dialog
        [isOpen]="confirmPublishOpen"
        title="Publish Intent Catalog Version"
        [message]="'Publish v' + (pendingPublishVersion?.version ?? '') + ' for ' + (selectedTenant?.name || 'this organization') + '?'"
        consequence="All customer chat sessions and n8n workflow triggers will immediately resolve intents using this catalog version."
        confirmText="Publish Version"
        [isDanger]="false"
        (confirm)="executePublish()"
        (cancel)="confirmPublishOpen = false"
      ></app-confirm-dialog>

    </section>
  `
})
export class IntentCatalogComponent {
  readonly service = inject(IntentCatalogService);
  readonly state = inject(AdminStateService);

  searchQuery = '';
  editingVersionId: string | null = null;
  editJson = '';
  editError = '';
  isJsonValid = true;
  isExporting = false;

  // Publish confirmation modal
  confirmPublishOpen = false;
  pendingPublishVersion: IntentCatalogVersion | null = null;

  get isPlatformAdmin(): boolean { return this.state.isPlatformAdmin(); }
  get selectedTenant(): Tenant | null { return this.state.selectedTenant(); }
  get canManagePersona(): boolean { return this.state.canManagePersona(); }

  get catalogJob(): IngestionJob | null { return this.service.catalogJob(); }
  get catalogError(): string | null { return this.service.catalogError(); }
  get versions(): IntentCatalogVersion[] { return this.service.versions(); }
  get publishedVersion(): IntentCatalogVersion | null { return this.versions.find((version) => version.status === 'published') ?? null; }

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

  filteredIntents(version: IntentCatalogVersion): IntentCatalogVersion['catalog']['intents'] {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return version.catalog.intents;
    return version.catalog.intents.filter(
      (i) =>
        i.displayName.toLowerCase().includes(q) ||
        i.intentKey.toLowerCase().includes(q) ||
        i.workflowKey.toLowerCase().includes(q) ||
        this.signalsFor(version, i.intentKey).some((s) => s.value.toLowerCase().includes(q))
    );
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
    if (this.editingVersionId === version.id) {
      this.cancelEdit();
      return;
    }
    this.editingVersionId = version.id;
    this.editJson = JSON.stringify(version.catalog, null, 2);
    this.editError = '';
    this.isJsonValid = true;
  }

  cancelEdit(): void {
    this.editingVersionId = null;
    this.editJson = '';
    this.editError = '';
  }

  validateJsonSyntax(): void {
    try {
      JSON.parse(this.editJson);
      this.editError = '';
      this.isJsonValid = true;
    } catch (e: any) {
      this.editError = e.message || 'Invalid JSON format';
      this.isJsonValid = false;
    }
  }

  saveEdit(version: IntentCatalogVersion): void {
    try {
      const catalog: unknown = JSON.parse(this.editJson);
      this.service.saveDraft(version, catalog, () => this.cancelEdit());
    } catch {
      this.editError = 'The catalog editor contains invalid JSON.';
      this.isJsonValid = false;
    }
  }

  requestPublish(version: IntentCatalogVersion): void {
    this.pendingPublishVersion = version;
    this.confirmPublishOpen = true;
  }

  executePublish(): void {
    if (this.pendingPublishVersion) {
      this.service.publish(this.pendingPublishVersion);
      this.pendingPublishVersion = null;
    }
    this.confirmPublishOpen = false;
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

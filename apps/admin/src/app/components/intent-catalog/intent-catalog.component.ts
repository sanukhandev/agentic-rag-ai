import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IntentCatalogService } from '../../services/intent-catalog.service';
import { IntentCatalogVersion } from '../../types/admin.types';
import { BadgeComponent } from '../shared/badge.component';

@Component({
  selector: 'app-intent-catalog',
  standalone: true,
  imports: [CommonModule, BadgeComponent],
  template: `
    <section class="space-y-6">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">Controlled routing</p>
          <h2 class="mt-1 text-xl font-bold tracking-tight text-neutral-900">Intent Catalog</h2>
          <p class="mt-1 max-w-2xl text-sm text-neutral-500">Upload the approved Excel contract, review the server-validated draft, then publish one tenant-scoped version for chat and workflow decisions.</p>
        </div>
        <label class="cursor-pointer rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white hover:bg-neutral-800">
          Upload .xlsx
          <input class="sr-only" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" (change)="upload($event)" />
        </label>
      </div>
      <div *ngIf="(service.versions$ | async)?.length === 0" class="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center text-sm text-neutral-500">No catalog versions have been imported yet.</div>
      <div class="space-y-3">
        <article *ngFor="let version of service.versions$ | async" class="rounded-2xl border border-neutral-200 bg-white p-5 shadow-card">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div class="flex items-center gap-2"><span class="font-mono text-sm font-bold">v{{ version.version }}</span><app-badge [variant]="version.status === 'published' ? 'black' : 'outline'" [showDot]="version.status === 'published'" [text]="version.status | uppercase"></app-badge></div>
              <p class="mt-1 text-xs text-neutral-500">{{ version.sourceFileName }} · {{ version.catalog.intents.length }} intents · {{ version.catalog.workflowBindings.length }} workflow bindings</p>
              <p class="mt-1 text-[11px] text-neutral-400">Imported {{ version.createdAt | date:'medium' }}<span *ngIf="version.publishedAt"> · Published {{ version.publishedAt | date:'medium' }}</span></p>
            </div>
            <button *ngIf="version.status !== 'published'" type="button" (click)="publish(version)" class="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Publish version</button>
          </div>
          <div class="mt-4 flex flex-wrap gap-2"><span *ngFor="let intent of version.catalog.intents" class="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-mono text-neutral-700">{{ intent.intentKey }}<span *ngIf="!intent.active" class="ml-1 text-neutral-400">(inactive)</span></span></div>
        </article>
      </div>
    </section>
  `
})
export class IntentCatalogComponent implements OnInit {
  readonly service = inject(IntentCatalogService);

  ngOnInit(): void { this.service.load(); }

  upload(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.service.upload(file);
    input.value = '';
  }

  publish(version: IntentCatalogVersion): void { this.service.publish(version); }
}

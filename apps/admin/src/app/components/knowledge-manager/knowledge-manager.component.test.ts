import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { signal, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { KnowledgeManagerComponent } from './knowledge-manager.component';
import { AdminStateService } from '../../services/admin-state.service';
import { Source } from '../../types/admin.types';

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    querySelector: () => null,
    createElement: () => ({ setAttribute: () => {} }),
    createTextNode: () => ({}),
    createComment: () => ({})
  };
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = { document: (globalThis as any).document };
}

try {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
} catch {
  // Already initialized
}

describe('KnowledgeManagerComponent Pagination Regression', () => {
  const baseTime = 1700000000000;
  const createMockSource = (id: number): Source => ({
    id: `src-${id}`,
    title: `Policy Document ${String(id).padStart(2, '0')}`,
    mimeType: 'text/plain',
    status: 'active',
    audience: 'public',
    chunkCount: 3,
    createdAt: new Date(baseTime + id * 1000).toISOString(),
    updatedAt: new Date(baseTime + id * 1000).toISOString()
  });

  it('synchronizes currentPage when dataset shrinks and prevents jumping to page 2 when dataset regrows', () => {
    const initialSources: Source[] = Array.from({ length: 11 }, (_, i) => createMockSource(i + 1));
    const sourcesSignal = signal<Source[]>(initialSources);

    const mockAdminState = {
      sources: sourcesSignal,
      loadSources: vi.fn(),
      loadJobs: vi.fn(),
      showToast: vi.fn(),
      publishSource: vi.fn(),
      revokeSource: vi.fn(),
      purgeSource: vi.fn(),
      reindexSource: vi.fn(),
      stageSource: vi.fn(),
      knowledge: {
        queueFileUpload: vi.fn(),
        queueCrawl: vi.fn()
      }
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: AdminStateService, useValue: mockAdminState }
      ]
    });

    const component = runInInjectionContext(TestBed.inject(EnvironmentInjector), () => new KnowledgeManagerComponent());
    component.sortColumn = 'title';
    component.sortAscending = true;
    component.ngOnInit();
    TestBed.flushEffects();

    expect(component.totalPages).toBe(2);
    expect(component.currentPage).toBe(1);
    expect(component.paginatedSources.length).toBe(10);
    expect(component.paginatedSources[0].id).toBe('src-1');

    // 1. User navigates to page 2
    component.currentPage = 2;
    expect(component.currentPage).toBe(2);
    expect(component.paginatedSources.length).toBe(1);
    expect(component.paginatedSources[0].id).toBe('src-11');

    // 2. Shrinkage: 1 source is purged, leaving 10 items
    const shrunkSources = initialSources.slice(0, 10);
    sourcesSignal.set(shrunkSources);
    TestBed.flushEffects();

    // Verify parent currentPage is synchronized to 1
    expect(component.totalPages).toBe(1);
    expect(component.currentPage).toBe(1);
    expect(component.safeCurrentPage).toBe(1);
    expect(component.paginatedSources.length).toBe(10);
    expect(component.paginatedSources[0].id).toBe('src-1');

    // 3. Regrowth: An 11th source appears again
    const regrownSources = [...shrunkSources, createMockSource(11)];
    sourcesSignal.set(regrownSources);
    TestBed.flushEffects();

    // Verify parent currentPage DOES NOT jump back to 2!
    expect(component.totalPages).toBe(2);
    expect(component.currentPage).toBe(1);
    expect(component.safeCurrentPage).toBe(1);
    expect(component.paginatedSources.length).toBe(10);
    expect(component.paginatedSources[0].id).toBe('src-1');

    // 4. Explicit user navigation to page 2 works as expected
    component.currentPage = 2;
    expect(component.currentPage).toBe(2);
    expect(component.paginatedSources.length).toBe(1);
    expect(component.paginatedSources[0].id).toBe('src-11');
  });
});

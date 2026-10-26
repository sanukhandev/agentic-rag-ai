import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { SimpleChange } from '@angular/core';
import { PaginationComponent } from './pagination.component';
import { ConfirmDialogComponent } from './confirm-dialog.component';

describe('PaginationComponent', () => {
  it('calculates totalPages, startIndex, and endIndex correctly', () => {
    const component = new PaginationComponent();
    component.totalItems = 25;
    component.pageSize = 10;
    component.currentPage = 1;

    expect(component.totalPages).toBe(3);
    expect(component.startIndex).toBe(1);
    expect(component.endIndex).toBe(10);

    component.currentPage = 3;
    expect(component.startIndex).toBe(21);
    expect(component.endIndex).toBe(25);
  });

  it('clamps safeCurrentPage when items shrink', () => {
    const component = new PaginationComponent();
    component.totalItems = 10;
    component.pageSize = 10;
    component.currentPage = 2; // User was on page 2 before list shrunk

    expect(component.totalPages).toBe(1);
    expect(component.safeCurrentPage).toBe(1);
    expect(component.startIndex).toBe(1);
    expect(component.endIndex).toBe(10);
  });

  it('emits pageChange on ngOnChanges when currentPage exceeds totalPages during shrinkage and does not re-emit when regrown', () => {
    const component = new PaginationComponent();
    component.totalItems = 11;
    component.pageSize = 10;
    component.currentPage = 2;

    const emitted: number[] = [];
    component.pageChange.subscribe((page) => emitted.push(page));

    // Shrinkage: 11 -> 10 items
    component.totalItems = 10;
    component.ngOnChanges({
      totalItems: new SimpleChange(11, 10, false)
    });

    expect(emitted).toEqual([1]);

    // Parent component synchronizes currentPage to 1 based on pageChange event
    component.currentPage = 1;

    // Regrowth: 10 -> 11 items
    component.totalItems = 11;
    component.ngOnChanges({
      totalItems: new SimpleChange(10, 11, false)
    });

    // Verify it stays at page 1 and does not emit page 2
    expect(emitted).toEqual([1]);
    expect(component.safeCurrentPage).toBe(1);
  });

  it('generates correct visible pages with ellipsis', () => {
    const component = new PaginationComponent();
    component.totalItems = 100;
    component.pageSize = 10;
    component.currentPage = 5;

    expect(component.totalPages).toBe(10);
    const visible = component.visiblePages;
    expect(visible).toContain(1);
    expect(visible).toContain(10);
    expect(visible).toContain(5);
    expect(visible).toContain(-1); // ellipsis marker
  });
});

describe('ConfirmDialogComponent', () => {
  it('handles confirmation and cancellation events', () => {
    const component = new ConfirmDialogComponent();
    let confirmed = false;
    let cancelled = false;

    component.confirm.subscribe(() => { confirmed = true; });
    component.cancel.subscribe(() => { cancelled = true; });

    component.onConfirm();
    expect(confirmed).toBe(true);

    component.onCancel();
    expect(cancelled).toBe(true);
  });

  it('manages focus lifecycle across open, close, and destroy', () => {
    const component = new ConfirmDialogComponent();
    const mockTrigger = { focus: vi.fn() } as unknown as HTMLElement;
    const mockCancelBtn = { focus: vi.fn() } as unknown as HTMLButtonElement;

    (globalThis as any).document = {
      activeElement: mockTrigger
    };

    component.cancelBtn = { nativeElement: mockCancelBtn };
    component.isOpen = true;
    component.ngOnChanges({
      isOpen: new SimpleChange(false, true, true)
    });

    // When closed, previous trigger focus is restored
    component.isOpen = false;
    component.ngOnChanges({
      isOpen: new SimpleChange(true, false, false)
    });

    expect(mockTrigger.focus).toHaveBeenCalledTimes(1);

    // Clean destruction also ensures no stranded focus
    component.ngOnDestroy();
  });

  it('handles Escape key to cancel', () => {
    const component = new ConfirmDialogComponent();
    let cancelled = false;
    component.cancel.subscribe(() => { cancelled = true; });

    const escapeEvent = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent;

    component.isOpen = false;
    component.onKeydown(escapeEvent);
    expect(cancelled).toBe(false);

    component.isOpen = true;
    component.onKeydown(escapeEvent);
    expect(cancelled).toBe(true);
  });

  it('traps tab focus within the dialog bounds', () => {
    const component = new ConfirmDialogComponent();
    component.isOpen = true;

    const firstBtn = { focus: vi.fn() } as unknown as HTMLElement;
    const lastBtn = { focus: vi.fn() } as unknown as HTMLElement;

    component.dialogContent = {
      nativeElement: {
        querySelectorAll: () => [firstBtn, lastBtn]
      } as unknown as HTMLDivElement
    };

    // Forward Tab at end wraps to first element
    (globalThis as any).document.activeElement = lastBtn;
    const tabEvent = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    component.onKeydown(tabEvent);
    expect(tabEvent.preventDefault).toHaveBeenCalled();
    expect(firstBtn.focus).toHaveBeenCalled();

    // Shift+Tab at beginning wraps to last element
    (globalThis as any).document.activeElement = firstBtn;
    const shiftTabEvent = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent;
    component.onKeydown(shiftTabEvent);
    expect(shiftTabEvent.preventDefault).toHaveBeenCalled();
    expect(lastBtn.focus).toHaveBeenCalled();
  });
});

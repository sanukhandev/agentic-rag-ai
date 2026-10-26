import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-pagination',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div
      *ngIf="totalItems > 0"
      class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-neutral-100 text-xs text-neutral-600"
      role="navigation"
      aria-label="Pagination Navigation"
    >
      <!-- Range Summary -->
      <div class="flex items-center gap-2">
        <span>
          Showing <span class="font-semibold text-neutral-900">{{ startIndex }}</span> to
          <span class="font-semibold text-neutral-900">{{ endIndex }}</span> of
          <span class="font-semibold text-neutral-900">{{ totalItems }}</span> records
        </span>

        <!-- Page Size Selector -->
        <div class="flex items-center gap-1.5 ml-2 border-l border-neutral-200 pl-3">
          <span class="text-[11px] text-neutral-500">Per page:</span>
          <select
            [value]="pageSize"
            (change)="onPageSizeSelect($event)"
            class="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-xs text-neutral-800 focus:border-neutral-900 focus:outline-none"
          >
            <option *ngFor="let size of pageSizeOptions" [value]="size">{{ size }}</option>
          </select>
        </div>
      </div>

      <!-- Pagination Buttons -->
      <div class="flex items-center gap-1 self-end sm:self-auto">
        <!-- Previous Page -->
        <button
          type="button"
          (click)="goToPage(currentPage - 1)"
          [disabled]="currentPage <= 1"
          class="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Previous page"
          aria-label="Previous page"
        >
          <app-icon name="chevron-down" classNames="w-3 h-3 rotate-90"></app-icon>
        </button>

        <!-- Page Numbers -->
        <ng-container *ngFor="let page of visiblePages">
          <button
            *ngIf="page !== -1; else ellipsis"
            type="button"
            (click)="goToPage(page)"
            class="h-7 min-w-[28px] px-2 rounded-lg text-xs font-medium transition-colors"
            [ngClass]="page === currentPage ? 'bg-neutral-900 text-white font-semibold' : 'border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'"
            [attr.aria-current]="page === currentPage ? 'page' : null"
          >
            {{ page }}
          </button>
          <ng-template #ellipsis>
            <span class="px-1 text-neutral-400">…</span>
          </ng-template>
        </ng-container>

        <!-- Next Page -->
        <button
          type="button"
          (click)="goToPage(currentPage + 1)"
          [disabled]="currentPage >= totalPages"
          class="flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Next page"
          aria-label="Next page"
        >
          <app-icon name="chevron-down" classNames="w-3 h-3 -rotate-90"></app-icon>
        </button>
      </div>
    </div>
  `
})
export class PaginationComponent {
  @Input() totalItems = 0;
  @Input() pageSize = 10;
  @Input() currentPage = 1;
  @Input() pageSizeOptions = [10, 25, 50];

  @Output() pageChange = new EventEmitter<number>();
  @Output() pageSizeChange = new EventEmitter<number>();

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.totalItems / this.pageSize));
  }

  get startIndex(): number {
    if (this.totalItems === 0) return 0;
    return (this.currentPage - 1) * this.pageSize + 1;
  }

  get endIndex(): number {
    return Math.min(this.currentPage * this.pageSize, this.totalItems);
  }

  get visiblePages(): number[] {
    const pages: number[] = [];
    const total = this.totalPages;
    if (total <= 5) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (this.currentPage > 3) pages.push(-1);
      const start = Math.max(2, this.currentPage - 1);
      const end = Math.min(total - 1, this.currentPage + 1);
      for (let i = start; i <= end; i++) {
        if (!pages.includes(i)) pages.push(i);
      }
      if (this.currentPage < total - 2) pages.push(-1);
      if (!pages.includes(total)) pages.push(total);
    }
    return pages;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.pageChange.emit(page);
    }
  }

  onPageSizeSelect(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const newSize = parseInt(target.value, 10);
    if (!isNaN(newSize) && newSize > 0) {
      this.pageSizeChange.emit(newSize);
    }
  }
}

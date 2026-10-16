import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService, ToastMessage } from '../../services/admin-state.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div
      class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
      aria-live="polite"
    >
      <div
        *ngFor="let toast of toasts"
        class="pointer-events-auto rounded-xl border p-4 shadow-xl backdrop-blur-md transition-all animate-slide-up flex items-start justify-between gap-3"
        [ngClass]="getToastClasses(toast.type)"
      >
        <div class="flex items-start gap-3">
          <div class="mt-0.5">
            <app-icon [name]="getToastIcon(toast.type)" classNames="w-4 h-4"></app-icon>
          </div>
          <div>
            <h5 class="text-xs font-semibold">{{ toast.title }}</h5>
            <p *ngIf="toast.message" class="mt-0.5 text-[11px] opacity-80 leading-relaxed">
              {{ toast.message }}
            </p>
          </div>
        </div>

        <button
          type="button"
          (click)="dismiss(toast.id)"
          class="opacity-60 hover:opacity-100 transition-opacity"
        >
          <app-icon name="x" classNames="w-3.5 h-3.5"></app-icon>
        </button>
      </div>
    </div>
  `
})
export class ToastComponent {
  private readonly state = inject(AdminStateService);

  toasts: ToastMessage[] = [];

  constructor() {
    this.state.toasts$.subscribe((t) => (this.toasts = t));
  }

  dismiss(id: string): void {
    this.state.dismissToast(id);
  }

  getToastIcon(type: string): string {
    switch (type) {
      case 'success':
        return 'check-circle';
      case 'warning':
      case 'error':
        return 'alert-circle';
      case 'info':
      default:
        return 'sparkles';
    }
  }

  getToastClasses(type: string): string {
    switch (type) {
      case 'success':
        return 'bg-neutral-900 text-white border-neutral-800';
      case 'warning':
        return 'bg-amber-50 text-amber-900 border-amber-200';
      case 'error':
        return 'bg-rose-50 text-rose-900 border-rose-200';
      case 'info':
      default:
        return 'bg-white text-neutral-900 border-neutral-200';
    }
  }
}

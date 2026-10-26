import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, IconComponent],
  template: `
    <div
      *ngIf="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/50 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="dialogId + '-title'"
    >
      <div
        class="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-6 shadow-2xl animate-scale-in"
        (click)="$event.stopPropagation()"
      >
        <!-- Icon & Title -->
        <div class="flex items-start gap-3.5">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            [ngClass]="isDanger ? 'bg-rose-50 text-rose-600' : 'bg-neutral-100 text-neutral-800'"
          >
            <app-icon [name]="isDanger ? 'alert-circle' : 'info'" classNames="w-5 h-5"></app-icon>
          </div>
          <div>
            <h3 [id]="dialogId + '-title'" class="text-base font-semibold text-neutral-900 leading-tight">
              {{ title }}
            </h3>
            <p class="mt-1.5 text-xs text-neutral-600 leading-relaxed">
              {{ message }}
            </p>
            <p *ngIf="consequence" class="mt-2 text-[11px] font-medium text-rose-700 bg-rose-50 p-2 rounded-lg border border-rose-200/60 leading-relaxed">
              ⚠️ {{ consequence }}
            </p>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-neutral-100">
          <button
            type="button"
            (click)="onCancel()"
            class="rounded-lg border border-neutral-200 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors button-press"
          >
            {{ cancelText }}
          </button>
          <button
            type="button"
            (click)="onConfirm()"
            class="rounded-lg px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all button-press"
            [ngClass]="isDanger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-neutral-900 hover:bg-neutral-800'"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ConfirmDialogComponent {
  private static nextId = 1;
  readonly dialogId = `confirm-dialog-${ConfirmDialogComponent.nextId++}`;

  @Input() isOpen = false;
  @Input() title = 'Confirm Action';
  @Input() message = 'Are you sure you want to proceed?';
  @Input() consequence = '';
  @Input() confirmText = 'Confirm';
  @Input() cancelText = 'Cancel';
  @Input() isDanger = true;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.isOpen) {
      this.onCancel();
    }
  }

  onConfirm(): void {
    this.confirm.emit();
  }

  onCancel(): void {
    this.cancel.emit();
  }
}

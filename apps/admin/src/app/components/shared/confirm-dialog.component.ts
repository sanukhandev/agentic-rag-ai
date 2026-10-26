import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild
} from '@angular/core';
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
      [attr.aria-describedby]="dialogId + '-desc'"
      (click)="onCancel()"
    >
      <div
        #dialogContent
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
            <p [id]="dialogId + '-desc'" class="mt-1.5 text-xs text-neutral-600 leading-relaxed">
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
            #cancelBtn
            type="button"
            (click)="onCancel()"
            class="rounded-lg border border-neutral-200 bg-white px-3.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors button-press focus:outline-none focus:ring-2 focus:ring-neutral-400"
          >
            {{ cancelText }}
          </button>
          <button
            #confirmBtn
            type="button"
            (click)="onConfirm()"
            class="rounded-lg px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-all button-press focus:outline-none focus:ring-2"
            [ngClass]="isDanger ? 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500' : 'bg-neutral-900 hover:bg-neutral-800 focus:ring-neutral-900'"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  `
})
export class ConfirmDialogComponent implements OnChanges, OnDestroy {
  private static nextId = 1;
  readonly dialogId = `confirm-dialog-${ConfirmDialogComponent.nextId++}`;
  private previouslyFocusedElement: HTMLElement | null = null;

  @ViewChild('cancelBtn') cancelBtn?: ElementRef<HTMLButtonElement>;
  @ViewChild('dialogContent') dialogContent?: ElementRef<HTMLDivElement>;

  @Input() isOpen = false;
  @Input() title = 'Confirm Action';
  @Input() message = 'Are you sure you want to proceed?';
  @Input() consequence = '';
  @Input() confirmText = 'Confirm';
  @Input() cancelText = 'Cancel';
  @Input() isDanger = true;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        this.previouslyFocusedElement = document.activeElement as HTMLElement | null;
        // Shift focus into dialog (Cancel button by default for safe keyboard confirmation)
        setTimeout(() => this.cancelBtn?.nativeElement?.focus(), 0);
      } else if (this.previouslyFocusedElement) {
        this.previouslyFocusedElement.focus();
        this.previouslyFocusedElement = null;
      }
    }
  }

  ngOnDestroy(): void {
    if (this.previouslyFocusedElement) {
      this.previouslyFocusedElement.focus();
      this.previouslyFocusedElement = null;
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.onCancel();
      return;
    }

    if (event.key === 'Tab' && this.dialogContent) {
      const focusable = this.dialogContent.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  onConfirm(): void {
    this.confirm.emit();
  }

  onCancel(): void {
    this.cancel.emit();
  }
}

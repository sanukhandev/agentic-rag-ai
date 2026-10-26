import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-badge',
  standalone: true,
  imports: [CommonModule],
  template: `
    <span
      class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium tracking-tight border transition-colors select-none"
      [ngClass]="badgeClass"
    >
      <span *ngIf="showDot" class="w-1.5 h-1.5 rounded-full" [ngClass]="dotClass"></span>
      <ng-content></ng-content>
      {{ text }}
    </span>
  `
})
export class BadgeComponent {
  @Input() variant: 'neutral' | 'success' | 'warning' | 'error' | 'outline' | 'black' = 'neutral';
  @Input() text = '';
  @Input() showDot = true;

  get badgeClass(): string {
    switch (this.variant) {
      case 'success':
        return 'bg-emerald-50 text-emerald-800 border-emerald-200';
      case 'warning':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'error':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      case 'black':
        return 'bg-neutral-900 text-white border-neutral-900';
      case 'outline':
        return 'bg-white text-neutral-700 border-neutral-300';
      case 'neutral':
      default:
        return 'bg-neutral-100 text-neutral-700 border-neutral-200';
    }
  }

  get dotClass(): string {
    switch (this.variant) {
      case 'success':
        return 'bg-emerald-600 animate-pulse';
      case 'warning':
        return 'bg-amber-600';
      case 'error':
        return 'bg-rose-600';
      case 'black':
        return 'bg-neutral-400';
      case 'outline':
      case 'neutral':
      default:
        return 'bg-neutral-500';
    }
  }
}

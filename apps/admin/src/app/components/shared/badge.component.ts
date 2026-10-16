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
        return 'bg-[#166534]/10 text-[#166534] border-[#166534]/20';
      case 'warning':
        return 'bg-[#B45309]/10 text-[#B45309] border-[#B45309]/20';
      case 'error':
        return 'bg-[#B91C1C]/10 text-[#B91C1C] border-[#B91C1C]/20';
      case 'black':
        return 'bg-[#111111] text-[#FFFFFF] border-[#111111]';
      case 'outline':
        return 'bg-[#FFFFFF] text-[#525252] border-[#E5E5E5]';
      case 'neutral':
      default:
        return 'bg-[#F5F5F5] text-[#525252] border-[#E5E5E5]';
    }
  }

  get dotClass(): string {
    switch (this.variant) {
      case 'success':
        return 'bg-[#166534] animate-pulse';
      case 'warning':
        return 'bg-[#B45309]';
      case 'error':
        return 'bg-[#B91C1C]';
      case 'black':
        return 'bg-[#A3A3A3]';
      case 'outline':
      case 'neutral':
      default:
        return 'bg-[#737373]';
    }
  }
}

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-icon',
  standalone: true,
  imports: [CommonModule],
  template: `
    <svg
      [attr.viewBox]="viewBox"
      [attr.fill]="fill"
      [attr.stroke]="stroke"
      [attr.stroke-width]="strokeWidth"
      stroke-linecap="round"
      stroke-linejoin="round"
      [ngClass]="classNames"
      aria-hidden="true"
    >
      <!-- Logo / Brand Icon -->
      <ng-container *ngIf="name === 'logo'">
        <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" fill-opacity="0.1" />
        <path d="M12 7v10M7 12l5-5 5 5" stroke="currentColor" stroke-width="2" />
      </ng-container>

      <!-- Navigation Icons -->
      <ng-container *ngIf="name === 'building' || name === 'organizations'">
        <rect width="16" height="20" x="4" y="2" rx="2" />
        <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01" />
      </ng-container>

      <ng-container *ngIf="name === 'book-open' || name === 'knowledge'">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
      </ng-container>

      <ng-container *ngIf="name === 'bot' || name === 'studio' || name === 'ai'">
        <rect width="18" height="12" x="3" y="6" rx="2" />
        <path d="M9 12h.01M15 12h.01M12 2v4M2 12h1M21 12h1M6 18v2M18 18v2" />
      </ng-container>

      <ng-container *ngIf="name === 'activity' || name === 'observability'">
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
      </ng-container>

      <ng-container *ngIf="name === 'settings'">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </ng-container>

      <ng-container *ngIf="name === 'layers' || name === 'overview'">
        <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
        <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
        <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
      </ng-container>

      <!-- Action & Utility Icons -->
      <ng-container *ngIf="name === 'search'">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </ng-container>

      <ng-container *ngIf="name === 'command'">
        <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z" />
      </ng-container>

      <ng-container *ngIf="name === 'plus'">
        <path d="M5 12h14M12 5v14" />
      </ng-container>

      <ng-container *ngIf="name === 'check'">
        <path d="M20 6 9 17l-5-5" />
      </ng-container>

      <ng-container *ngIf="name === 'x'">
        <path d="M18 6 6 18M6 6l12 12" />
      </ng-container>

      <ng-container *ngIf="name === 'chevron-down'">
        <path d="m6 9 6 6 6-6" />
      </ng-container>

      <ng-container *ngIf="name === 'chevron-right'">
        <path d="m9 18 6-6-6-6" />
      </ng-container>

      <ng-container *ngIf="name === 'arrow-up-right'">
        <path d="M7 17 17 7M7 7h10v10" />
      </ng-container>

      <ng-container *ngIf="name === 'arrow-down-right'">
        <path d="m7 7 10 10M17 7v10H7" />
      </ng-container>

      <ng-container *ngIf="name === 'refresh' || name === 'rotate-ccw'">
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 21v-5h5" />
      </ng-container>

      <ng-container *ngIf="name === 'upload'">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" x2="12" y1="3" y2="15" />
      </ng-container>

      <ng-container *ngIf="name === 'shield'">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      </ng-container>

      <ng-container *ngIf="name === 'database'">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
        <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
      </ng-container>

      <ng-container *ngIf="name === 'cpu'">
        <rect width="16" height="16" x="4" y="4" rx="2" />
        <rect width="6" height="6" x="9" y="9" rx="1" />
        <path d="M15 2v2M9 2v2M20 15h2M20 9h2M9 20v2M15 20v2M2 9h2M2 15h2" />
      </ng-container>

      <ng-container *ngIf="name === 'users'">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </ng-container>

      <ng-container *ngIf="name === 'globe'">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20" />
      </ng-container>

      <ng-container *ngIf="name === 'link'">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </ng-container>

      <ng-container *ngIf="name === 'file' || name === 'file-text'">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8" />
      </ng-container>

      <ng-container *ngIf="name === 'trash'">
        <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6" />
      </ng-container>

      <ng-container *ngIf="name === 'eye'">
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </ng-container>

      <ng-container *ngIf="name === 'more-vertical'">
        <circle cx="12" cy="12" r="1" />
        <circle cx="12" cy="5" r="1" />
        <circle cx="12" cy="19" r="1" />
      </ng-container>

      <ng-container *ngIf="name === 'sparkles'">
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
      </ng-container>

      <ng-container *ngIf="name === 'clock'">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </ng-container>

      <ng-container *ngIf="name === 'alert-circle'">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" x2="12" y1="8" y2="12" />
        <line x1="12" x2="12.01" y1="16" y2="16" />
      </ng-container>

      <ng-container *ngIf="name === 'check-circle'">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </ng-container>

      <ng-container *ngIf="name === 'lock'">
        <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </ng-container>

      <ng-container *ngIf="name === 'play'">
        <polygon points="6 3 20 12 6 21 6 3" />
      </ng-container>

      <ng-container *ngIf="name === 'bell'">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </ng-container>

      <ng-container *ngIf="name === 'send' || name === 'arrow-up'">
        <path d="m5 12 7-7 7 7M12 19V5" />
      </ng-container>

      <ng-container *ngIf="name === 'chevron-up'">
        <path d="m18 15-6-6-6 6" />
      </ng-container>

      <ng-container *ngIf="name === 'copy'">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </ng-container>

      <ng-container *ngIf="name === 'thumbs-up'">
        <path d="M7 10v12M15 10.5a3 3 0 0 0-3-3l.5-4a1.5 1.5 0 0 0-3 0L7 10v12h10.3a2 2 0 0 0 1.95-1.57l1.65-7.43A2 2 0 0 0 18.95 10.5H15Z" />
      </ng-container>

      <ng-container *ngIf="name === 'thumbs-down'">
        <path d="M17 14V2M9 13.5a3 3 0 0 0 3 3l-.5 4a1.5 1.5 0 0 0 3 0L17 14V2H6.7a2 2 0 0 0-1.95 1.57l-1.65 7.43A2 2 0 0 0 5.05 13.5H9Z" />
      </ng-container>

      <ng-container *ngIf="name === 'message-square' || name === 'chat'">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </ng-container>

      <ng-container *ngIf="name === 'info'">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </ng-container>
    </svg>
  `
})
export class IconComponent {
  @Input() name = 'activity';
  @Input() classNames = 'w-4 h-4';
  @Input() viewBox = '0 0 24 24';
  @Input() fill = 'none';
  @Input() stroke = 'currentColor';
  @Input() strokeWidth = '1.75';
}

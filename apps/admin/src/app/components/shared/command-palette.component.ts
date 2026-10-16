import { Component, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { NavSection, Tenant, Source } from '../../types/admin.types';
import { IconComponent } from './icon.component';

interface CommandItem {
  id: string;
  title: string;
  category: 'Navigation' | 'Actions' | 'Tenants' | 'Sources';
  icon: string;
  shortcut?: string;
  action: () => void;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div
      *ngIf="isOpen"
      class="fixed inset-0 z-50 overflow-y-auto bg-neutral-900/50 backdrop-blur-sm p-4 sm:p-6 md:p-20 flex justify-center items-start animate-fade-in"
      (click)="close()"
      aria-modal="true"
      role="dialog"
    >
      <div
        class="w-full max-w-xl rounded-2xl border border-neutral-200 bg-white shadow-2xl overflow-hidden animate-scale-in"
        (click)="$event.stopPropagation()"
      >
        <!-- Search Input Header -->
        <div class="relative border-b border-neutral-100 flex items-center px-4 py-3">
          <app-icon name="search" classNames="w-4 h-4 text-neutral-400 mr-3"></app-icon>
          <input
            #searchInput
            [(ngModel)]="query"
            type="text"
            placeholder="Type a command, section, or search term..."
            class="w-full text-xs sm:text-sm text-neutral-900 placeholder-neutral-400 focus:outline-none bg-transparent"
          />
          <kbd class="rounded border border-neutral-200 bg-neutral-50 px-2 py-0.5 text-[10px] font-mono text-neutral-400">
            Esc
          </kbd>
        </div>

        <!-- Filtered Command Results List -->
        <div class="max-h-80 overflow-y-auto p-2 space-y-1">
          <div *ngFor="let item of filteredItems; let i = index">
            <button
              type="button"
              (click)="execute(item)"
              class="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors"
              [ngClass]="selectedIndex === i ? 'bg-neutral-100 text-neutral-900 font-medium' : 'text-neutral-700 hover:bg-neutral-50'"
            >
              <div class="flex items-center gap-3">
                <div class="flex h-6 w-6 items-center justify-center rounded-md bg-white border border-neutral-200 text-neutral-600">
                  <app-icon [name]="item.icon" classNames="w-3.5 h-3.5"></app-icon>
                </div>
                <span>{{ item.title }}</span>
              </div>
              <span class="rounded bg-neutral-100/70 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
                {{ item.category }}
              </span>
            </button>
          </div>

          <div *ngIf="filteredItems.length === 0" class="py-8 text-center text-xs text-neutral-400">
            No matching commands or entities found for "{{ query }}".
          </div>
        </div>

        <!-- Footer Help -->
        <div class="border-t border-neutral-100 bg-neutral-50/70 px-4 py-2.5 flex items-center justify-between text-[11px] text-neutral-400">
          <div class="flex items-center gap-2">
            <span>Navigation:</span>
            <kbd class="font-mono text-[10px] bg-white border px-1 rounded">↑↓</kbd>
            <span>Select:</span>
            <kbd class="font-mono text-[10px] bg-white border px-1 rounded">Enter</kbd>
          </div>
          <span>Agentic RAG AI Admin Command Center</span>
        </div>
      </div>
    </div>
  `
})
export class CommandPaletteComponent {
  private readonly state = inject(AdminStateService);

  isOpen = false;
  query = '';
  selectedIndex = 0;

  tenants: Tenant[] = [];
  sources: Source[] = [];

  constructor() {
    this.state.commandPaletteOpen$.subscribe((open) => {
      this.isOpen = open;
      if (open) {
        this.query = '';
        this.selectedIndex = 0;
      }
    });
    this.state.tenants$.subscribe((t) => (this.tenants = t));
    this.state.sources$.subscribe((s) => (this.sources = s));
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (this.isOpen) {
        this.close();
      } else {
        this.state.openCommandPalette();
      }
      return;
    }

    if (!this.isOpen) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % Math.max(1, this.filteredItems.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.filteredItems.length) % Math.max(1, this.filteredItems.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (this.filteredItems[this.selectedIndex]) {
        this.execute(this.filteredItems[this.selectedIndex]);
      }
    }
  }

  close(): void {
    this.state.closeCommandPalette();
  }

  execute(item: CommandItem): void {
    item.action();
    this.close();
  }

  get allItems(): CommandItem[] {
    const list: CommandItem[] = [
      {
        id: 'nav-overview',
        title: 'Go to Overview Dashboard',
        category: 'Navigation',
        icon: 'overview',
        action: () => this.state.setSection('overview')
      },
      {
        id: 'nav-organizations',
        title: 'Go to Organizations Directory',
        category: 'Navigation',
        icon: 'organizations',
        action: () => this.state.setSection('organizations')
      },
      {
        id: 'nav-knowledge',
        title: 'Go to Knowledge Catalog & Ingestion',
        category: 'Navigation',
        icon: 'knowledge',
        action: () => this.state.setSection('knowledge')
      },
      {
        id: 'nav-studio',
        title: 'Go to AI Agent Studio & Persona Rules',
        category: 'Navigation',
        icon: 'studio',
        action: () => this.state.setSection('studio')
      },
      {
        id: 'nav-observability',
        title: 'Go to Observability & Telemetry Matrix',
        category: 'Navigation',
        icon: 'observability',
        action: () => this.state.setSection('observability')
      },
      {
        id: 'nav-settings',
        title: 'Go to Settings & Domain Governance',
        category: 'Navigation',
        icon: 'settings',
        action: () => this.state.setSection('settings')
      },
      {
        id: 'act-new-org',
        title: 'Provision New Organization',
        category: 'Actions',
        icon: 'plus',
        action: () => {
          this.state.setSection('organizations');
          this.state.openCreateOrgDrawer();
        }
      },
      {
        id: 'act-stage-source',
        title: 'Stage Source Document for Review',
        category: 'Actions',
        icon: 'upload',
        action: () => {
          this.state.setSection('knowledge');
          this.state.openUploadModal();
        }
      },
      {
        id: 'act-purge-sessions',
        title: 'Execute 24h Expired Sessions Purge',
        category: 'Actions',
        icon: 'trash',
        action: () => {
          this.state.setSection('settings');
          this.state.showToast('info', 'Retention Tool', 'Opening session retention purge panel.');
        }
      }
    ];

    // Add tenants
    for (const t of this.tenants) {
      list.push({
        id: `tenant-${t.id}`,
        title: `Tenant: ${t.name} (${t.slug})`,
        category: 'Tenants',
        icon: 'building',
        action: () => {
          this.state.selectTenant(t);
          this.state.setSection('organizations');
        }
      });
    }

    // Add sources
    for (const s of this.sources.slice(0, 5)) {
      list.push({
        id: `source-${s.id}`,
        title: `Source: ${s.title}`,
        category: 'Sources',
        icon: 'file-text',
        action: () => this.state.setSection('knowledge')
      });
    }

    return list;
  }

  get filteredItems(): CommandItem[] {
    const q = this.query.toLowerCase().trim();
    if (!q) return this.allItems;
    return this.allItems.filter((i) => i.title.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  }
}

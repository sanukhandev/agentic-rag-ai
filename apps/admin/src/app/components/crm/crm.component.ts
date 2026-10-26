import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { CrmLead } from '../../types/admin.types';
import { BadgeComponent } from '../shared/badge.component';
import { IconComponent } from '../shared/icon.component';
import { PaginationComponent } from '../shared/pagination.component';

@Component({
  selector: 'app-crm',
  standalone: true,
  imports: [CommonModule, FormsModule, BadgeComponent, IconComponent, PaginationComponent],
  template: `
    <section class="space-y-6 animate-fade-in">
      <!-- Section Header -->
      <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-neutral-200/80 pb-5">
        <div>
          <div class="flex items-center gap-2">
            <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-500">Customer Intelligence</p>
            <app-badge variant="neutral" [showDot]="false" text="">
              {{ leads.length }} {{ leads.length === 1 ? 'Lead' : 'Leads' }}
            </app-badge>
            <app-badge variant="success" [showDot]="true" text="Vault Rehydration Active"></app-badge>
          </div>
          <h2 class="mt-1.5 text-2xl font-bold tracking-tight text-neutral-900 font-sans">
            CRM Leads & Contact Inquiries
          </h2>
          <p class="mt-1 text-xs sm:text-sm text-neutral-500 max-w-2xl leading-relaxed">
            Validated customer leads captured through conversation. PII is encrypted in Node/PostgreSQL and rehydrated securely at the authorized administrative boundary for sales follow-up.
          </p>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <button
            type="button"
            (click)="refresh()"
            [disabled]="isLoading"
            class="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-semibold text-neutral-700 shadow-xs hover:bg-neutral-50 hover:border-neutral-300 transition-all button-press disabled:opacity-60"
          >
            <app-icon
              name="refresh"
              classNames="w-3.5 h-3.5 text-neutral-500"
              [ngClass]="{ 'animate-spin': isLoading }"
            ></app-icon>
            <span>{{ isLoading ? 'Refreshing...' : 'Refresh Leads' }}</span>
          </button>
        </div>
      </div>

      <!-- Quick Metrics Summary Strip -->
      <div *ngIf="leads.length > 0" class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div class="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-subtle">
          <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Total Leads</span>
          <p class="mt-1 text-xl font-bold text-neutral-900">{{ leads.length }}</p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-subtle">
          <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Hot Leads</span>
          <p class="mt-1 text-xl font-bold text-rose-700">{{ hotCount }}</p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-subtle">
          <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Warm Leads</span>
          <p class="mt-1 text-xl font-bold text-amber-700">{{ warmCount }}</p>
        </div>
        <div class="rounded-xl border border-neutral-200 bg-white p-3.5 shadow-subtle">
          <span class="text-[10px] font-bold uppercase tracking-wider text-neutral-500">Validated</span>
          <p class="mt-1 text-xl font-bold text-emerald-700">{{ validatedCount }}</p>
        </div>
      </div>

      <!-- Search & Filter Controls -->
      <div *ngIf="leads.length > 0" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div class="relative flex-1 max-w-md">
          <app-icon name="search" classNames="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500"></app-icon>
          <input
            type="text"
            [(ngModel)]="searchQuery" (ngModelChange)="currentPage = 1"
            placeholder="Search leads by name, email, phone, or intent..."
            class="w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 py-1.5 text-xs text-neutral-800 placeholder-neutral-400 focus:border-neutral-400 focus:outline-none transition-colors"
          />
        </div>

        <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
          <button
            type="button"
            (click)="qualityFilter = 'all'; currentPage = 1"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
            [ngClass]="qualityFilter === 'all' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'"
          >
            All ({{ leads.length }})
          </button>
          <button
            type="button"
            (click)="qualityFilter = 'hot'; currentPage = 1"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
            [ngClass]="qualityFilter === 'hot' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'"
          >
            Hot ({{ hotCount }})
          </button>
          <button
            type="button"
            (click)="qualityFilter = 'warm'; currentPage = 1"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
            [ngClass]="qualityFilter === 'warm' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'"
          >
            Warm ({{ warmCount }})
          </button>
          <button
            type="button"
            (click)="qualityFilter = 'new'; currentPage = 1"
            class="rounded-lg px-2.5 py-1 text-xs font-medium transition-colors"
            [ngClass]="qualityFilter === 'new' ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'"
          >
            New/Nurture
          </button>
        </div>
      </div>

      <!-- Loading Placeholder -->
      <div
        *ngIf="isLoading && leads.length === 0"
        class="rounded-2xl border border-neutral-200 bg-white p-12 text-center shadow-subtle animate-pulse space-y-3"
      >
        <div class="flex justify-center">
          <app-icon name="refresh" classNames="w-6 h-6 text-neutral-500 animate-spin"></app-icon>
        </div>
        <p class="text-sm font-medium text-neutral-700">Loading validated CRM leads...</p>
        <p class="text-xs text-neutral-500">Rehydrating customer contact details from secure vault.</p>
      </div>

      <!-- Empty State -->
      <div
        *ngIf="!isLoading && leads.length === 0"
        class="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center shadow-subtle space-y-3"
      >
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-500">
          <app-icon name="users" classNames="w-6 h-6"></app-icon>
        </div>
        <h3 class="text-base font-semibold text-neutral-900">No Validated Leads Captured Yet</h3>
        <p class="text-xs sm:text-sm text-neutral-500 max-w-md mx-auto leading-relaxed">
          When customers request a demo, sales consultation, or follow-up in chat and confirm their contact details, validated lead records and conversation transcripts will appear here with contact details unmasked for sales outreach.
        </p>
        <div class="pt-2">
          <button
            type="button"
            (click)="testChat()"
            class="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-medium text-white shadow-xs hover:bg-neutral-800 transition-all button-press"
          >
            <app-icon name="chat" classNames="w-3.5 h-3.5"></app-icon>
            <span>Test Customer Chat</span>
          </button>
        </div>
      </div>

      <!-- Filtered Empty State -->
      <div
        *ngIf="leads.length > 0 && filteredLeads.length === 0"
        class="rounded-xl border border-neutral-200 bg-white p-8 text-center text-xs text-neutral-500"
      >
        No leads match your current search or quality filter.
      </div>

      <!-- Leads Grid / List -->
      <div *ngIf="filteredLeads.length > 0" class="space-y-3">
        <div
          *ngFor="let lead of paginatedLeads"
          class="rounded-2xl border border-neutral-200/90 bg-white p-4 shadow-subtle transition-all hover:border-neutral-300 hover:shadow-card"
        >
          <!-- Lead Card Header with Unmasked PII & Outreach Actions -->
          <div class="flex flex-col lg:flex-row lg:items-start justify-between gap-4 border-b border-neutral-100 pb-4">
            <div class="flex items-start gap-3.5">
              <!-- Avatar -->
              <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white font-bold text-sm shadow-xs">
                {{ getLeadInitial(lead) }}
              </div>

              <!-- Contact & Details -->
              <div class="space-y-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-base font-bold text-neutral-900 leading-tight">
                    {{ lead.leadData.name || 'Unnamed Contact Request' }}
                  </h3>
                  <span
                    *ngIf="isRehydrated(lead)"
                    class="inline-flex items-center gap-1 rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 border border-emerald-200/60"
                    title="Customer contact information securely rehydrated from Node PII Vault"
                  >
                    <app-icon name="check" classNames="w-2.5 h-2.5 text-emerald-600"></app-icon>
                    <span>Verified Contact</span>
                  </span>
                </div>

                <!-- Direct Outreach Contact Badges -->
                <div class="flex flex-wrap items-center gap-2 pt-0.5">
                  <!-- Email Outreach -->
                  <div *ngIf="lead.leadData.email" class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200/80 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-800">
                    <span class="font-mono">{{ lead.leadData.email }}</span>
                    <a
                      [href]="'mailto:' + lead.leadData.email"
                      class="text-neutral-500 hover:text-neutral-900 transition-colors ml-1"
                      title="Send email to lead"
                    >
                      <app-icon name="arrow-up-right" classNames="w-3 h-3"></app-icon>
                    </a>
                    <button
                      type="button"
                      (click)="copyToClipboard(lead.leadData.email, 'Email')"
                      class="text-neutral-400 hover:text-neutral-700 transition-colors"
                      title="Copy email to clipboard"
                    >
                      <app-icon name="copy" classNames="w-3 h-3"></app-icon>
                    </button>
                  </div>

                  <!-- Phone Outreach -->
                  <div *ngIf="lead.leadData.phone" class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200/80 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-800">
                    <span class="font-mono">{{ lead.leadData.phone }}</span>
                    <a
                      [href]="'tel:' + lead.leadData.phone"
                      class="text-neutral-500 hover:text-neutral-900 transition-colors ml-1"
                      title="Call lead"
                    >
                      <app-icon name="arrow-up-right" classNames="w-3 h-3"></app-icon>
                    </a>
                    <button
                      type="button"
                      (click)="copyToClipboard(lead.leadData.phone, 'Phone')"
                      class="text-neutral-400 hover:text-neutral-700 transition-colors"
                      title="Copy phone to clipboard"
                    >
                      <app-icon name="copy" classNames="w-3 h-3"></app-icon>
                    </button>
                  </div>

                  <span *ngIf="!lead.leadData.email && !lead.leadData.phone" class="text-xs italic text-neutral-500">
                    No direct contact details provided in chat
                  </span>
                </div>
                <span class="block text-[11px] text-neutral-500">Captured {{ lead.createdAt | date:'medium' }}</span>
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-end gap-2">
              <app-badge *ngIf="expandedLeadId === lead.id" variant="outline" [showDot]="false" [text]="lead.leadData.interest || lead.intent"></app-badge>
              <app-badge
                *ngIf="expandedLeadId === lead.id"
                [variant]="getQualityVariant(lead.quality)"
                [showDot]="true"
                [text]="(lead.quality || 'new') | titlecase"
              ></app-badge>
              <app-badge *ngIf="expandedLeadId === lead.id" variant="outline" [showDot]="false" [text]="'Score: ' + (lead.score || 0)"></app-badge>
              <app-badge
                *ngIf="expandedLeadId === lead.id"
                [variant]="lead.validationPass ? 'success' : 'error'"
                [showDot]="true"
                [text]="lead.validationPass ? 'Validation Passed' : 'Validation Failed'"
              ></app-badge>
              <button type="button" (click)="toggleLead(lead.id)" [attr.aria-expanded]="expandedLeadId === lead.id" class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                {{ expandedLeadId === lead.id ? 'Hide details' : 'View details' }}
              </button>
            </div>
          </div>

          <!-- Lead Details (Summary + Conversation Transcript) -->
          <div *ngIf="expandedLeadId === lead.id" class="grid gap-5 lg:grid-cols-2 mt-5">
            <!-- Left: Backend-generated CRM specification -->
            <div class="rounded-xl border border-neutral-100 bg-neutral-50/70 p-4 flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between pb-2 mb-2 border-b border-neutral-200/60">
                  <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                    CRM Opportunity Specification
                  </span>
                  <div class="flex items-center gap-2">
                    <span
                      class="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
                      [ngClass]="lead.summaryStatus === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-200 text-neutral-700'"
                    >
                      {{ summaryStatusLabel(lead.summaryStatus) }}
                    </span>
                    <button type="button" (click)="summarizeLead(lead)" [disabled]="summarizingLeadId === lead.id" class="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-60">
                      {{ summarizingLeadId === lead.id ? 'Summarizing...' : 'AI summarize' }}
                    </button>
                  </div>
                </div>
                <pre *ngIf="lead.summary; else summaryPending" class="whitespace-pre-wrap rounded-lg border border-neutral-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-neutral-700">{{ lead.summary }}</pre>
                <ng-template #summaryPending>
                  <p class="text-xs sm:text-[13px] leading-relaxed text-neutral-500">{{ lead.summaryStatus === 'failed' ? 'Summary processing failed; retry the workflow.' : 'Summary is being prepared by the backend...' }}</p>
                </ng-template>
                <div *ngIf="lead.documents?.length" class="mt-4 border-t border-neutral-200/60 pt-3">
                  <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Supporting documents</span>
                  <div *ngFor="let document of lead.documents" class="mt-2 flex items-center justify-between gap-2 rounded-lg bg-white p-2 text-xs">
                    <span class="min-w-0 truncate" [title]="document.fileName">{{ document.fileName }}</span>
                    <span class="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase">{{ documentStatusLabel(document.status) }}</span>
                    <button type="button" (click)="downloadDocument(document.id, document.fileName)" class="shrink-0 text-[10px] font-semibold text-neutral-700 hover:text-neutral-950">Download</button>
                  </div>
                </div>
              </div>

              <div class="mt-4 pt-3 border-t border-neutral-200/60 flex items-center justify-between text-[11px] text-neutral-500">
                <span class="font-mono truncate max-w-[200px]" title="Session ID: {{ lead.sessionId }}">
                  Session: {{ lead.sessionId || 'N/A' }}
                </span>
                <span>Turn Count: {{ lead.conversation.length }}</span>
              </div>
            </div>

            <!-- Right: Conversation access -->
            <div class="rounded-xl border border-neutral-100 bg-neutral-50/70 p-4 flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between pb-2 mb-3 border-b border-neutral-200/60">
                  <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Conversation history</span>
                  <span class="text-[11px] text-neutral-500 font-mono">{{ lead.conversation.length }} turns</span>
                </div>
                <p class="text-xs leading-relaxed text-neutral-500">Open the protected transcript when you need the full customer context.</p>
              </div>
              <button type="button" (click)="openTranscript(lead)" class="mt-5 inline-flex w-fit items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50">
                <app-icon name="chat" classNames="h-3.5 w-3.5"></app-icon>
                Open chat transcript
              </button>
            </div>
          </div>

          <!-- Lead Card Footer -->
          <div *ngIf="expandedLeadId === lead.id" class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-neutral-100 text-[11px] text-neutral-500">
            <div class="flex items-center gap-3">
              <span>Captured: {{ lead.createdAt | date:'medium' }}</span>
              <span class="text-neutral-300">·</span>
              <span class="font-mono" title="Internal CRM lead ID">Internal CRM: {{ lead.id }}</span>
              <span class="text-neutral-300">·</span>
              <span title="Remote CRM provider">Remote CRM: {{ lead.remoteCrm || 'Not synchronized' }}</span>
              <span class="text-neutral-300">·</span>
              <span class="font-mono" title="Remote CRM reference ID">CRM reference: {{ lead.leadId || 'Pending' }}</span>
              <span class="text-neutral-300">·</span>
              <span *ngIf="lead.actionId" class="font-mono truncate max-w-[200px]" title="Action ID: {{ lead.actionId }}">
                Workflow action: {{ lead.actionId }}
              </span>
            </div>
            <span class="font-mono text-[10px] text-neutral-500">Status: {{ summaryStatusLabel(lead.summaryStatus) }}</span>
          </div>
        </div>

        <app-pagination
          [totalItems]="filteredLeads.length"
          [pageSize]="pageSize"
          [currentPage]="currentPage"
          (pageChange)="currentPage = $event"
          (pageSizeChange)="pageSize = $event; currentPage = 1"
        ></app-pagination>
      </div>

      <div *ngIf="transcriptLead" class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/50 p-4" role="dialog" aria-modal="true" aria-labelledby="transcript-title">
        <div class="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <div class="flex items-start justify-between gap-4 border-b border-neutral-200 px-5 py-4">
            <div>
              <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">Conversation transcript</p>
              <h3 id="transcript-title" class="mt-1 text-lg font-bold text-neutral-900">{{ transcriptLead.leadData.name || 'Unnamed contact request' }}</h3>
              <p class="mt-1 text-xs text-neutral-500">{{ transcriptLead.leadData.email || transcriptLead.leadData.phone || 'No direct contact details' }} · {{ transcriptLead.conversation.length }} turns</p>
            </div>
            <button type="button" (click)="closeTranscript()" aria-label="Close transcript" class="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-semibold text-neutral-600 hover:bg-neutral-50">Close</button>
          </div>
          <div class="flex-1 space-y-3 overflow-y-auto bg-neutral-50 p-5">
            <div *ngFor="let msg of transcriptLead.conversation" class="rounded-xl p-3 text-sm" [ngClass]="msg.role === 'user' ? 'border border-neutral-200 bg-white text-neutral-900' : 'bg-neutral-900 text-white'">
              <div class="mb-1 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-wider opacity-60">
                <span>{{ msg.role === 'user' ? 'Visitor' : 'Assistant' }}</span>
                <span>{{ msg.createdAt | date:'medium' }}</span>
              </div>
              <p class="whitespace-pre-wrap leading-relaxed">{{ msg.content }}</p>
            </div>
            <p *ngIf="transcriptLead.conversation.length === 0" class="text-center text-sm italic text-neutral-500">No turns recorded in session.</p>
          </div>
        </div>
      </div>
    </section>
  `
})
export class CrmComponent implements OnInit, OnDestroy {
  private readonly state = inject(AdminStateService);

  get leads(): CrmLead[] { return this.state.crmLeads(); }
  get isLoading(): boolean { return this.state.crmIsLoading(); }

  searchQuery = '';
  qualityFilter: 'all' | 'hot' | 'warm' | 'new' = 'all';
  currentPage = 1;
  pageSize = 10;
  expandedLeadId: string | null = null;
  transcriptLead: CrmLead | null = null;
  summarizingLeadId: string | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    // Proactively fetch latest leads on mount
    this.state.loadCrmLeads();
    this.refreshTimer = setInterval(() => this.state.loadCrmLeads(true), 5000);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  refresh(): void {
    this.state.loadCrmLeads();
  }

  toggleLead(leadId: string): void {
    this.expandedLeadId = this.expandedLeadId === leadId ? null : leadId;
  }

  openTranscript(lead: CrmLead): void {
    this.transcriptLead = lead;
  }

  closeTranscript(): void {
    this.transcriptLead = null;
  }

  summarizeLead(lead: CrmLead): void {
    if (this.summarizingLeadId) return;
    this.summarizingLeadId = lead.id;
    this.state.crm.summarizeLead(lead.id).subscribe({
      next: (response) => {
        this.state.crm.updateLead(response.lead);
        if (this.transcriptLead?.id === response.lead.id) this.transcriptLead = response.lead;
        this.summarizingLeadId = null;
        // Signal update automatically triggers reactivity
        this.state.showToast('success', 'Summary updated', response.aiGenerated ? 'The AI formatted the CRM opportunity summary.' : 'The CRM summary was formatted.');
      },
      error: () => {
        this.summarizingLeadId = null;
        this.state.showToast('error', 'Summary failed', 'The summary could not be generated. Please try again.');
      }
    });
  }

  testChat(): void {
    this.state.setSection('chat');
  }

  get hotCount(): number {
    return this.leads.filter((l) => l.quality === 'hot').length;
  }

  get warmCount(): number {
    return this.leads.filter((l) => l.quality === 'warm').length;
  }

  get validatedCount(): number {
    return this.leads.filter((l) => l.validationPass).length;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredLeads.length / this.pageSize));
  }

  get safeCurrentPage(): number {
    return Math.min(Math.max(1, this.currentPage), this.totalPages);
  }

  synchronizePagination(): void {
    const max = this.totalPages;
    if (this.currentPage > max) {
      this.currentPage = max;
    }
  }

  get paginatedLeads(): CrmLead[] {
    this.synchronizePagination();
    const start = (this.currentPage - 1) * this.pageSize;
    return this.filteredLeads.slice(start, start + this.pageSize);
  }

  get filteredLeads(): CrmLead[] {
    return this.leads.filter((lead) => {
      // Quality filter
      if (this.qualityFilter !== 'all') {
        if (this.qualityFilter === 'new') {
          if (lead.quality !== 'new' && lead.quality !== 'nurture') return false;
        } else if (lead.quality !== this.qualityFilter) {
          return false;
        }
      }

      // Search query
      if (this.searchQuery.trim()) {
        const query = this.searchQuery.toLowerCase();
        const name = (lead.leadData.name || '').toLowerCase();
        const email = (lead.leadData.email || '').toLowerCase();
        const phone = (lead.leadData.phone || '').toLowerCase();
        const intent = (lead.leadData.interest || lead.intent || '').toLowerCase();
        const summary = (lead.summary || '').toLowerCase();
        return name.includes(query) || email.includes(query) || phone.includes(query) || intent.includes(query) || summary.includes(query);
      }

      return true;
    });
  }

  getLeadInitial(lead: CrmLead): string {
    const name = lead.leadData.name;
    return (name && name.length > 0 ? name.charAt(0) : 'L').toUpperCase();
  }

  isRehydrated(lead: CrmLead): boolean {
    const name = lead.leadData.name || '';
    const email = lead.leadData.email || '';
    return (!name.includes('[NAME_') && name.length > 0) || (!email.includes('[EMAIL_') && email.length > 0);
  }

  copyToClipboard(text: string, label: string): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.state.showToast('success', 'Copied to Clipboard', `${label}: ${text}`);
      }).catch(() => {
        this.state.showToast('info', 'Contact Info', text);
      });
    }
  }

  downloadDocument(documentId: string, fileName: string): void {
    this.state.crm.downloadDocument(documentId).subscribe({
      next: (blob) => { const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = fileName; anchor.click(); URL.revokeObjectURL(url); },
      error: () => this.state.showToast('error', 'Download failed', 'The private document could not be downloaded.')
    });
  }

  getQualityVariant(quality: string): 'error' | 'warning' | 'neutral' | 'black' {
    switch (quality) {
      case 'hot':
        return 'error';
      case 'warm':
        return 'warning';
      case 'nurture':
      case 'new':
      default:
        return 'neutral';
    }
  }

  summaryStatusLabel(status: CrmLead['summaryStatus']): string {
    return status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'Processing';
  }

  documentStatusLabel(status: string): string {
    return status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'processing' ? 'Verifying' : status === 'reconciliation' ? 'Needs review' : 'Queued';
  }
}

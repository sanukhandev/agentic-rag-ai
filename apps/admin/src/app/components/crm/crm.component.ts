import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../../services/admin-state.service';
import { CrmLead } from '../../types/admin.types';
import { BadgeComponent } from '../shared/badge.component';
import { IconComponent } from '../shared/icon.component';

@Component({
  selector: 'app-crm',
  standalone: true,
  imports: [CommonModule, BadgeComponent, IconComponent],
  template: `
    <section class="space-y-6 animate-fade-in">
      <!-- Section Header -->
      <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 border-b border-neutral-200/80 pb-5">
        <div>
          <div class="flex items-center gap-2">
            <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">Customer Intelligence</p>
            <app-badge variant="neutral" [showDot]="false" text="">
              {{ leads.length }} {{ leads.length === 1 ? 'Lead' : 'Leads' }}
            </app-badge>
          </div>
          <h2 class="mt-1.5 text-2xl font-bold tracking-tight text-neutral-900 font-sans">
            CRM Leads & Inquiries
          </h2>
          <p class="mt-1 text-xs sm:text-sm text-neutral-500 max-w-2xl leading-relaxed">
            Validated contact requests captured and gated from grounded customer conversations. Node API isolates customer PII inside the trusted memory boundary before triggering authorized downstream workflows.
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

      <!-- Loading Placeholder -->
      <div
        *ngIf="isLoading && leads.length === 0"
        class="rounded-2xl border border-neutral-200 bg-white p-12 text-center shadow-subtle animate-pulse space-y-3"
      >
        <div class="flex justify-center">
          <app-icon name="refresh" classNames="w-6 h-6 text-neutral-400 animate-spin"></app-icon>
        </div>
        <p class="text-sm font-medium text-neutral-700">Loading validated CRM leads...</p>
        <p class="text-xs text-neutral-400">Fetching records for active workspace scope.</p>
      </div>

      <!-- Empty State -->
      <div
        *ngIf="!isLoading && leads.length === 0"
        class="rounded-2xl border border-dashed border-neutral-300 bg-white p-12 text-center shadow-subtle space-y-3"
      >
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
          <app-icon name="users" classNames="w-6 h-6"></app-icon>
        </div>
        <h3 class="text-base font-semibold text-neutral-900">No Validated Leads Captured Yet</h3>
        <p class="text-xs sm:text-sm text-neutral-500 max-w-md mx-auto leading-relaxed">
          When customers request a demo, sales consultation, or follow-up in chat and confirm their contact details, validated lead records and conversation transcripts will appear here.
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

      <!-- Leads Grid / List -->
      <div *ngIf="leads.length > 0" class="space-y-5">
        <div
          *ngFor="let lead of leads"
          class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-subtle transition-all hover:border-neutral-300 hover:shadow-card space-y-5"
        >
          <!-- Lead Card Header -->
          <div class="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-100 pb-4">
            <div class="space-y-1">
              <div class="flex items-center gap-2.5">
                <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-white font-bold text-xs">
                  {{ getLeadInitial(lead) }}
                </div>
                <div>
                  <h3 class="text-base font-bold text-neutral-900 leading-tight">
                    {{ lead.leadData.name || 'Unnamed Contact Request' }}
                  </h3>
                  <div class="flex items-center gap-3 text-xs text-neutral-500 mt-0.5">
                    <span *ngIf="lead.leadData.email" class="font-mono text-neutral-600">
                      {{ lead.leadData.email }}
                    </span>
                    <span *ngIf="lead.leadData.email && lead.leadData.phone" class="text-neutral-300">·</span>
                    <span *ngIf="lead.leadData.phone" class="font-mono text-neutral-600">
                      {{ lead.leadData.phone }}
                    </span>
                    <span *ngIf="!lead.leadData.email && !lead.leadData.phone" class="italic text-neutral-400">
                      No direct contact token
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Badges Row -->
            <div class="flex flex-wrap items-center gap-2">
              <app-badge variant="outline" [showDot]="false" [text]="lead.intent"></app-badge>
              <app-badge
                [variant]="getQualityVariant(lead.quality)"
                [showDot]="true"
                [text]="(lead.quality || 'new') | titlecase"
              ></app-badge>
              <app-badge variant="outline" [showDot]="false" [text]="'Score: ' + (lead.score || 0)"></app-badge>
              <app-badge
                [variant]="lead.validationPass ? 'success' : 'error'"
                [showDot]="true"
                [text]="lead.validationPass ? 'Validation Passed' : 'Validation Failed'"
              ></app-badge>
            </div>
          </div>

          <!-- Lead Details (Summary + Conversation Transcript) -->
          <div class="grid gap-5 lg:grid-cols-2">
            <!-- Left: Conversation Summary -->
            <div class="rounded-xl border border-neutral-100 bg-neutral-50/70 p-4 flex flex-col justify-between">
              <div>
                <div class="flex items-center justify-between pb-2 mb-2 border-b border-neutral-200/60">
                  <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                    AI Conversation Summary
                  </span>
                  <span
                    class="rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
                    [ngClass]="lead.summaryStatus === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-neutral-200 text-neutral-700'"
                  >
                    {{ lead.summaryStatus || 'pending' }}
                  </span>
                </div>
                <p class="whitespace-pre-wrap text-xs sm:text-[13px] leading-relaxed text-neutral-700">
                  {{ lead.summary || 'Summary is being prepared by the workflow...' }}
                </p>
              </div>

              <div class="mt-4 pt-3 border-t border-neutral-200/60 flex items-center justify-between text-[11px] text-neutral-400">
                <span class="font-mono truncate max-w-[200px]" title="Session ID: {{ lead.sessionId }}">
                  Session: {{ lead.sessionId || 'N/A' }}
                </span>
                <span>Turn Count: {{ lead.conversation.length }}</span>
              </div>
            </div>

            <!-- Right: Interactive Conversation Transcript -->
            <div class="rounded-xl border border-neutral-100 bg-neutral-50/70 p-4 space-y-3">
              <div class="flex items-center justify-between pb-2 border-b border-neutral-200/60">
                <span class="text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                  Dialogue Transcript
                </span>
                <span class="text-[11px] text-neutral-500 font-mono">
                  {{ lead.conversation.length }} turns
                </span>
              </div>

              <!-- Message Bubbles Preview -->
              <div class="max-h-64 overflow-y-auto space-y-2.5 pr-1">
                <div
                  *ngFor="let msg of lead.conversation"
                  class="rounded-lg p-2.5 text-xs transition-colors"
                  [ngClass]="msg.role === 'user' ? 'bg-white border border-neutral-200/80 text-neutral-900 shadow-2xs' : 'bg-neutral-900 text-white'"
                >
                  <div class="flex items-center justify-between gap-2 mb-1">
                    <span
                      class="text-[10px] font-bold uppercase tracking-wider"
                      [ngClass]="msg.role === 'user' ? 'text-neutral-500' : 'text-neutral-300'"
                    >
                      {{ msg.role === 'user' ? 'Visitor' : 'Assistant' }}
                    </span>
                    <span
                      *ngIf="msg.createdAt"
                      class="text-[9px] font-mono opacity-60"
                    >
                      {{ msg.createdAt | date:'shortTime' }}
                    </span>
                  </div>
                  <p class="whitespace-pre-wrap leading-relaxed">{{ msg.content }}</p>
                </div>

                <div *ngIf="lead.conversation.length === 0" class="text-xs text-neutral-400 italic p-3 text-center">
                  No turns recorded in session.
                </div>
              </div>

              <!-- Collapsible Raw JSON Details -->
              <details class="pt-2 border-t border-neutral-200/60">
                <summary class="cursor-pointer text-[10px] font-bold uppercase tracking-wider text-neutral-400 hover:text-neutral-700 transition-colors">
                  Inspect Raw Conversation JSON
                </summary>
                <pre class="mt-2 max-h-40 overflow-auto rounded bg-neutral-950 p-2.5 font-mono text-[10px] text-neutral-300 whitespace-pre-wrap break-words leading-tight">{{ lead.conversation | json }}</pre>
              </details>
            </div>
          </div>

          <!-- Lead Card Footer -->
          <div class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-neutral-100 text-[11px] text-neutral-400">
            <div class="flex items-center gap-3">
              <span>Captured: {{ lead.createdAt | date:'medium' }}</span>
              <span class="text-neutral-300">·</span>
              <span *ngIf="lead.actionId" class="font-mono truncate max-w-[200px]" title="Action ID: {{ lead.actionId }}">
                Action: {{ lead.actionId }}
              </span>
            </div>
            <span class="font-mono text-[10px] text-neutral-400">Status: {{ lead.summaryStatus }}</span>
          </div>
        </div>
      </div>
    </section>
  `
})
export class CrmComponent implements OnInit {
  private readonly state = inject(AdminStateService);
  private readonly cdr = inject(ChangeDetectorRef);

  leads: CrmLead[] = [];
  isLoading = false;

  ngOnInit(): void {
    this.state.crmLeads$.subscribe((leads) => {
      this.leads = leads ?? [];
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    });

    this.state.crmIsLoading$.subscribe((loading) => {
      this.isLoading = loading;
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    });

    // Proactively fetch latest leads on mount
    this.state.loadCrmLeads();
  }

  refresh(): void {
    this.state.loadCrmLeads();
  }

  testChat(): void {
    this.state.setSection('chat');
  }

  getLeadInitial(lead: CrmLead): string {
    const name = lead.leadData?.name;
    return (name && name.length > 0 ? name.charAt(0) : 'L').toUpperCase();
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
}

import { ChangeDetectorRef, Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService } from '../../services/admin-state.service';
import { CrmLead } from '../../types/admin.types';
import { BadgeComponent } from '../shared/badge.component';

@Component({
  selector: 'app-crm',
  standalone: true,
  imports: [CommonModule, BadgeComponent],
  template: `
    <section class="space-y-6">
      <div class="flex items-end justify-between gap-4">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-400">Tenant CRM</p>
          <h2 class="mt-1 text-2xl font-bold tracking-tight text-neutral-900">Leads</h2>
          <p class="mt-1 text-sm text-neutral-500">Validated contact requests captured from the assistant.</p>
        </div>
        <button type="button" (click)="refresh()" class="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Refresh</button>
      </div>

      <div *ngIf="leads.length === 0" class="rounded-xl border border-dashed border-neutral-200 bg-white p-10 text-center text-sm text-neutral-500">
        No validated leads have been created yet.
      </div>

      <div *ngFor="let lead of leads" class="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 class="font-semibold text-neutral-900">{{ lead.leadData.name || 'Unnamed lead' }}</h3>
            <p class="mt-1 text-xs text-neutral-500">{{ lead.leadData.email || lead.leadData.phone || 'No contact displayed' }}</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <app-badge variant="outline" [text]="lead.intent"></app-badge>
            <app-badge variant="black" [text]="'Score ' + lead.score"></app-badge>
            <app-badge [variant]="lead.validationPass ? 'success' : 'error'" [text]="lead.validationPass ? 'Validation passed' : 'Validation failed'"></app-badge>
          </div>
        </div>

        <div class="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div class="rounded-lg bg-neutral-50 p-4">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">Conversation summary</p>
            <p class="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{{ lead.summary || 'Summary is being prepared by the workflow.' }}</p>
          </div>
          <details class="rounded-lg border border-neutral-100 bg-neutral-50 p-4">
            <summary class="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">Full conversation JSON</summary>
            <pre class="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-neutral-600">{{ lead.conversation | json }}</pre>
          </details>
        </div>
        <p class="mt-4 text-[11px] text-neutral-400">Created {{ lead.createdAt | date:'medium' }} · Summary {{ lead.summaryStatus }}</p>
      </div>
    </section>
  `
})
export class CrmComponent implements OnInit {
  private readonly state = inject(AdminStateService);
  private readonly cdr = inject(ChangeDetectorRef);
  leads: CrmLead[] = [];

  ngOnInit(): void {
    this.state.crmLeads$.subscribe((leads) => {
      this.leads = leads;
      this.cdr.markForCheck();
    });
  }

  refresh(): void { this.state.loadCrmLeads(); }
}

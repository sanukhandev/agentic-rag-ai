import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from '../../services/admin-state.service';
import { Persona, PersonaVersion } from '../../types/admin.types';
import { parsePermittedLanguages } from '../../persona-utils';
import { IconComponent } from '../shared/icon.component';
import { BadgeComponent } from '../shared/badge.component';

@Component({
  selector: 'app-ai-studio',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, BadgeComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Studio Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div class="flex items-center gap-2.5">
            <h2 class="text-xl font-bold text-neutral-900 tracking-tight">
              AI Agent Studio & Persona Rules
            </h2>
            <app-badge variant="neutral" [showDot]="false" text="Azure GPT-4.1-mini"></app-badge>
          </div>
          <p class="mt-1 text-xs text-neutral-500">
            Configure agent tone and speaking style. Presentation rules never override retrieval grounding or tenant isolation.
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            (click)="saveDraft()"
            class="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors"
          >
            Save as Draft
          </button>
          <button
            type="button"
            (click)="publishCurrent()"
            class="rounded-lg bg-neutral-900 px-4 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 transition-all button-press flex items-center gap-1.5"
          >
            <app-icon name="check" classNames="w-3.5 h-3.5"></app-icon>
            <span>Publish Persona</span>
          </button>
        </div>
      </div>

      <!-- Main Layout: Persona Settings Form + Interactive Preview Sandbox -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        <!-- Left: Configuration Form (7 cols) -->
        <div class="lg:col-span-7 space-y-6">
          <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
            <h3 class="text-sm font-semibold text-neutral-900 uppercase tracking-wider text-xs">
              Agent Identity & Tone Parameters
            </h3>

            <div class="mt-4 space-y-4">
              <!-- Name -->
              <div>
                <label class="block text-xs font-semibold text-neutral-800">Agent Display Name</label>
                <input
                  [(ngModel)]="persona.name"
                  type="text"
                  placeholder="e.g. Aura Enterprise Concierge"
                  class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <!-- Greeting -->
              <div>
                <label class="block text-xs font-semibold text-neutral-800">Initial Greeting Message</label>
                <input
                  [(ngModel)]="persona.greeting"
                  type="text"
                  placeholder="e.g. Welcome to Acme. How may I assist your enterprise inquiry today?"
                  class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
                />
              </div>

              <!-- Personality -->
              <div>
                <label class="block text-xs font-semibold text-neutral-800">Persona Directives</label>
                <textarea
                  [(ngModel)]="persona.personality"
                  rows="3"
                  placeholder="e.g. Calm, authoritative, strictly grounded in authorized enterprise documentation..."
                  class="mt-1.5 w-full rounded-lg border border-neutral-200 p-3 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
                ></textarea>
              </div>

              <!-- Tone & Speaking Style Grid -->
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-semibold text-neutral-800">Tone</label>
                  <input
                    [(ngModel)]="persona.tone"
                    type="text"
                    placeholder="Clear, professional, and precise"
                    class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label class="block text-xs font-semibold text-neutral-800">Speaking Style</label>
                  <input
                    [(ngModel)]="persona.speakingStyle"
                    type="text"
                    placeholder="Concise, declarative statements"
                    class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
                  />
                </div>
              </div>

              <!-- Permitted Languages -->
              <div>
                <label class="block text-xs font-semibold text-neutral-800">
                  Permitted Response Languages (comma-separated ISO-639 codes)
                </label>
                <input
                  [(ngModel)]="languagesInput"
                  (ngModelChange)="onLanguagesChange($event)"
                  type="text"
                  placeholder="en, es, de, fr, ja, ar"
                  class="mt-1.5 w-full rounded-lg border border-neutral-200 px-3 py-2 text-xs font-mono text-neutral-900 focus:border-neutral-900 focus:outline-none"
                />
                <div class="mt-2 flex flex-wrap gap-1">
                  <span
                    *ngFor="let lang of persona.permittedLanguages"
                    class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-mono font-medium text-neutral-700"
                  >
                    {{ lang | uppercase }}
                  </span>
                </div>
              </div>

              <!-- Context Window -->
              <div>
                <label class="block text-xs font-semibold text-neutral-800">Conversation Context Window</label>
                <div class="mt-1.5 flex items-center gap-3">
                  <input
                    [(ngModel)]="persona.contextWindowMessages"
                    type="number"
                    min="1"
                    max="10"
                    required
                    aria-describedby="context-window-help"
                    class="w-24 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 focus:border-neutral-900 focus:outline-none"
                  />
                  <span class="text-xs text-neutral-500">previous messages</span>
                </div>
                <p id="context-window-help" class="mt-1.5 text-[11px] text-neutral-500">
                  The assistant can use 1–10 recent messages for follow-ups. Default: 10. Only server-masked context is sent to the model.
                </p>
              </div>

            </div>
          </section>

          <!-- Version History & Rollback Controls -->
          <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-semibold text-neutral-900">Persona Version History</h3>
              <span class="text-xs text-neutral-400">Rollback enabled</span>
            </div>
            <p class="mt-1 text-xs text-neutral-500">
              Drafts remain inactive until published. Publishing an earlier version serves as an instantaneous zero-downtime rollback.
            </p>

            <div class="mt-4 space-y-2.5">
              <div
                *ngFor="let ver of versions"
                class="flex items-center justify-between rounded-xl border border-neutral-200/70 p-3 text-xs hover:bg-neutral-50/60 transition-colors"
              >
                <div>
                  <div class="flex items-center gap-2">
                    <span class="font-mono font-bold text-neutral-900">v{{ ver.version }}</span>
                    <span class="font-medium text-neutral-800">{{ ver.name }}</span>
                    <app-badge
                      [variant]="ver.status === 'published' ? 'black' : 'outline'"
                      [showDot]="ver.status === 'published'"
                      [text]="ver.status | uppercase"
                    ></app-badge>
                  </div>
                  <p class="mt-1 text-[11px] text-neutral-400">
                    Created {{ ver.createdAt | date:'mediumDate' }}
                    <span *ngIf="ver.publishedAt"> · Active since {{ ver.publishedAt | date:'shortTime' }}</span>
                  </p>
                </div>

                <button
                  *ngIf="ver.status !== 'published'"
                  type="button"
                  (click)="rollbackTo(ver)"
                  class="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 hover:bg-neutral-100 transition-colors button-press"
                >
                  Activate v{{ ver.version }}
                </button>
              </div>
            </div>
          </section>
        </div>

        <!-- Right: Interactive Grounding Test Sandbox (5 cols) -->
        <div class="lg:col-span-5 space-y-6">
          <section class="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-card flex flex-col h-full justify-between">
            <div>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <app-icon name="sparkles" classNames="w-4 h-4 text-neutral-700"></app-icon>
                  <h3 class="text-sm font-semibold text-neutral-900">Grounding Preview Sandbox</h3>
                </div>
                <button
                  type="button"
                  (click)="openFullCustomerChat()"
                  class="text-[11px] text-neutral-600 hover:text-neutral-900 flex items-center gap-1 font-medium hover:underline"
                >
                  <span>Open Full Chat</span>
                  <app-icon name="arrow-up-right" classNames="w-3 h-3"></app-icon>
                </button>
              </div>
              <p class="mt-1 text-xs text-neutral-500">
                Test prompts in real-time. Verified responses highlight source citations; unverified questions trigger safe abstention.
              </p>

              <!-- Sandbox Simulated Conversation -->
              <div class="mt-5 space-y-3 rounded-xl border border-neutral-200/60 bg-neutral-50/60 p-4 min-h-[260px]">
                <!-- User Question -->
                <div class="flex justify-end">
                  <div class="max-w-[85%] rounded-2xl rounded-br-none bg-neutral-900 text-white px-3.5 py-2.5 text-xs">
                    {{ currentPrompt }}
                  </div>
                </div>

                <!-- Assistant Response -->
                <div class="flex justify-start">
                  <div class="max-w-[90%] rounded-2xl rounded-bl-none bg-white border border-neutral-200 p-3.5 text-xs space-y-2 shadow-subtle">
                    <div class="flex items-center justify-between border-b border-neutral-100 pb-2">
                      <span class="font-semibold text-neutral-900">{{ persona.name }}</span>
                      <span class="text-[10px] font-mono px-1.5 py-0.5 rounded border" [ngClass]="previewGrounded ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-neutral-500 bg-neutral-50 border-neutral-200'">
                        {{ previewGrounded ? '✓ Grounded' : 'No approved evidence' }}
                      </span>
                    </div>

                    <p *ngIf="previewAnswer" class="text-neutral-700 leading-relaxed">
                      {{ previewAnswer }}
                    </p>

                    <div *ngIf="previewCitations.length" class="pt-2 border-t border-neutral-100 text-[11px] text-neutral-500">
                      <span class="font-medium text-neutral-700">Verified Citations:</span>
                      <div class="mt-1 flex flex-wrap gap-1">
                        <span *ngFor="let citation of previewCitations" class="rounded bg-neutral-100 px-2 py-0.5 text-[10px] font-mono text-neutral-600">
                          [{{ citation.title }}<span *ngIf="citation.locator"> · {{ citation.locator }}</span>]
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Grounding refusal example prompt button -->
                <div class="pt-2 flex items-center justify-center">
                  <button
                    type="button"
                    (click)="setPrompt('What is the secret internal CEO cell phone number?')"
                    class="text-[11px] text-neutral-400 hover:text-neutral-800 underline transition-colors"
                  >
                    Test prompt refusal / abstention safety →
                  </button>
                </div>
              </div>
            </div>

            <!-- Sandbox Input Box -->
            <form (ngSubmit)="runTest()" class="mt-4 flex gap-2">
              <input
                [(ngModel)]="testInput"
                name="testInput"
                placeholder="Ask about pricing, SLA, or security architecture..."
                class="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-900 placeholder-neutral-400 focus:border-neutral-900 focus:outline-none"
              />
              <button
                type="submit"
                class="rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-neutral-800 transition-all button-press"
              >
                Send
              </button>
            </form>

          </section>
        </div>

      </div>

    </div>
  `
})
export class AiStudioComponent implements OnInit {
  private readonly state = inject(AdminStateService);
  private readonly cdr = inject(ChangeDetectorRef);

  persona: Persona = { name: '', greeting: '', personality: '', tone: '', speakingStyle: '', permittedLanguages: [], contextWindowMessages: 10 };

  languagesInput = '';
  versions: PersonaVersion[] = [];

  currentPrompt = '';
  previewAnswer = '';
  previewGrounded = false;
  previewCitations: Array<{ title: string; locator: string }> = [];
  testInput = '';

  constructor() {
    this.state.persona$.subscribe((p) => {
      this.persona = { ...p };
      this.languagesInput = p.permittedLanguages.join(', ');
      this.cdr.markForCheck();
    });
    this.state.personaVersions$.subscribe((v) => {
      this.versions = v;
      this.cdr.markForCheck();
    });
  }

  ngOnInit(): void {
    this.state.loadPersona();
    this.state.loadPersonaVersions();
  }

  onLanguagesChange(val: string): void {
    this.persona.permittedLanguages = parsePermittedLanguages(val);
  }

  saveDraft(): void {
    this.state.personaService.saveDraft(this.persona);
  }

  publishCurrent(): void {
    this.state.personaService.publishVersion(this.persona);
  }

  rollbackTo(ver: PersonaVersion): void {
    this.state.personaService.rollbackTo(ver);
  }

  setPrompt(p: string): void {
    this.currentPrompt = p;
    this.runPreview(p);
  }

  runTest(): void {
    if (!this.testInput.trim()) return;
    const prompt = this.testInput;
    this.testInput = '';
    this.runPreview(prompt);
  }

  private runPreview(message: string): void {
    this.currentPrompt = message;
    this.previewAnswer = '';
    this.previewGrounded = false;
    this.previewCitations = [];
    this.state.personaService.preview(this.persona, message, (preview) => {
      this.previewAnswer = preview.answer;
      this.previewGrounded = preview.grounded;
      this.previewCitations = preview.citations.map(({ citation }) => citation);
    });
  }

  openFullCustomerChat(): void {
    this.state.setSection('chat');
  }
}

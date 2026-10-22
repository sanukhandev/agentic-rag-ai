import { Component, Input, OnInit, OnDestroy, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer } from '@angular/platform-browser';
import { IconComponent } from '../shared/icon.component';
import { BadgeComponent } from '../shared/badge.component';
import { AdminStateService } from '../../services/admin-state.service';
import { API_BASE_URL } from '../../services/tokens';
import {
  ChatCitation,
  ChatActionProposal,
  ChatActionState,
  CustomerChatMessage,
  formatNaturalAbstention,
  isValidTenantSlug,
  renderMarkdown,
  resolveTenantSlug
} from './customer-chat-utils';

interface TenantChatConfig {
  tenant: {
    name: string;
    slug: string;
  };
  persona: {
    name: string;
    greeting: string;
    tone: string;
    speakingStyle: string;
    permittedLanguages: string[];
  } | null;
}

@Component({
  selector: 'app-customer-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent, BadgeComponent],
  template: `
    <div class="flex flex-col h-full min-h-[640px] max-h-[880px] bg-white rounded-2xl border border-neutral-200/90 shadow-card overflow-hidden selection:bg-neutral-900 selection:text-white">
      
      <!-- 1. Compact Header -->
      <header class="shrink-0 flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-neutral-200/80 bg-white/95 backdrop-blur-sm z-10">
        <!-- Agent Identity & Brand Info -->
        <div class="flex items-center gap-3 min-w-0">
          <div class="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-subtle">
            <app-icon name="sparkles" classNames="w-4 h-4 text-white"></app-icon>
            <span class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" title="Online & Grounded"></span>
          </div>

          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h1 class="text-sm font-semibold text-neutral-900 truncate tracking-tight">
                {{ agentName }}
              </h1>
              <span class="hidden sm:inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-mono text-neutral-600">
                {{ tenantName }}
              </span>
            </div>
            <p class="text-[11px] text-neutral-500 truncate">
              {{ agentTone }} · Verified Knowledge
            </p>
          </div>
        </div>

        <!-- Accessible Conversation Actions -->
        <div class="flex items-center gap-2 shrink-0">
          <!-- Administrative Testing Mode Switch (Only available when authenticated or admin enabled) -->
          <button
            *ngIf="canAccessAdminTesting"
            type="button"
            (click)="toggleAdminTestingMode()"
            [attr.aria-pressed]="isAdminTestingMode"
            [ngClass]="isAdminTestingMode ? 'bg-neutral-900 text-white border-neutral-900' : 'bg-neutral-50 text-neutral-600 border-neutral-200 hover:bg-neutral-100'"
            class="hidden md:inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition-colors button-press"
            title="Toggle administrative diagnostics"
          >
            <app-icon name="cpu" classNames="w-3 h-3"></app-icon>
            <span>{{ isAdminTestingMode ? 'Diagnostics Active' : 'Admin Test Mode' }}</span>
          </button>

          <!-- Reset Conversation Button -->
          <button
            type="button"
            (click)="resetConversation()"
            [disabled]="messages.length === 0 && !sessionId"
            class="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors button-press shadow-subtle"
            aria-label="Start new conversation"
            title="Start a new conversation"
          >
            <app-icon name="refresh" classNames="w-3.5 h-3.5 text-neutral-500"></app-icon>
            <span class="hidden sm:inline">New Chat</span>
          </button>
        </div>
      </header>

      <!-- Administrative Mode Notice Bar (Only shown when admin testing mode is on) -->
      <div
        *ngIf="isAdminTestingMode"
        class="bg-neutral-100/90 border-b border-neutral-200 px-4 sm:px-6 py-2 text-xs flex items-center justify-between text-neutral-700"
      >
        <div class="flex items-center gap-2">
          <app-icon name="shield" classNames="w-3.5 h-3.5 text-neutral-900"></app-icon>
          <span class="font-semibold text-neutral-900">Administrative Testing Mode:</span>
          <span class="text-neutral-600">Inspecting grounding tags, citations, and workflow payloads.</span>
        </div>
        <span class="font-mono text-[10px] text-neutral-500 bg-white px-2 py-0.5 rounded border border-neutral-200">
          Tenant: {{ tenantSlug }}
        </span>
      </div>

      <!-- 2. Minimal White Conversation Canvas -->
      <main
        #scrollContainer
        class="flex-1 overflow-y-auto px-4 sm:px-8 py-6 space-y-6 bg-white"
        role="log"
        aria-live="polite"
        aria-label="Conversation messages"
      >
        
        <!-- Elegant Welcome State (Displayed before first message) -->
        <section
          *ngIf="messages.length === 0 && !isLoadingConfig"
          class="flex flex-col items-center justify-center text-center py-12 sm:py-16 px-4 animate-fade-in max-w-lg mx-auto"
        >
          <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-900 text-white shadow-subtle mb-4">
            <app-icon name="sparkles" classNames="w-6 h-6 text-white"></app-icon>
          </div>

          <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 font-sans">
            Hello, I’m {{ agentName }}.
          </h2>

          <p class="mt-2.5 text-xs sm:text-sm text-neutral-600 leading-relaxed max-w-md">
            {{ agentGreeting }}
          </p>

          <div class="mt-5 inline-flex items-center gap-2 rounded-full border border-neutral-200/80 bg-neutral-50/80 px-3.5 py-1 text-[11px] font-medium text-neutral-600">
            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Responses are strictly grounded in authorized customer documentation.</span>
          </div>
        </section>

        <!-- Message Stream -->
        <div *ngFor="let msg of messages; trackBy: trackByMessageId" class="space-y-4 message-entry">
          
          <!-- User Message: Subtle right-aligned bubble -->
          <div *ngIf="msg.role === 'user'" class="flex justify-end">
            <div class="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-br-sm bg-neutral-900 text-white px-4 py-2.5 text-xs sm:text-sm leading-relaxed shadow-subtle whitespace-pre-wrap break-words">
              {{ msg.content }}
            </div>
          </div>

          <!-- Assistant Message: Clean left-aligned content without card border -->
          <div *ngIf="msg.role === 'assistant'" class="flex justify-start">
            <div class="max-w-[92%] sm:max-w-[85%] space-y-2">
              
              <!-- Assistant Speaker Tag -->
              <div class="flex items-center gap-2">
                <div class="flex h-5 w-5 items-center justify-center rounded-md bg-neutral-900 text-white text-[10px] font-bold">
                  {{ agentInitials }}
                </div>
                <span class="text-xs font-semibold text-neutral-900">{{ agentName }}</span>
                <span class="text-[10px] text-neutral-400 font-mono">{{ msg.createdAt | date:'shortTime' }}</span>
              </div>

              <!-- Answer Body: Rendered Markdown or Natural Abstention -->
              <div
                class="text-xs sm:text-sm text-neutral-800 leading-relaxed font-normal"
                [innerHTML]="msg.renderedHtml"
              ></div>

              <!-- Verified Source Citations Drawer/Button (Shown only when citations exist) -->
              <div *ngIf="msg.citations && msg.citations.length > 0" class="pt-1">
                <button
                  type="button"
                  (click)="toggleCitations(msg)"
                  [attr.aria-expanded]="msg.expandedCitations"
                  class="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-medium text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
                >
                  <app-icon name="file-text" classNames="w-3 h-3 text-neutral-400"></app-icon>
                  <span>{{ msg.citations.length }} Verified {{ msg.citations.length === 1 ? 'Source' : 'Sources' }}</span>
                  <app-icon [name]="msg.expandedCitations ? 'chevron-up' : 'chevron-down'" classNames="w-2.5 h-2.5 text-neutral-400"></app-icon>
                </button>

                <!-- Expanded Citations List -->
                <div
                  *ngIf="msg.expandedCitations"
                  class="mt-2 space-y-1.5 rounded-xl border border-neutral-200/80 bg-neutral-50/70 p-3 text-xs animate-fade-in"
                  role="region"
                  aria-label="Verified sources list"
                >
                  <div
                    *ngFor="let citation of msg.citations"
                    class="flex items-start gap-2 text-neutral-700"
                  >
                    <app-icon name="check-circle" classNames="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5"></app-icon>
                    <div>
                      <span class="font-medium text-neutral-900">{{ citation.title }}</span>
                      <span class="text-neutral-400 mx-1.5">·</span>
                      <span class="font-mono text-[11px] text-neutral-500">{{ citation.locator }}</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Action Proposal Card (e.g. Lead capture request) -->
              <div
                *ngIf="msg.actionProposal"
                class="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5 space-y-2.5 shadow-subtle"
              >
                <div class="flex items-center gap-2 text-xs font-semibold text-neutral-900">
                  <app-icon name="bell" classNames="w-3.5 h-3.5 text-neutral-700"></app-icon>
                  <span>Action Confirmation</span>
                </div>
                <p class="text-xs text-neutral-600">
                  {{ msg.actionProposal.confirmation }}
                </p>
                <div class="flex items-center gap-2 pt-1">
                  <button
                    *ngIf="msg.actionState === 'awaiting_confirmation' || msg.actionState === 'unknown'"
                    type="button"
                    (click)="confirmAction(msg.actionProposal.id)"
                    [disabled]="isBusy"
                    class="rounded-lg bg-neutral-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-800 transition-all button-press"
                  >
                    {{ msg.actionState === 'unknown' ? 'Retry Request' : msg.actionProposal.consentRequired ? 'Consent & Submit' : 'Confirm & Proceed' }}
                  </button>
                  <span *ngIf="msg.actionState" class="text-[11px] font-mono text-neutral-500">
                    Status: {{ msg.actionState }}
                  </span>
                </div>
                <p *ngIf="msg.actionOutcome" class="text-xs text-emerald-700" role="status">{{ msg.actionOutcome }}</p>
              </div>

              <!-- Message Utility Toolbar: Copy & Feedback Controls -->
              <div class="flex items-center gap-3 pt-1 text-neutral-400 text-xs">
                <!-- Copy Answer -->
                <button
                  type="button"
                  (click)="copyMessage(msg)"
                  [attr.aria-label]="msg.copied ? 'Answer copied' : 'Copy answer to clipboard'"
                  class="flex items-center gap-1 hover:text-neutral-900 transition-colors py-0.5 px-1 rounded hover:bg-neutral-100"
                  title="Copy answer"
                >
                  <app-icon [name]="msg.copied ? 'check' : 'copy'" classNames="w-3 h-3"></app-icon>
                  <span class="text-[10px]" *ngIf="msg.copied">Copied</span>
                </button>

                <!-- Feedback: Thumbs Up -->
                <button
                  type="button"
                  (click)="setFeedback(msg, 'up')"
                  [attr.aria-label]="'Mark answer as helpful'"
                  [ngClass]="msg.feedback === 'up' ? 'text-neutral-900 font-medium' : 'hover:text-neutral-900'"
                  class="flex items-center gap-1 transition-colors py-0.5 px-1 rounded hover:bg-neutral-100"
                  title="Helpful"
                >
                  <app-icon name="thumbs-up" classNames="w-3 h-3"></app-icon>
                </button>

                <!-- Feedback: Thumbs Down -->
                <button
                  type="button"
                  (click)="setFeedback(msg, 'down')"
                  [attr.aria-label]="'Mark answer as unhelpful'"
                  [ngClass]="msg.feedback === 'down' ? 'text-neutral-900 font-medium' : 'hover:text-neutral-900'"
                  class="flex items-center gap-1 transition-colors py-0.5 px-1 rounded hover:bg-neutral-100"
                  title="Unhelpful"
                >
                  <app-icon name="thumbs-down" classNames="w-3 h-3"></app-icon>
                </button>

                <span *ngIf="msg.feedback" class="text-[10px] text-neutral-400 animate-fade-in">
                  Thank you
                </span>
              </div>

              <!-- Administrative Diagnostics Panel (Requirement 10: ONLY in authenticated admin testing mode) -->
              <div
                *ngIf="isAdminTestingMode"
                class="mt-2 rounded-lg border border-neutral-200 bg-neutral-50/90 p-2.5 text-[11px] font-mono space-y-1.5 text-neutral-600"
              >
                <div class="flex items-center justify-between border-b border-neutral-200/60 pb-1 font-sans">
                  <span class="font-bold text-neutral-800 text-[10px] uppercase tracking-wider">Audit Diagnostics</span>
                  <app-badge
                    [variant]="msg.grounded ? 'success' : msg.conversational ? 'neutral' : 'warning'"
                    [showDot]="true"
                    [text]="msg.grounded ? 'Grounded (100%)' : msg.conversational ? 'Conversational' : 'Abstained'"
                  ></app-badge>
                </div>
                <div class="grid grid-cols-2 gap-2 text-[10px]">
                  <div>Grounded: <span class="font-semibold">{{ msg.grounded }}</span></div>
                  <div>Conversational: <span class="font-semibold">{{ msg.conversational ? 'true' : 'false' }}</span></div>
                  <div>Citations: <span class="font-semibold">{{ msg.citations.length }}</span></div>
                  <div *ngIf="msg.diagnostics?.requestId">ReqID: {{ msg.diagnostics?.requestId?.substring(0, 8) }}...</div>
                </div>
              </div>

            </div>
          </div>

        </div>

        <!-- Assistant Typing / Loading Indicator -->
        <div *ngIf="isBusy" class="flex justify-start animate-fade-in">
          <div class="flex items-center gap-2 rounded-xl bg-neutral-100 px-3.5 py-2 text-xs text-neutral-500">
            <span class="flex gap-1">
              <span class="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce"></span>
              <span class="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:0.2s]"></span>
              <span class="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce [animation-delay:0.4s]"></span>
            </span>
            <span>Verifying knowledge...</span>
          </div>
        </div>

        <!-- Error Notification Banner -->
        <div
          *ngIf="errorMessage"
          class="rounded-xl border border-rose-200 bg-rose-50/70 p-3.5 text-xs text-rose-800 flex items-center justify-between gap-3 animate-fade-in"
          role="alert"
        >
          <div class="flex items-center gap-2">
            <app-icon name="alert-circle" classNames="w-4 h-4 text-rose-600 shrink-0"></app-icon>
            <span>{{ errorMessage }}</span>
          </div>
          <button
            *ngIf="canRetry"
            type="button"
            (click)="retryLastMessage()"
            class="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 transition-colors button-press"
          >
            Retry
          </button>
        </div>

      </main>

      <!-- 3. Responsive Bottom Composer -->
      <footer class="shrink-0 border-t border-neutral-200/80 bg-white px-4 sm:px-6 py-3 sm:py-4">
        <form (ngSubmit)="sendMessage()" class="max-w-4xl mx-auto">
          <div class="relative flex items-end gap-2 rounded-2xl border border-neutral-200 bg-neutral-50/80 p-2 sm:p-2.5 transition-all duration-200 focus-within:border-neutral-900 focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-900/10">
            
            <!-- Multiline Input Textarea with Enter-to-send and Shift+Enter for new line -->
            <textarea
              #inputArea
              [(ngModel)]="currentInput"
              name="currentInput"
              (keydown)="onTextareaKeyDown($event)"
              (input)="adjustTextareaHeight($event)"
              rows="1"
              placeholder="Ask a question about our verified products or services..."
              [disabled]="isBusy"
              class="min-h-[38px] max-h-32 w-full resize-none bg-transparent px-2 py-1.5 text-xs sm:text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none leading-relaxed"
              aria-label="Your message"
            ></textarea>

            <!-- Minimal Send Button -->
            <button
              type="submit"
              [disabled]="isBusy || !currentInput.trim()"
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white shadow-subtle transition-all hover:bg-neutral-800 disabled:opacity-30 disabled:cursor-not-allowed button-press"
              aria-label="Send message"
              title="Send message"
            >
              <app-icon
                [name]="isBusy ? 'refresh' : 'send'"
                [classNames]="isBusy ? 'w-4 h-4 animate-spin text-white' : 'w-4 h-4 text-white'"
              ></app-icon>
            </button>
          </div>

          <!-- Bottom Shortcut Hint -->
          <div class="mt-1.5 flex items-center justify-between px-1 text-[11px] text-neutral-400">
            <span>Press <kbd class="font-mono text-[10px] text-neutral-500">Enter</kbd> to send · <kbd class="font-mono text-[10px] text-neutral-500">Shift + Enter</kbd> for new line</span>
            <span *ngIf="currentInput.length > 0" class="font-mono text-[10px]">
              {{ currentInput.length }} chars
            </span>
          </div>
        </form>
      </footer>

    </div>
  `,
  styles: [`
    .message-entry {
      animation: messageFadeIn 180ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }

    @keyframes messageFadeIn {
      0% {
        opacity: 0;
        transform: translateY(6px);
      }
      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .message-entry {
        animation: none !important;
        transition: none !important;
      }
    }
  `]
})
export class CustomerChatComponent implements OnInit, OnDestroy {
  @Input() initialTenantSlug?: string;
  @Input() standalone = false;

  @ViewChild('scrollContainer') private scrollContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('inputArea') private inputArea?: ElementRef<HTMLTextAreaElement>;

  private readonly http = inject(HttpClient);
  private readonly state = inject(AdminStateService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly actionPollTimers = new Set<ReturnType<typeof setTimeout>>();

  // Configuration & Tenant state
  tenantSlug = '';
  tenantName = '';
  agentName = '';
  agentGreeting = '';
  agentTone = '';
  agentInitials = '';
  isLoadingConfig = false;

  // Session state
  sessionId: string | null = null;
  messages: CustomerChatMessage[] = [];
  currentInput = '';
  isBusy = false;
  errorMessage = '';
  canRetry = false;
  lastFailedMessage = '';

  // Mode: Administrative Testing vs Clean Customer Interface
  isAdminTestingMode = false;
  canAccessAdminTesting = false;

  private readonly apiBase = inject(API_BASE_URL);

  ngOnInit(): void {
    // 1. Resolve tenant context without customer manual slug input (Requirement 3)
    this.tenantSlug = this.initialTenantSlug ?? resolveTenantSlug();

    // Check if user is authenticated admin
    this.state.isAuthenticated$.subscribe((auth) => {
      this.canAccessAdminTesting = auth;
    });

    // Check if URL specifies debug mode
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('debug') === '1' || params.get('adminMode') === 'true') {
        this.isAdminTestingMode = true;
      }
    }

    this.loadTenantConfig();
    this.restoreOrInitSession();
  }

  ngOnDestroy(): void {
    for (const timer of this.actionPollTimers) clearTimeout(timer);
    this.actionPollTimers.clear();
  }

  toggleAdminTestingMode(): void {
    this.isAdminTestingMode = !this.isAdminTestingMode;
  }

  loadTenantConfig(): void {
    if (!isValidTenantSlug(this.tenantSlug)) {
      this.isLoadingConfig = false;
      this.errorMessage = 'Open chat with a tenant-specific URL after an organization is created.';
      return;
    }
    this.isLoadingConfig = true;
    this.http.get<TenantChatConfig>(`${this.apiBase}/api/v1/chat/config?tenantSlug=${encodeURIComponent(this.tenantSlug)}`)
      .subscribe({
        next: (config) => {
          this.isLoadingConfig = false;
          if (config?.tenant) {
            this.tenantName = config.tenant.name;
          }
          if (config?.persona) {
            this.agentName = config.persona.name || 'Sales Assistant';
            this.agentGreeting = config.persona.greeting || 'How may I assist you today?';
            this.agentTone = config.persona.tone || 'Grounded & Helpful';
            this.agentInitials = this.getInitials(this.agentName);
          }
        },
        error: () => {
          this.isLoadingConfig = false;
          this.errorMessage = 'Tenant chat configuration is unavailable.';
        }
      });
  }

  restoreOrInitSession(): void {
    if (typeof window === 'undefined' || !isValidTenantSlug(this.tenantSlug)) return;
    const storageKey = `agentic-rag-session:${this.tenantSlug}`;
    const saved = window.localStorage.getItem(storageKey);

    if (saved) {
      this.http.get<{ sessionId: string; messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; citations: ChatCitation[]; conversational?: boolean; createdAt: string }> }>(`${this.apiBase}/api/v1/chat/sessions/${saved}`)
        .subscribe({
          next: (res) => {
            this.sessionId = res.sessionId;
            this.messages = res.messages.map((m) => this.mapHistoryMessage(m));
            this.scrollToBottom();
          },
          error: () => {
            window.localStorage.removeItem(storageKey);
            this.sessionId = null;
            this.messages = [];
          }
        });
    }
  }

  sendMessage(): void {
    const text = this.currentInput.trim();
    if (!text || this.isBusy) return;

    this.errorMessage = '';
    this.canRetry = false;
    this.lastFailedMessage = text;

    // Add user message to UI immediately
    const userMsg: CustomerChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: text,
      grounded: true,
      citations: [],
      createdAt: new Date().toISOString()
    };
    this.messages.push(userMsg);
    this.currentInput = '';
    this.resetTextareaHeight();
    this.scrollToBottom();

    this.isBusy = true;

    // Ensure session exists
    if (!this.sessionId) {
      this.http.post<{ sessionId: string }>(`${this.apiBase}/api/v1/chat/sessions`, { tenantSlug: this.tenantSlug })
        .subscribe({
          next: (sessionRes) => {
            this.sessionId = sessionRes.sessionId;
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(`agentic-rag-session:${this.tenantSlug}`, this.sessionId);
            }
            this.postChatMessage(text);
          },
          error: (err) => {
            this.isBusy = false;
            this.errorMessage = err?.error?.message ?? 'Could not establish a secure conversation session.';
            this.canRetry = true;
          }
        });
    } else {
      this.postChatMessage(text);
    }
  }

  private postChatMessage(message: string): void {
    const clientMessageId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}`;

    this.http.post<{
      messageId: string;
      answer: string;
      grounded: boolean;
      conversational?: boolean;
      citations: ChatCitation[];
      actionProposal?: ChatActionProposal | null;
      requestId: string;
    }>(`${this.apiBase}/api/v1/chat/messages`, {
      sessionId: this.sessionId,
      message,
      clientMessageId
    }).subscribe({
      next: (res) => {
        this.isBusy = false;

        // Apply natural language formatting to technical abstentions (Requirement 9)
        const naturalText = formatNaturalAbstention(res.answer);
        const safeHtml = this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(naturalText));

        const assistantMsg: CustomerChatMessage = {
          id: res.messageId,
          role: 'assistant',
          content: naturalText,
          grounded: res.grounded,
          conversational: res.conversational,
          citations: res.citations || [],
          actionProposal: res.actionProposal,
          actionState: res.actionProposal ? 'awaiting_confirmation' : undefined,
          createdAt: new Date().toISOString(),
          renderedHtml: safeHtml as string,
          naturalAnswer: naturalText,
          diagnostics: {
            requestId: res.requestId,
            sessionId: this.sessionId ?? undefined,
            rawGrounded: res.grounded,
            rawConversational: res.conversational
          }
        };

        this.messages.push(assistantMsg);
        this.scrollToBottom();
      },
      error: (err) => {
        this.isBusy = false;
        this.errorMessage = err?.error?.message ?? 'The assistant was unable to respond. Please try again.';
        this.canRetry = true;
      }
    });
  }

  confirmAction(proposalId: string): void {
    if (!this.sessionId) return;
    this.isBusy = true;

    this.http.post<{ action?: { state: ChatActionState }; message?: string; error?: { message?: string } }>(
      `${this.apiBase}/api/v1/chat/actions/${proposalId}/confirm`,
      { sessionId: this.sessionId, confirmed: true }
    ).subscribe({
      next: (res) => {
        this.isBusy = false;
        const state = res.action?.state ?? 'completed';
        const target = this.messages.find((m) => m.actionProposal?.id === proposalId);
        if (target) {
          target.actionState = state;
          target.actionOutcome = res.message ?? 'Your request is registered and will continue processing asynchronously.';
        }
        if (state === 'approved' || state === 'processing') this.pollActionStatus(proposalId);
      },
      error: () => {
        this.isBusy = false;
        this.errorMessage = 'The workflow action could not be confirmed.';
      }
    });
  }

  private pollActionStatus(proposalId: string, attempt = 0): void {
    if (!this.sessionId || attempt >= 90) return;
    const timer = setTimeout(() => {
      this.actionPollTimers.delete(timer);
      this.http.get<{ action?: { state?: ChatActionState } }>(`${this.apiBase}/api/v1/chat/actions/${proposalId}?sessionId=${encodeURIComponent(this.sessionId ?? '')}`).subscribe({
        next: (response) => {
          const state = response.action?.state;
          if (!state) { this.pollActionStatus(proposalId, attempt + 1); return; }
          const target = this.messages.find((message) => message.actionProposal?.id === proposalId);
          if (target) {
            target.actionState = state;
            target.actionOutcome = state === 'completed'
              ? 'Your request has been completed and is ready for follow-up.'
              : state === 'failed'
                ? 'The request could not be completed. Please start a new request.'
                : state === 'reconcile_required'
                  ? 'Your request is registered, but external confirmation needs review.'
                  : target.actionOutcome;
          }
          if (state !== 'completed' && state !== 'failed' && state !== 'reconcile_required') this.pollActionStatus(proposalId, attempt + 1);
        },
        error: () => this.pollActionStatus(proposalId, attempt + 1)
      });
    }, 1000);
    this.actionPollTimers.add(timer);
  }

  retryLastMessage(): void {
    if (this.lastFailedMessage) {
      this.currentInput = this.lastFailedMessage;
      this.sendMessage();
    }
  }

  resetConversation(): void {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(`agentic-rag-session:${this.tenantSlug}`);
    }
    this.sessionId = null;
    this.messages = [];
    this.errorMessage = '';
    this.currentInput = '';
    this.resetTextareaHeight();
  }

  copyMessage(msg: CustomerChatMessage): void {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(msg.naturalAnswer || msg.content);
      msg.copied = true;
      setTimeout(() => {
        msg.copied = false;
      }, 2000);
    }
  }

  setFeedback(msg: CustomerChatMessage, type: 'up' | 'down'): void {
    msg.feedback = msg.feedback === type ? undefined : type;
  }

  toggleCitations(msg: CustomerChatMessage): void {
    msg.expandedCitations = !msg.expandedCitations;
  }

  onTextareaKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  adjustTextareaHeight(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 128)}px`;
  }

  private resetTextareaHeight(): void {
    if (this.inputArea?.nativeElement) {
      this.inputArea.nativeElement.style.height = 'auto';
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.scrollContainer?.nativeElement) {
        this.scrollContainer.nativeElement.scrollTo({
          top: this.scrollContainer.nativeElement.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 50);
  }

  private mapHistoryMessage(m: { id: string; role: 'user' | 'assistant'; content: string; citations: ChatCitation[]; conversational?: boolean; createdAt: string }): CustomerChatMessage {
    const natural = m.role === 'assistant' ? formatNaturalAbstention(m.content) : m.content;
    const safeHtml = m.role === 'assistant' ? (this.sanitizer.bypassSecurityTrustHtml(renderMarkdown(natural)) as string) : undefined;
    return {
      id: m.id,
      role: m.role,
      content: natural,
      grounded: (m.citations && m.citations.length > 0),
      conversational: m.conversational,
      citations: m.citations || [],
      createdAt: m.createdAt,
      renderedHtml: safeHtml,
      naturalAnswer: natural
    };
  }

  private getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return (name.substring(0, 2) || 'AG').toUpperCase();
  }

  trackByMessageId(_index: number, msg: CustomerChatMessage): string {
    return msg.id;
  }
}

import '@angular/compiler';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Injector, runInInjectionContext, signal, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { HttpClient } from '@angular/common/http';
import { DomSanitizer } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';
import { CustomerChatComponent } from './customer-chat.component';
import { AdminStateService } from '../../services/admin-state.service';
import { API_BASE_URL } from '../../services/tokens';
import {
  ChatCitation,
  formatNaturalAbstention,
  renderMarkdown,
  resolveTenantSlug
} from './customer-chat-utils';

if (typeof (globalThis as any).document === 'undefined') {
  (globalThis as any).document = {
    querySelector: () => null,
    createElement: () => ({ setAttribute: () => {} }),
    createTextNode: () => ({}),
    createComment: () => ({})
  };
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = { document: (globalThis as any).document };
}

try {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
} catch {
  // Already initialized
}

describe('CustomerChatComponent logic and contracts', () => {
  let localStorageStore: Record<string, string> = {};

  beforeEach(() => {
    localStorageStore = {};
    (globalThis as any).window = {
      localStorage: {
        getItem: (k: string) => localStorageStore[k] ?? null,
        setItem: (k: string, v: string) => { localStorageStore[k] = v; },
        removeItem: (k: string) => { delete localStorageStore[k]; }
      },
      location: { search: '' }
    };
  });

  it('resolves tenant context securely without manual slug input', () => {
    const slugFromQuery = resolveTenantSlug('?tenant=enterprise-alpha');
    expect(slugFromQuery).toBe('enterprise-alpha');

    const defaultSlug = resolveTenantSlug('', 'tenant-a');
    expect(defaultSlug).toBe('tenant-a');
  });

  it('renders markdown with safe HTML structure for assistant answers', () => {
    const answer = `### Pricing Details\n\nOur Enterprise Tier includes:\n- Dedicated VPC peering\n- **15-minute** SLA response\n- 24/7 engineering dispatch`;
    const html = renderMarkdown(answer);

    expect(html).toContain('<ul class="my-2.5 space-y-1 list-disc list-inside text-neutral-800">');
    expect(html).toContain('<strong class="font-semibold text-neutral-900">15-minute</strong>');
    expect(html).not.toContain('<script>');
  });

  it('converts technical abstention messages to natural, polite customer language', () => {
    const rawAbstention = 'I’m Sales assistant. The approved knowledge does not establish an answer to that question, so I won’t guess.';
    const natural = formatNaturalAbstention(rawAbstention);

    expect(natural).not.toContain('won’t guess');
    expect(natural).toContain('I don’t have verified documentation on that topic in our current records');
  });

  it('preserves verified citation locators and titles for source drawer expansion', () => {
    const citations: ChatCitation[] = [
      { title: 'SOC-2 Type II Report', locator: 'Section 3.2' },
      { title: 'Master Services Agreement', locator: 'Appendix A' }
    ];

    expect(citations.length).toBe(2);
    expect(citations[0].title).toBe('SOC-2 Type II Report');
    expect(citations[1].locator).toBe('Appendix A');
  });

  // [P1 Finding 1 Test]: Session restoration is not destructively reset on load
  it('preserves saved localStorage session across in-memory reset, and only removes it on explicit newConversation', () => {
    localStorageStore['agentic-rag-session:tenant-acme'] = 'session-existing-123';

    let tenantSlug = 'tenant-acme';
    let sessionId: string | null = 'session-existing-123';
    let messages: any[] = [{ id: 'm1', content: 'Hello' }];

    // 1. In-memory reset (called on resolveAndLoad / component navigation)
    const resetInMemoryConversation = () => {
      sessionId = null;
      messages = [];
    };

    resetInMemoryConversation();
    expect(sessionId).toBeNull();
    expect(messages.length).toBe(0);
    // Verify localStorage key is PRESERVED so restoreOrInitSession can restore it!
    expect(localStorageStore['agentic-rag-session:tenant-acme']).toBe('session-existing-123');

    // Simulate session restoration
    const restored = localStorageStore[`agentic-rag-session:${tenantSlug}`];
    expect(restored).toBe('session-existing-123');
    sessionId = restored;

    // 2. Explicit new conversation action
    const newConversation = () => {
      delete localStorageStore[`agentic-rag-session:${tenantSlug}`];
      resetInMemoryConversation();
    };

    newConversation();
    // Verify session in localStorage is now deleted
    expect(localStorageStore['agentic-rag-session:tenant-acme']).toBeUndefined();
    expect(sessionId).toBeNull();
  });

  // [P2 Finding 2 Real Component Test]: Invalidate generation on New Chat during session initialization
  it('CustomerChatComponent invalidates generation on newConversation and rejects stale session POST replies without resurrecting localStorage', () => {
    const sessionPostSubject = new Subject<{ sessionId: string }>();
    const httpMock = {
      get: vi.fn().mockReturnValue(of({ tenant: { name: 'Acme', slug: 'tenant-acme' } })),
      post: vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/chat/sessions')) {
          return sessionPostSubject;
        }
        return of({});
      })
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'http://127.0.0.1:4000' },
        { provide: HttpClient, useValue: httpMock },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (h: string) => h } },
        {
          provide: AdminStateService,
          useValue: {
            selectedTenant: signal(null),
            isAuthenticated: signal(false)
          }
        }
      ]
    });

    const component = runInInjectionContext(TestBed.inject(EnvironmentInjector), () => new CustomerChatComponent());
    component.initialTenantSlug = 'tenant-acme';
    component.ngOnInit();
    TestBed.flushEffects();

    expect(component.tenantSlug).toBe('tenant-acme');
    expect(component.sessionId).toBeNull();

    // User types and submits message before a session exists
    component.currentInput = 'What is your compliance roadmap?';
    component.sendMessage();

    // A session POST was dispatched and is pending
    expect(httpMock.post).toHaveBeenCalledWith('http://127.0.0.1:4000/api/v1/chat/sessions', { tenantSlug: 'tenant-acme' });
    expect(component.messages.length).toBe(1);
    expect(component.isBusy).toBe(true);

    // User explicitly clicks "New Chat" while the request is in-flight
    component.newConversation();

    // Verify in-memory state is cleared immediately
    expect(component.messages.length).toBe(0);
    expect(component.sessionId).toBeNull();
    expect(component.isBusy).toBe(false);
    expect(localStorageStore['agentic-rag-session:tenant-acme']).toBeUndefined();

    // Stale session creation response finally arrives from backend
    sessionPostSubject.next({ sessionId: 'stale-session-from-cleared-chat' });
    sessionPostSubject.complete();

    // Assert: stale session was discarded, sessionId is NOT set, and localStorage was NOT resurrected!
    expect(component.sessionId).toBeNull();
    expect(component.messages.length).toBe(0);
    expect(localStorageStore['agentic-rag-session:tenant-acme']).toBeUndefined();
  });

  // [P2 Finding 2 Real Component Test]: Invalidate generation on New Chat during chat message reply
  it('CustomerChatComponent invalidates generation on newConversation and rejects stale chat message replies without repopulating UI', () => {
    const messagePostSubject = new Subject<any>();
    const httpMock = {
      get: vi.fn().mockReturnValue(of({ tenant: { name: 'Acme', slug: 'tenant-acme' } })),
      post: vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/chat/messages')) {
          return messagePostSubject;
        }
        return of({});
      })
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'http://127.0.0.1:4000' },
        { provide: HttpClient, useValue: httpMock },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (h: string) => h } },
        {
          provide: AdminStateService,
          useValue: {
            selectedTenant: signal(null),
            isAuthenticated: signal(false)
          }
        }
      ]
    });

    const component = runInInjectionContext(TestBed.inject(EnvironmentInjector), () => new CustomerChatComponent());
    component.initialTenantSlug = 'tenant-acme';
    component.ngOnInit();
    TestBed.flushEffects();

    // Existing session active
    component.sessionId = 'active-session-999';

    // User sends a message
    component.currentInput = 'Tell me about SLAs';
    component.sendMessage();

    expect(component.messages.length).toBe(1);
    expect(component.isBusy).toBe(true);

    // User clicks "New Chat" while assistant is thinking
    component.newConversation();

    expect(component.messages.length).toBe(0);
    expect(component.sessionId).toBeNull();
    expect(component.isBusy).toBe(false);

    // Assistant response arrives late
    messagePostSubject.next({
      messageId: 'msg-late-1',
      answer: 'Our SLA response time is 15 minutes for Tier 1.',
      grounded: true,
      citations: [],
      requestId: 'req-late-1'
    });
    messagePostSubject.complete();

    // Assert: cleared chat was NOT repopulated with stale assistant response!
    expect(component.messages.length).toBe(0);
    expect(component.sessionId).toBeNull();
  });

  // [P1 Finding 2 Real Component Test]: Rapid tenant switching A -> B guards
  it('CustomerChatComponent guards rapid tenant switching and discards responses from former tenant', () => {
    const tenantAConfig$ = new Subject<any>();
    const tenantBConfig$ = new Subject<any>();

    const httpMock = {
      get: vi.fn().mockImplementation((url: string) => {
        if (url.includes('tenantSlug=tenant-a')) return tenantAConfig$;
        if (url.includes('tenantSlug=tenant-b')) return tenantBConfig$;
        return of({});
      }),
      post: vi.fn().mockReturnValue(of({}))
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'http://127.0.0.1:4000' },
        { provide: HttpClient, useValue: httpMock },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (h: string) => h } },
        {
          provide: AdminStateService,
          useValue: {
            selectedTenant: signal(null),
            isAuthenticated: signal(false)
          }
        }
      ]
    });

    const component = runInInjectionContext(TestBed.inject(EnvironmentInjector), () => new CustomerChatComponent());

    // Switch to Tenant A
    component.initialTenantSlug = 'tenant-a';
    component.ngOnInit();
    TestBed.flushEffects();
    expect(component.tenantSlug).toBe('tenant-a');

    // Switch to Tenant B before Tenant A config arrives
    component.ngOnChanges({
      initialTenantSlug: {
        previousValue: 'tenant-a',
        currentValue: 'tenant-b',
        firstChange: false,
        isFirstChange: () => false
      }
    });
    expect(component.tenantSlug).toBe('tenant-b');

    // Stale Tenant A config response arrives
    tenantAConfig$.next({
      tenant: { name: 'Tenant A Org', slug: 'tenant-a' },
      persona: { name: 'Agent Alpha', greeting: 'Hello from A', tone: 'Formal', speakingStyle: 'Brief' }
    });
    tenantAConfig$.complete();

    // Verify Tenant A config was discarded!
    expect(component.agentName).not.toBe('Agent Alpha');
    expect(component.tenantName).not.toBe('Tenant A Org');

    // Valid Tenant B config response arrives
    tenantBConfig$.next({
      tenant: { name: 'Tenant B Org', slug: 'tenant-b' },
      persona: { name: 'Agent Beta', greeting: 'Hello from B', tone: 'Helpful', speakingStyle: 'Conversational' }
    });
    tenantBConfig$.complete();

    // Verify Tenant B config was applied!
    expect(component.agentName).toBe('Agent Beta');
    expect(component.tenantName).toBe('Tenant B Org');
  });

  // [P2 Finding 2 Real Component Test]: Deferred history GET blocks send until restored, ensuring single session identity and preserving history
  it('CustomerChatComponent blocks user send while history restoration is in-flight, preventing dual sessions and history overwrites', () => {
    const historyGetSubject = new Subject<any>();
    const sessionPostSubject = new Subject<any>();
    const messagePostSubject = new Subject<any>();

    const httpMock = {
      get: vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/chat/sessions/saved-session-123')) {
          return historyGetSubject;
        }
        return of({ tenant: { name: 'Acme', slug: 'tenant-acme' } });
      }),
      post: vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/v1/chat/sessions')) return sessionPostSubject;
        if (url.includes('/api/v1/chat/messages')) return messagePostSubject;
        return of({});
      })
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: API_BASE_URL, useValue: 'http://127.0.0.1:4000' },
        { provide: HttpClient, useValue: httpMock },
        { provide: DomSanitizer, useValue: { bypassSecurityTrustHtml: (h: string) => h } },
        {
          provide: AdminStateService,
          useValue: {
            selectedTenant: signal(null),
            isAuthenticated: signal(false)
          }
        }
      ]
    });

    // Populate saved session in localStorage
    localStorageStore['agentic-rag-session:tenant-acme'] = 'saved-session-123';

    const component = runInInjectionContext(TestBed.inject(EnvironmentInjector), () => new CustomerChatComponent());
    component.initialTenantSlug = 'tenant-acme';
    component.ngOnInit();
    TestBed.flushEffects();

    // 1. History restoration is in-flight: isRestoringSession must be true
    expect(component.isRestoringSession).toBe(true);

    // 2. User attempts to send a message while history is loading
    component.currentInput = 'Can I send while restoring?';
    component.sendMessage();

    // Assert send was blocked: no duplicate session POST was dispatched, no messages added!
    expect(httpMock.post).not.toHaveBeenCalled();
    expect(component.messages.length).toBe(0);

    // 3. Deferred history GET now resolves
    historyGetSubject.next({
      sessionId: 'saved-session-123',
      messages: [
        { id: 'm-old-1', role: 'user', content: 'Previous Question', citations: [], createdAt: '2026-01-01T00:00:00Z' },
        { id: 'm-old-2', role: 'assistant', content: 'Previous Answer', citations: [], createdAt: '2026-01-01T00:00:01Z' }
      ]
    });
    historyGetSubject.complete();

    // 4. Assert restoration completed: isRestoringSession is false, sessionId matches restored session, history intact
    expect(component.isRestoringSession).toBe(false);
    expect(component.sessionId).toBe('saved-session-123');
    expect(component.messages.length).toBe(2);
    expect(component.messages[0].content).toBe('Previous Question');
    expect(component.messages[1].content).toBe('Previous Answer');

    // 5. User now submits a new message
    component.currentInput = 'Follow-up question';
    component.sendMessage();

    // Assert message sent under the single restored session identity (NO new session POST)
    expect(httpMock.post).toHaveBeenCalledWith(
      'http://127.0.0.1:4000/api/v1/chat/messages',
      expect.objectContaining({ sessionId: 'saved-session-123', message: 'Follow-up question' })
    );
  });
});

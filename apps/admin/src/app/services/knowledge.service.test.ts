import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BrowserDynamicTestingModule, platformBrowserDynamicTesting } from '@angular/platform-browser-dynamic/testing';
import { HttpClient } from '@angular/common/http';
import { Subject } from 'rxjs';
import { KnowledgeService } from './knowledge.service';
import { API_BASE_URL } from './tokens';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import type { Source } from '../types/admin.types';

try {
  TestBed.initTestEnvironment(BrowserDynamicTestingModule, platformBrowserDynamicTesting());
} catch {
  // Already initialized
}

describe('KnowledgeService', () => {
  it('does not apply an in-flight response after the selected tenant changes', () => {
    const token = signal('admin-token');
    const tenant = { current: 'tenant-a' };
    const requests: Array<Subject<{ items: Source[] }>> = [];
    const http = { get: () => {
      const request = new Subject<{ items: Source[] }>();
      requests.push(request);
      return request.asObservable();
    } };
    TestBed.configureTestingModule({
      providers: [
        KnowledgeService,
        { provide: HttpClient, useValue: http },
        { provide: API_BASE_URL, useValue: 'http://api' },
        { provide: AuthService, useValue: { token, get selectedTenantId() { return tenant.current; } } },
        { provide: ToastService, useValue: { show: () => undefined } },
      ],
    });

    const service = TestBed.inject(KnowledgeService);
    service.loadSources();
    tenant.current = 'tenant-b';
    service.loadSources();
    const sourceA = { id: 'source-a', title: 'A', status: 'active' as const, audience: 'public' as const, mimeType: 'text/plain' };
    const sourceB = { id: 'source-b', title: 'B', status: 'active' as const, audience: 'public' as const, mimeType: 'text/plain' };
    requests[0]!.next({ items: [sourceA] });
    requests[1]!.next({ items: [sourceB] });

    expect(service.sources()).toEqual([sourceB]);
  });
});

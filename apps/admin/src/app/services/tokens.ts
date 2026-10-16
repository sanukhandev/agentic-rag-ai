import { InjectionToken } from '@angular/core';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => {
    if (typeof window !== 'undefined' && window.location && window.location.hostname) {
      const hostname = window.location.hostname;
      const protocol = window.location.protocol || 'http:';
      return `${protocol}//${hostname}:4000`;
    }
    return 'http://127.0.0.1:4000';
  }
});

export const ADMIN_STORAGE_KEYS = {
  TOKEN: 'agentic-rag-admin-token',
  ROLE: 'agentic-rag-admin-role',
  EMAIL: 'agentic-rag-admin-email',
  TENANT_ID: 'agentic-rag-admin-tenant-id'
} as const;

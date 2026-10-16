import { InjectionToken } from '@angular/core';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://127.0.0.1:4000'
});

export const ADMIN_STORAGE_KEYS = {
  TOKEN: 'agentic-rag-admin-token',
  ROLE: 'agentic-rag-admin-role',
  EMAIL: 'agentic-rag-admin-email',
  TENANT_ID: 'agentic-rag-admin-tenant-id'
} as const;

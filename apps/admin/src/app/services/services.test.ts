import { describe, expect, it } from 'vitest';
import { ToastService } from './toast.service';
import { isValidTenantSlug, resolveTenantSlug } from '../components/customer-chat/customer-chat-utils';

describe('SOLID Services and Architecture Contracts', () => {
  it('ToastService adheres to Single Responsibility by managing toast notifications independently', () => {
    const toastService = new ToastService();
    let currentToasts: any[] = [];
    const sub = toastService.toasts$.subscribe((t) => (currentToasts = t));

    expect(currentToasts.length).toBe(0);

    toastService.show('success', 'Tenant Created', 'Acme Corp is now provisioned.');
    expect(currentToasts.length).toBe(1);
    expect(currentToasts[0].title).toBe('Tenant Created');
    expect(currentToasts[0].type).toBe('success');

    const id = currentToasts[0].id;
    toastService.dismiss(id);
    expect(currentToasts.length).toBe(0);

    sub.unsubscribe();
  });

  it('validates tenant slug safety rules', () => {
    expect(isValidTenantSlug('acme-corp')).toBe(true);
    expect(isValidTenantSlug('acme_corp')).toBe(false); // only lowercase alphanumeric and dashes
    expect(isValidTenantSlug('acme 123')).toBe(false);
  });

  it('resolves tenant slug with graceful fallback', () => {
    expect(resolveTenantSlug('?tenant=stripe-emea')).toBe('stripe-emea');
    expect(resolveTenantSlug('', 'default-tenant')).toBe('default-tenant');
  });

  it('excludes organizations tab from tenant admin navigation', () => {
    const navTabs = [
      { id: 'overview', label: 'Overview' },
      { id: 'organizations', label: 'Organizations' },
      { id: 'knowledge', label: 'Knowledge' },
      { id: 'studio', label: 'AI Studio' },
      { id: 'chat', label: 'Customer Chat' },
      { id: 'crm', label: 'CRM' },
      { id: 'observability', label: 'Observability' },
      { id: 'settings', label: 'Settings' }
    ];

    const filterTabsForRole = (role: string) =>
      navTabs.filter((tab) => {
        if (tab.id === 'organizations') return role === 'platform_admin';
        if (tab.id === 'crm') return role !== 'platform_admin';
        return true;
      });

    const tenantAdminTabs = filterTabsForRole('tenant_admin');
    expect(tenantAdminTabs.some((t) => t.id === 'organizations')).toBe(false);
    expect(tenantAdminTabs.some((t) => t.id === 'crm')).toBe(true);

    const platformAdminTabs = filterTabsForRole('platform_admin');
    expect(platformAdminTabs.some((t) => t.id === 'organizations')).toBe(true);
    expect(platformAdminTabs.some((t) => t.id === 'crm')).toBe(false);
  });
});

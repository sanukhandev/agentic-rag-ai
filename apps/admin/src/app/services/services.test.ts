import { describe, expect, it } from 'vitest';
import { ToastService } from './toast.service';
import { canAccessAdminSection } from './admin-navigation';
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

  it('keeps platform operations away from tenant navigation', () => {
    expect(canAccessAdminSection('tenant_admin', 'organizations')).toBe(false);
    expect(canAccessAdminSection('tenant_admin', 'observability')).toBe(false);
    expect(canAccessAdminSection('tenant_admin', 'studio')).toBe(true);
    expect(canAccessAdminSection('tenant_admin', 'crm')).toBe(true);
    expect(canAccessAdminSection('platform_admin', 'organizations')).toBe(true);
    expect(canAccessAdminSection('platform_admin', 'observability')).toBe(true);
  });

  it('applies least privilege to editor and viewer roles', () => {
    expect(canAccessAdminSection('tenant_editor', 'knowledge')).toBe(true);
    expect(canAccessAdminSection('tenant_editor', 'studio')).toBe(false);
    expect(canAccessAdminSection('tenant_viewer', 'knowledge')).toBe(false);
    expect(canAccessAdminSection('tenant_viewer', 'chat')).toBe(true);
  });
});

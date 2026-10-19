import { NavSection } from '../types/admin.types';

export type AdminRole = 'platform_admin' | 'tenant_admin' | 'tenant_editor' | 'tenant_viewer' | '';

/** Central navigation policy shared by the shell, route actions, and data loading. */
export function canAccessAdminSection(role: AdminRole | string, section: NavSection): boolean {
  if (role === 'platform_admin') return true;
  if (!role) return false;
  if (section === 'organizations' || section === 'observability') return false;
  if (section === 'settings' || section === 'studio' || section === 'catalog') return role === 'tenant_admin';
  if (section === 'knowledge') return role === 'tenant_admin' || role === 'tenant_editor';
  return true;
}

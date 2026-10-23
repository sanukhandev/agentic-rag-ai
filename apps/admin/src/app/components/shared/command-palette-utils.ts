import { Tenant, Source, NavSection } from '../../types/admin.types';

export interface CommandItem {
  id: string;
  title: string;
  category: 'Navigation' | 'Actions' | 'Tenants' | 'Sources';
  icon: string;
  shortcut?: string;
  action: () => void;
}

export const COMMAND_SECTION_MAP: Record<string, NavSection> = {
  'nav-overview': 'overview',
  'nav-organizations': 'organizations',
  'nav-knowledge': 'knowledge',
  'nav-studio': 'studio',
  'nav-chat': 'chat',
  'nav-crm': 'crm',
  'nav-observability': 'observability',
  'nav-settings': 'settings',
  'act-new-org': 'organizations',
  'act-stage-source': 'knowledge',
  'act-purge-sessions': 'settings'
};

export function filterPermittedCommands(options: {
  isPlatformAdmin: boolean;
  canAccessSection: (section: NavSection) => boolean;
  tenants: Tenant[];
  sources: Source[];
  onNavigate: (section: NavSection) => void;
  onSelectTenant: (tenant: Tenant) => void;
  onOpenCreateOrg: () => void;
  onOpenUpload: () => void;
  onPurgeSessions: () => void;
}): CommandItem[] {
  const baseList: CommandItem[] = [
    {
      id: 'nav-overview',
      title: 'Go to Overview Dashboard',
      category: 'Navigation',
      icon: 'overview',
      action: () => options.onNavigate('overview')
    },
    {
      id: 'nav-organizations',
      title: 'Go to Organizations Directory',
      category: 'Navigation',
      icon: 'organizations',
      action: () => options.onNavigate('organizations')
    },
    {
      id: 'nav-knowledge',
      title: 'Open Content',
      category: 'Navigation',
      icon: 'knowledge',
      action: () => options.onNavigate('knowledge')
    },
    {
      id: 'nav-studio',
      title: 'Open Assistant Settings',
      category: 'Navigation',
      icon: 'studio',
      action: () => options.onNavigate('studio')
    },
    {
      id: 'nav-chat',
      title: 'Preview Customer Chat',
      category: 'Navigation',
      icon: 'chat',
      action: () => options.onNavigate('chat')
    },
    {
      id: 'nav-crm',
      title: 'Review Leads',
      category: 'Navigation',
      icon: 'users',
      action: () => options.onNavigate('crm')
    },
    {
      id: 'nav-observability',
      title: 'Go to Observability & Telemetry Matrix',
      category: 'Navigation',
      icon: 'observability',
      action: () => options.onNavigate('observability')
    },
    {
      id: 'nav-settings',
      title: 'Open Workspace Settings',
      category: 'Navigation',
      icon: 'settings',
      action: () => options.onNavigate('settings')
    },
    {
      id: 'act-new-org',
      title: 'Provision New Organization',
      category: 'Actions',
      icon: 'plus',
      action: () => options.onOpenCreateOrg()
    },
    {
      id: 'act-stage-source',
      title: 'Add Content',
      category: 'Actions',
      icon: 'upload',
      action: () => options.onOpenUpload()
    },
    {
      id: 'act-purge-sessions',
      title: 'Execute 24h Expired Sessions Purge',
      category: 'Actions',
      icon: 'trash',
      action: () => options.onPurgeSessions()
    }
  ];

  const permittedList = baseList.filter((item) => {
    const section = COMMAND_SECTION_MAP[item.id];
    return !section || options.canAccessSection(section);
  });

  if (options.isPlatformAdmin) {
    for (const t of options.tenants) {
      permittedList.push({
        id: `tenant-${t.id}`,
        title: `Tenant: ${t.name} (${t.slug})`,
        category: 'Tenants',
        icon: 'building',
        action: () => options.onSelectTenant(t)
      });
    }
  }

  if (options.canAccessSection('knowledge')) {
    for (const s of options.sources.slice(0, 5)) {
      permittedList.push({
        id: `source-${s.id}`,
        title: `Source: ${s.title}`,
        category: 'Sources',
        icon: 'file-text',
        action: () => options.onNavigate('knowledge')
      });
    }
  }

  return permittedList;
}

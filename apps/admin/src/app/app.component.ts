import { Component, OnInit, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminStateService } from './services/admin-state.service';
import { NavSection, Tenant } from './types/admin.types';
import { TopNavComponent } from './components/top-nav/top-nav.component';
import { KpiCardsComponent } from './components/kpi-cards/kpi-cards.component';
import { OrgTableComponent } from './components/org-table/org-table.component';
import { ServiceHealthComponent } from './components/service-health/service-health.component';
import { ActivityPipelineComponent } from './components/activity-pipeline/activity-pipeline.component';
import { KnowledgeManagerComponent } from './components/knowledge-manager/knowledge-manager.component';
import { AiStudioComponent } from './components/ai-studio/ai-studio.component';
import { SettingsViewComponent } from './components/settings-view/settings-view.component';
import { OnboardDrawerComponent } from './components/onboard-drawer/onboard-drawer.component';
import { CommandPaletteComponent } from './components/shared/command-palette.component';
import { ToastComponent } from './components/shared/toast.component';
import { LoginPageComponent } from './components/login-page/login-page.component';
import { CustomerChatComponent } from './components/customer-chat/customer-chat.component';
import { CrmComponent } from './components/crm/crm.component';
import { IntentCatalogComponent } from './components/intent-catalog/intent-catalog.component';
import { IconComponent } from './components/shared/icon.component';
import { BadgeComponent } from './components/shared/badge.component';
import { UserRole } from './services/auth.service';
import { canAccessAdminSection } from './services/admin-navigation';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    TopNavComponent,
    KpiCardsComponent,
    OrgTableComponent,
    ServiceHealthComponent,
    ActivityPipelineComponent,
    KnowledgeManagerComponent,
    AiStudioComponent,
    SettingsViewComponent,
    OnboardDrawerComponent,
    CommandPaletteComponent,
    ToastComponent,
    LoginPageComponent,
    CustomerChatComponent,
    CrmComponent,
    IntentCatalogComponent,
    IconComponent,
    BadgeComponent
  ],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  readonly state = inject(AdminStateService);

  isStandaloneChat = false;

  readonly navTabs: Array<{ id: NavSection; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    { id: 'organizations', label: 'Organizations', icon: 'organizations' },
    { id: 'knowledge', label: 'Content', icon: 'knowledge' },
    { id: 'catalog', label: 'Intent Catalog', icon: 'workflow' },
    { id: 'studio', label: 'Assistant', icon: 'studio' },
    { id: 'chat', label: 'Chat Preview', icon: 'chat' },
    { id: 'crm', label: 'Leads', icon: 'users' },
    { id: 'observability', label: 'Observability', icon: 'observability' },
    { id: 'settings', label: 'Workspace Settings', icon: 'settings' }
  ];

  // Fine-grained Signal accessors
  get isAuthenticated(): boolean {
    return this.state.isAuthenticated();
  }

  get currentSection(): NavSection {
    return this.state.currentSection();
  }

  get role(): UserRole {
    return this.state.role();
  }

  get selectedTenant(): Tenant | null {
    return this.state.selectedTenant();
  }

  readonly visibleNavTabsSignal = computed(() => {
    const currentRole = this.state.role();
    return this.navTabs.filter((tab) => canAccessAdminSection(currentRole, tab.id));
  });

  get visibleNavTabs(): Array<{ id: NavSection; label: string; icon: string }> {
    return this.visibleNavTabsSignal();
  }

  readonly roleLabelSignal = computed(() => {
    switch (this.state.role()) {
      case 'platform_admin': return 'Platform Owner';
      case 'tenant_admin': return 'Tenant Admin';
      case 'tenant_editor': return 'Content Editor';
      case 'tenant_viewer': return 'Viewer';
      default: return 'Workspace User';
    }
  });

  get roleLabel(): string {
    return this.roleLabelSignal();
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('view') === 'chat' || params.get('mode') === 'chat') {
        this.isStandaloneChat = true;
      }
    }
  }

  setSection(sec: NavSection): void {
    if (!canAccessAdminSection(this.state.role(), sec)) {
      this.state.setSection('overview');
      return;
    }
    this.state.setSection(sec);
  }

  refreshWorkspace(): void {
    this.state.refreshAllData();
    this.state.showToast('info', 'Workspace Synchronized', 'All operational records reloaded.');
  }

  openPrimaryAction(): void {
    if (this.state.isPlatformAdmin()) {
      this.state.openCreateOrgDrawer();
    } else if (this.state.canAccessSection('knowledge')) {
      this.state.setSection('knowledge');
      this.state.openUploadModal();
    } else {
      this.state.setSection('chat');
    }
  }

  openCommandPalette(): void {
    this.state.openCommandPalette();
  }
}

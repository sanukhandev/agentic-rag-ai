import { Component, OnInit, ChangeDetectorRef, inject } from '@angular/core';
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
import { IconComponent } from './components/shared/icon.component';
import { BadgeComponent } from './components/shared/badge.component';

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
    IconComponent,
    BadgeComponent
  ],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  readonly state = inject(AdminStateService);
  private readonly cdr = inject(ChangeDetectorRef);

  isAuthenticated = false;
  isStandaloneChat = false;
  currentSection: NavSection = 'overview';
  role = '';
  selectedTenant: Tenant | null = null;

  readonly navTabs: Array<{ id: NavSection; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    { id: 'organizations', label: 'Organizations', icon: 'organizations' },
    { id: 'knowledge', label: 'Knowledge', icon: 'knowledge' },
    { id: 'studio', label: 'AI Studio', icon: 'studio' },
    { id: 'chat', label: 'Customer Chat', icon: 'chat' },
    { id: 'observability', label: 'Observability', icon: 'observability' },
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ];

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('view') === 'chat' || params.get('mode') === 'chat') {
        this.isStandaloneChat = true;
      }
    }
    this.state.isAuthenticated$.subscribe((auth) => {
      this.isAuthenticated = auth;
      this.cdr.markForCheck();
      this.cdr.detectChanges();
    });
    this.state.currentSection$.subscribe((sec) => {
      this.currentSection = sec;
      this.cdr.markForCheck();
    });
    this.state.role$.subscribe((r) => {
      this.role = r;
      this.cdr.markForCheck();
    });
    this.state.selectedTenant$.subscribe((st) => {
      this.selectedTenant = st;
      this.cdr.markForCheck();
    });
  }

  setSection(sec: NavSection): void {
    this.state.setSection(sec);
  }

  refreshWorkspace(): void {
    this.state.refreshAllData();
    this.state.showToast('info', 'Workspace Synchronized', 'All operational records reloaded.');
  }

  openPrimaryAction(): void {
    if (this.role === 'platform_admin') {
      this.state.openCreateOrgDrawer();
    } else {
      this.state.setSection('knowledge');
      this.state.openUploadModal();
    }
  }

  openCommandPalette(): void {
    this.state.openCommandPalette();
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminStateService } from './services/admin-state.service';
import { NavSection, Tenant, Source, IngestionJob, Health, Metrics, Persona, PersonaVersion } from './types/admin.types';
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
import { IconComponent } from './components/shared/icon.component';
import { BadgeComponent } from './components/shared/badge.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
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
    IconComponent,
    BadgeComponent
  ],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnInit {
  readonly state = inject(AdminStateService);

  isAuthenticated = false;
  currentSection: NavSection = 'overview';
  role = '';
  selectedTenant: Tenant | null = null;

  readonly navTabs: Array<{ id: NavSection; label: string; icon: string }> = [
    { id: 'overview', label: 'Overview', icon: 'overview' },
    { id: 'organizations', label: 'Organizations', icon: 'organizations' },
    { id: 'knowledge', label: 'Knowledge', icon: 'knowledge' },
    { id: 'studio', label: 'AI Studio', icon: 'studio' },
    { id: 'observability', label: 'Observability', icon: 'observability' },
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ];

  ngOnInit(): void {
    this.state.isAuthenticated$.subscribe((auth) => (this.isAuthenticated = auth));
    this.state.currentSection$.subscribe((sec) => (this.currentSection = sec));
    this.state.role$.subscribe((r) => (this.role = r));
    this.state.selectedTenant$.subscribe((st) => (this.selectedTenant = st));
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

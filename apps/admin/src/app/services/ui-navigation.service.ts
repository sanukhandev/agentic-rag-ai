import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { NavSection } from '../types/admin.types';

const NAV_SECTION_STORAGE_KEY = 'agentic-rag-admin-section';
const NAV_SECTIONS: readonly NavSection[] = [
  'overview',
  'organizations',
  'knowledge',
  'catalog',
  'studio',
  'chat',
  'crm',
  'observability',
  'settings'
];

export function isNavSection(value: string | null): value is NavSection {
  return value !== null && NAV_SECTIONS.includes(value as NavSection);
}

function readStoredSection(): NavSection {
  if (typeof window === 'undefined') return 'overview';
  try {
    const storedSection = window.sessionStorage.getItem(NAV_SECTION_STORAGE_KEY);
    return isNavSection(storedSection) ? storedSection : 'overview';
  } catch {
    return 'overview';
  }
}

@Injectable({
  providedIn: 'root'
})
export class UiNavigationService {
  private readonly _currentSection = signal<NavSection>(readStoredSection());
  private readonly _activeMegaMenu = signal<NavSection | null>(null);
  private readonly _commandPaletteOpen = signal<boolean>(false);
  private readonly _createOrgDrawerOpen = signal<boolean>(false);
  private readonly _uploadSourceModalOpen = signal<boolean>(false);

  // Angular Signals (Primary reactive state)
  readonly currentSection = this._currentSection.asReadonly();
  readonly activeMegaMenu = this._activeMegaMenu.asReadonly();
  readonly commandPaletteOpen = this._commandPaletteOpen.asReadonly();
  readonly createOrgDrawerOpen = this._createOrgDrawerOpen.asReadonly();
  readonly uploadSourceModalOpen = this._uploadSourceModalOpen.asReadonly();

  // Observable streams for backwards compatibility
  private readonly currentSectionSubject = new BehaviorSubject<NavSection>(this._currentSection());
  private readonly activeMegaMenuSubject = new BehaviorSubject<NavSection | null>(null);
  private readonly commandPaletteOpenSubject = new BehaviorSubject<boolean>(false);
  private readonly createOrgDrawerOpenSubject = new BehaviorSubject<boolean>(false);
  private readonly uploadSourceModalOpenSubject = new BehaviorSubject<boolean>(false);

  readonly currentSection$: Observable<NavSection> = this.currentSectionSubject.asObservable();
  readonly activeMegaMenu$: Observable<NavSection | null> = this.activeMegaMenuSubject.asObservable();
  readonly commandPaletteOpen$: Observable<boolean> = this.commandPaletteOpenSubject.asObservable();
  readonly createOrgDrawerOpen$: Observable<boolean> = this.createOrgDrawerOpenSubject.asObservable();
  readonly uploadSourceModalOpen$: Observable<boolean> = this.uploadSourceModalOpenSubject.asObservable();

  setSection(section: NavSection): void {
    this._currentSection.set(section);
    this.currentSectionSubject.next(section);
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(NAV_SECTION_STORAGE_KEY, section);
      } catch {
        // Session storage can be unavailable in privacy-restricted browsers.
      }
    }
    this.closeMegaMenu();
  }

  toggleMegaMenu(section: NavSection): void {
    const next = this._activeMegaMenu() === section ? null : section;
    this._activeMegaMenu.set(next);
    this.activeMegaMenuSubject.next(next);
  }

  closeMegaMenu(): void {
    this._activeMegaMenu.set(null);
    this.activeMegaMenuSubject.next(null);
  }

  openCommandPalette(): void {
    this._commandPaletteOpen.set(true);
    this.commandPaletteOpenSubject.next(true);
  }

  closeCommandPalette(): void {
    this._commandPaletteOpen.set(false);
    this.commandPaletteOpenSubject.next(false);
  }

  openCreateOrgDrawer(): void {
    this._createOrgDrawerOpen.set(true);
    this.createOrgDrawerOpenSubject.next(true);
  }

  closeCreateOrgDrawer(): void {
    this._createOrgDrawerOpen.set(false);
    this.createOrgDrawerOpenSubject.next(false);
  }

  openUploadModal(): void {
    this._uploadSourceModalOpen.set(true);
    this.uploadSourceModalOpenSubject.next(true);
  }

  closeUploadModal(): void {
    this._uploadSourceModalOpen.set(false);
    this.uploadSourceModalOpenSubject.next(false);
  }
}

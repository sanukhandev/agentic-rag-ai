import { Injectable } from '@angular/core';
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
  private readonly currentSectionSubject = new BehaviorSubject<NavSection>(readStoredSection());
  private readonly activeMegaMenuSubject = new BehaviorSubject<NavSection | null>(null);
  private readonly commandPaletteOpenSubject = new BehaviorSubject<boolean>(false);
  private readonly createOrgDrawerOpenSubject = new BehaviorSubject<boolean>(false);
  private readonly uploadSourceModalOpenSubject = new BehaviorSubject<boolean>(false);

  readonly currentSection$: Observable<NavSection> = this.currentSectionSubject.asObservable();
  readonly activeMegaMenu$: Observable<NavSection | null> = this.activeMegaMenuSubject.asObservable();
  readonly commandPaletteOpen$: Observable<boolean> = this.commandPaletteOpenSubject.asObservable();
  readonly createOrgDrawerOpen$: Observable<boolean> = this.createOrgDrawerOpenSubject.asObservable();
  readonly uploadSourceModalOpen$: Observable<boolean> = this.uploadSourceModalOpenSubject.asObservable();

  get currentSection(): NavSection {
    return this.currentSectionSubject.value;
  }

  get activeMegaMenu(): NavSection | null {
    return this.activeMegaMenuSubject.value;
  }

  setSection(section: NavSection): void {
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
    const current = this.activeMegaMenuSubject.value;
    this.activeMegaMenuSubject.next(current === section ? null : section);
  }

  closeMegaMenu(): void {
    this.activeMegaMenuSubject.next(null);
  }

  openCommandPalette(): void {
    this.commandPaletteOpenSubject.next(true);
  }

  closeCommandPalette(): void {
    this.commandPaletteOpenSubject.next(false);
  }

  openCreateOrgDrawer(): void {
    this.createOrgDrawerOpenSubject.next(true);
  }

  closeCreateOrgDrawer(): void {
    this.createOrgDrawerOpenSubject.next(false);
  }

  openUploadModal(): void {
    this.uploadSourceModalOpenSubject.next(true);
  }

  closeUploadModal(): void {
    this.uploadSourceModalOpenSubject.next(false);
  }
}

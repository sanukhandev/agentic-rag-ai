import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { NavSection } from '../types/admin.types';

@Injectable({
  providedIn: 'root'
})
export class UiNavigationService {
  private readonly currentSectionSubject = new BehaviorSubject<NavSection>('overview');
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

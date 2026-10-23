import { Injectable, signal } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private readonly _toasts = signal<ToastMessage[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private readonly toastsSubject = new BehaviorSubject<ToastMessage[]>([]);
  readonly toasts$: Observable<ToastMessage[]> = this.toastsSubject.asObservable();

  show(type: 'info' | 'success' | 'warning' | 'error', title: string, message?: string): void {
    const toast: ToastMessage = {
      id: Math.random().toString(36).substring(2, 9),
      type,
      title,
      message,
      timestamp: Date.now()
    };
    const nextVal = [toast, ...this._toasts().slice(0, 4)];
    this._toasts.set(nextVal);
    this.toastsSubject.next(nextVal);
    setTimeout(() => this.dismiss(toast.id), 5000);
  }

  dismiss(id: string): void {
    const nextVal = this._toasts().filter((t) => t.id !== id);
    this._toasts.set(nextVal);
    this.toastsSubject.next(nextVal);
  }

  clearAll(): void {
    this._toasts.set([]);
    this.toastsSubject.next([]);
  }
}

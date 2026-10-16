import { Injectable } from '@angular/core';
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
    this.toastsSubject.next([toast, ...this.toastsSubject.value.slice(0, 4)]);
    setTimeout(() => this.dismiss(toast.id), 5000);
  }

  dismiss(id: string): void {
    this.toastsSubject.next(this.toastsSubject.value.filter((t) => t.id !== id));
  }

  clearAll(): void {
    this.toastsSubject.next([]);
  }
}

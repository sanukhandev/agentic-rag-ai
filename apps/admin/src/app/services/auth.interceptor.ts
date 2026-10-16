import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  return next(req).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // Do not intercept invalid credentials error during login attempt
        if (!req.url.includes('/api/v1/auth/login')) {
          auth.handleUnauthorized();
        }
      }
      return throwError(() => error);
    })
  );
};

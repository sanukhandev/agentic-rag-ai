import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);

  let modifiedReq = req;
  const isApiRequest = req.url.includes('/api/v1/');
  const isPublicAuth = req.url.includes('/api/v1/auth/login');

  if (isApiRequest && !isPublicAuth) {
    let headers = req.headers;
    const token = auth.token();
    if (token && !headers.has('Authorization')) {
      headers = headers.set('Authorization', `Bearer ${token}`);
    }
    if (auth.selectedTenantId && !headers.has('X-Tenant-Id')) {
      headers = headers.set('X-Tenant-Id', auth.selectedTenantId);
    }
    modifiedReq = req.clone({ headers });
  }

  return next(modifiedReq).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        // Do not intercept invalid credentials error during login attempt
        if (!isPublicAuth) {
          auth.handleUnauthorized();
        }
      }
      return throwError(() => error);
    })
  );
};

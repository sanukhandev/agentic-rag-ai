import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { API_BASE_URL } from './tokens';

export function isTrustedApiRequest(url: string, apiBaseUrl: string): { isApiRequest: boolean; isPublicAuth: boolean } {
  try {
    const base = apiBaseUrl.endsWith('/') ? apiBaseUrl : `${apiBaseUrl}/`;
    const resolved = new URL(url, base);
    const trusted = new URL(base);
    if (resolved.origin !== trusted.origin) {
      return { isApiRequest: false, isPublicAuth: false };
    }
    const isApi = resolved.pathname.startsWith('/api/v1/');
    const isLogin = resolved.pathname === '/api/v1/auth/login';
    return { isApiRequest: isApi, isPublicAuth: isLogin };
  } catch {
    return { isApiRequest: false, isPublicAuth: false };
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const apiBase = inject(API_BASE_URL);

  const { isApiRequest, isPublicAuth } = isTrustedApiRequest(req.url, apiBase);
  let modifiedReq = req;

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
      if (error instanceof HttpErrorResponse && error.status === 401 && isApiRequest && !isPublicAuth) {
        auth.handleUnauthorized();
      }
      return throwError(() => error);
    })
  );
};

export const apiErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error !== 'object' || error === null) return fallback;
  const response = error as { message?: unknown; error?: unknown };
  if (typeof response.message === 'string' && response.message.trim()) return response.message;
  if (typeof response.error === 'string' && response.error.trim()) return response.error;
  if (typeof response.error === 'object' && response.error !== null) {
    const body = response.error as { message?: unknown; error?: { message?: unknown } };
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
    if (typeof body.error?.message === 'string' && body.error.message.trim()) return body.error.message;
  }
  return fallback;
};

import { z } from 'zod';

export class HttpError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(422, 'VALIDATION_ERROR', result.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`).join(' '));
  return result.data;
};

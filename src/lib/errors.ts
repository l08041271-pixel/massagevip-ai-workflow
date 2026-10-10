import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class AppError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(message: string, status = 400, code = 'bad_request', details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Unauthorized = (m = 'Authentication required') => new AppError(m, 401, 'unauthorized');
export const Forbidden = (m = 'You do not have access to this resource') => new AppError(m, 403, 'forbidden');
export const NotFound = (m = 'Resource not found') => new AppError(m, 404, 'not_found');
export const RateLimited = (m = 'Too many requests') => new AppError(m, 429, 'rate_limited');

export function errorResponse(err: unknown) {
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'Invalid input', details: err.flatten() } },
      { status: 422 },
    );
  }
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  // Never leak internal error details or secrets to the client.
  console.error('[unhandled]', err);
  return NextResponse.json(
    { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } },
    { status: 500 },
  );
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export type AppErrorCode =
  | 'missing-sync-settings'
  | 'github-api-error'
  | 'gist-file-not-found'
  | 'invalid-sync-document'
  | 'chrome-tabs-error'
  | 'no-eligible-tabs'
  | 'session-not-found'
  | 'empty-session'
  | 'unknown-error';

export type AppError = {
  code: AppErrorCode;
  message: string;
};

export type AppResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export function ok<T>(data: T): AppResult<T> {
  return { ok: true, data };
}

export function err<T = never>(code: AppErrorCode, message: string): AppResult<T> {
  return { ok: false, error: { code, message } };
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'An unexpected error occurred.';
}

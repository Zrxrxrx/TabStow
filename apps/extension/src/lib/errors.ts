export type AppErrorCode =
  | 'missing-sync-settings'
  | 'github-api-error'
  | 'gist-file-not-found'
  | 'invalid-sync-document'
  | 'chrome-tabs-error'
  | 'no-eligible-tabs'
  | 'session-not-found'
  | 'saved-tab-not-found'
  | 'history-entry-not-found'
  | 'invalid-tab-url'
  | 'invalid-saved-move'
  | 'operation-in-progress'
  | 'empty-session'
  | 'automatic-sleep-unavailable'
  | 'invalid-tab-lifecycle-policy'
  | 'invalid-stow-suggestions'
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

export function toKnownStorageError(error: unknown): AppResult<never> | null {
  const message = toErrorMessage(error);
  if (message.startsWith('Session not found:')) {
    return err('session-not-found', 'Saved window was not found.');
  }
  if (message.startsWith('Saved tab not found:')) {
    return err('saved-tab-not-found', 'Saved tab was not found.');
  }
  if (message.startsWith('History entry not found:')) {
    return err('history-entry-not-found', 'History entry was not found.');
  }
  if (message.startsWith('Invalid destination index:')) {
    return err('invalid-saved-move', 'Saved tab move request is invalid.');
  }
  return null;
}

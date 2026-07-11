import { describe, expect, it } from 'vitest';
import { toKnownStorageError } from './errors';

describe('toKnownStorageError', () => {
  it.each([
    [
      'Session not found: session-1',
      'session-not-found',
      'Saved session was not found.',
    ],
    [
      'Saved tab not found: tab-1',
      'saved-tab-not-found',
      'Saved tab was not found.',
    ],
    [
      'History entry not found: history-1',
      'history-entry-not-found',
      'History entry was not found.',
    ],
    [
      'Invalid destination index: 4',
      'invalid-saved-move',
      'Saved tab move request is invalid.',
    ],
  ] as const)('maps %s to %s', (message, code, appMessage) => {
    expect(toKnownStorageError(new Error(message))).toEqual({
      ok: false,
      error: { code, message: appMessage },
    });
  });

  it('returns null so callers can choose the unknown-error fallback', () => {
    expect(toKnownStorageError(new Error('storage unavailable'))).toBeNull();
  });
});

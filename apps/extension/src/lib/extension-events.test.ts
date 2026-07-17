import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  runtime: {
    sendMessage: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({ browser: browserMocks }));

import {
  broadcastExtensionEvent,
  isSavedDataInvalidationEvent,
} from './extension-events';

describe('extension events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recognizes local and synchronized Saved data invalidations', () => {
    expect(isSavedDataInvalidationEvent({ type: 'saved-data:changed' })).toBe(true);
    expect(isSavedDataInvalidationEvent({ type: 'sync:data-changed' })).toBe(true);
    expect(isSavedDataInvalidationEvent({ type: 'sync:status-changed' })).toBe(false);
    expect(isSavedDataInvalidationEvent(null)).toBe(false);
  });

  it('broadcasts typed events without failing when no page is listening', async () => {
    browserMocks.runtime.sendMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Receiving end does not exist'));

    await expect(
      broadcastExtensionEvent({ type: 'saved-data:changed' }),
    ).resolves.toBeUndefined();
    await expect(
      broadcastExtensionEvent({ type: 'saved-data:changed' }),
    ).resolves.toBeUndefined();

    expect(browserMocks.runtime.sendMessage).toHaveBeenCalledTimes(2);
  });
});

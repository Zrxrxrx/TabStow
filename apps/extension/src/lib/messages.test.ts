import { describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  runtime: {
    sendMessage: vi.fn(),
  },
}));

vi.mock('./browser', () => ({
  browser: browserMocks,
}));

import { sendExtensionMessage } from './messages';

describe('sendExtensionMessage', () => {
  it('converts transport failures into typed app errors', async () => {
    browserMocks.runtime.sendMessage.mockRejectedValue(new Error('No receiver'));

    await expect(
      sendExtensionMessage({ type: 'sessions:list' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'unknown-error',
        message: 'No receiver',
      },
    });
  });

  it('converts missing background responses into typed app errors', async () => {
    browserMocks.runtime.sendMessage.mockResolvedValue(null);

    await expect(
      sendExtensionMessage({ type: 'sessions:list' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'unknown-error',
        message: 'Extension background did not return a valid response. Reload Tabstow from chrome://extensions and try again.',
      },
    });
  });

  it('returns semantic tab move responses unchanged', async () => {
    const request = {
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' as const },
        position: { kind: 'end' as const },
      },
    };
    const response = { ok: true as const, data: { moved: false } };
    browserMocks.runtime.sendMessage.mockResolvedValue(response);

    await expect(
      sendExtensionMessage({ type: 'active-tabs:move-tab', request }),
    ).resolves.toBe(response);
  });
});

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
});

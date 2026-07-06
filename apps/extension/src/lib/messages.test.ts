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
});

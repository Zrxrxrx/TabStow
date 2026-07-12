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

  it('returns stow preview responses unchanged', async () => {
    const response = { ok: true as const, data: { eligibleTabCount: 4 } };
    browserMocks.runtime.sendMessage.mockResolvedValue(response);

    await expect(
      sendExtensionMessage({ type: 'sessions:stow-current-window-preview' }),
    ).resolves.toBe(response);
  });

  it('returns saved tab move responses unchanged', async () => {
    const request = {
      sourceSessionId: 'session-1',
      tabId: 'tab-1',
      destinationSessionId: 'session-2',
      destinationIndex: 0,
    };
    const response = { ok: true as const, data: { moved: true as const } };
    browserMocks.runtime.sendMessage.mockResolvedValue(response);

    await expect(
      sendExtensionMessage({ type: 'sessions:move-tab', request }),
    ).resolves.toBe(response);
    expect(browserMocks.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'sessions:move-tab',
      request,
    });
  });

  it('returns History restore responses unchanged', async () => {
    const response = {
      ok: true as const,
      data: {
        id: 'restored-session',
        title: 'Restored',
        tabs: [],
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z',
        deviceId: 'device-1',
      },
    };
    browserMocks.runtime.sendMessage.mockResolvedValue(response);

    await expect(
      sendExtensionMessage({ type: 'history:restore', historyId: 'history-1' }),
    ).resolves.toBe(response);
    expect(browserMocks.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'history:restore',
      historyId: 'history-1',
    });
  });
});

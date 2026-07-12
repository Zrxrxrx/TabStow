import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  contextMenus: {
    create: vi.fn(),
    removeAll: vi.fn(),
    onClicked: {
      addListener: vi.fn(),
    },
  },
}));

const sessionServiceMocks = vi.hoisted(() => ({
  saveCurrentWindowAsSession: vi.fn(),
}));

const coordinatorMocks = vi.hoisted(() => ({
  noteSynchronizedMutation: vi.fn(),
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

vi.mock('@/features/tabs/session-service', () => sessionServiceMocks);
vi.mock('@/features/sync/sync-coordinator', () => coordinatorMocks);

import { registerContextMenuClickHandler } from './context-menu';

describe('context menu click handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coordinatorMocks.noteSynchronizedMutation.mockResolvedValue(undefined);
    sessionServiceMocks.saveCurrentWindowAsSession.mockResolvedValue({
      ok: true,
      data: { session: null, savedTabCount: 1, closedTabCount: 1 },
    });
  });

  it('passes the clicked tab window id to the stow service', async () => {
    registerContextMenuClickHandler();

    const listener = browserMocks.contextMenus.onClicked.addListener.mock.calls[0]?.[0];
    await listener?.(
      { menuItemId: 'tabstow-stow-current-window' },
      { windowId: 77 } as chrome.tabs.Tab,
    );

    expect(sessionServiceMocks.saveCurrentWindowAsSession).toHaveBeenCalledWith(77);
    expect(coordinatorMocks.noteSynchronizedMutation).toHaveBeenCalledTimes(1);
  });

  it('keeps a successful stow independent from sync scheduling failures', async () => {
    coordinatorMocks.noteSynchronizedMutation.mockRejectedValueOnce(
      new Error('alarms unavailable'),
    );
    registerContextMenuClickHandler();

    const listener = browserMocks.contextMenus.onClicked.addListener.mock.calls[0]?.[0];
    await expect(
      listener?.(
        { menuItemId: 'tabstow-stow-current-window' },
        { windowId: 77 } as chrome.tabs.Tab,
      ),
    ).resolves.toBeUndefined();
  });
});

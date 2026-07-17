import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  runtime: {
    sendMessage: vi.fn(),
  },
  i18n: {
    getUILanguage: vi.fn(() => 'en-US'),
  },
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

import { registerContextMenu, registerContextMenuClickHandler } from './context-menu';

describe('context menu registration', () => {
  it('uses the product Stow window vocabulary', async () => {
    await registerContextMenu();

    expect(browserMocks.contextMenus.create).toHaveBeenCalledWith({
      id: 'tabstow-stow-current-window',
      title: 'Stow window',
      contexts: ['page'],
    });
  });

  it('uses the Chinese product vocabulary in a Chinese Chrome UI', async () => {
    browserMocks.i18n.getUILanguage.mockReturnValueOnce('zh-CN');

    await registerContextMenu();

    expect(browserMocks.contextMenus.create).toHaveBeenCalledWith({
      id: 'tabstow-stow-current-window',
      title: '收起窗口',
      contexts: ['page'],
    });
  });
});

describe('context menu click handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserMocks.runtime.sendMessage.mockResolvedValue(undefined);
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
    expect(browserMocks.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'saved-data:changed',
    });
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

  it('keeps a successful stow independent from event delivery failures', async () => {
    browserMocks.runtime.sendMessage.mockRejectedValueOnce(
      new Error('Receiving end does not exist'),
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

  it('does not broadcast when the context-menu stow fails', async () => {
    sessionServiceMocks.saveCurrentWindowAsSession.mockResolvedValueOnce({
      ok: false,
      error: { code: 'no-eligible-tabs', message: 'No eligible tabs were found.' },
    });
    registerContextMenuClickHandler();

    const listener = browserMocks.contextMenus.onClicked.addListener.mock.calls[0]?.[0];
    await listener?.(
      { menuItemId: 'tabstow-stow-current-window' },
      { windowId: 77 } as chrome.tabs.Tab,
    );

    expect(browserMocks.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

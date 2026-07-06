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

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

vi.mock('@/features/tabs/session-service', () => sessionServiceMocks);

import { registerContextMenuClickHandler } from './context-menu';

describe('context menu click handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes the clicked tab window id to the stow service', async () => {
    registerContextMenuClickHandler();

    const listener = browserMocks.contextMenus.onClicked.addListener.mock.calls[0]?.[0];
    await listener?.(
      { menuItemId: 'tabstow-stow-current-window' },
      { windowId: 77 } as chrome.tabs.Tab,
    );

    expect(sessionServiceMocks.saveCurrentWindowAsSession).toHaveBeenCalledWith(77);
  });
});

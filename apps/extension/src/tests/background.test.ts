import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  runtime: {
    onInstalled: {
      addListener: vi.fn(),
    },
    onStartup: {
      addListener: vi.fn(),
    },
    onMessage: {
      addListener: vi.fn(),
    },
  },
}));

const contextMenuMocks = vi.hoisted(() => ({
  registerContextMenu: vi.fn(),
  registerContextMenuClickHandler: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  deleteSession: vi.fn(),
  listSessions: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const syncMocks = vi.hoisted(() => ({
  pullFromGist: vi.fn(),
  pushToGist: vi.fn(),
}));

const sessionServiceMocks = vi.hoisted(() => ({
  restoreSession: vi.fn(),
  saveCurrentWindowAsSession: vi.fn(),
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

vi.mock('@/features/context-menu/context-menu', () => contextMenuMocks);
vi.mock('@/db/db', () => dbMocks);
vi.mock('@/features/settings/settings-storage', () => settingsMocks);
vi.mock('@/features/sync/sync-service', () => syncMocks);
vi.mock('@/features/tabs/session-service', () => sessionServiceMocks);

describe('background message routing', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    (
      globalThis as typeof globalThis & {
        defineBackground?: (callback: () => void) => void;
      }
    ).defineBackground = (callback) => {
      callback();
    };
  });

  it('passes sender window id to the stow-current-window handler', async () => {
    sessionServiceMocks.saveCurrentWindowAsSession.mockResolvedValue({
      ok: true,
      data: { session: null, savedTabCount: 0, closedTabCount: 0 },
    });

    await import('../entrypoints/background');

    const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
    await listener?.(
      { type: 'sessions:stow-current-window' },
      { tab: { windowId: 91 } } as chrome.runtime.MessageSender,
    );

    expect(sessionServiceMocks.saveCurrentWindowAsSession).toHaveBeenCalledWith(91);
  });
});

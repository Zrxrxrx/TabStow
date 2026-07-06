import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  action: {
    onClicked: {
      addListener: vi.fn(),
    },
    setBadgeBackgroundColor: vi.fn(),
    setBadgeText: vi.fn(),
    setTitle: vi.fn(),
  },
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

const actionFeedbackMocks = vi.hoisted(() => ({
  showActionFeedback: vi.fn(),
}));

const sessionServiceMocks = vi.hoisted(() => ({
  restoreSession: vi.fn(),
  saveCurrentWindowAsSession: vi.fn(),
}));

const activeTabsMocks = vi.hoisted(() => ({
  closeActiveTabs: vi.fn(),
  focusActiveTab: vi.fn(),
  listActiveTabs: vi.fn(),
  runDefaultSearch: vi.fn(),
}));

const chromeTabGroupMocks = vi.hoisted(() => ({
  collapseChromeTabGroups: vi.fn(),
  importChromeTabGroups: vi.fn(),
  syncChromeTabGroups: vi.fn(),
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

vi.mock('@/features/action-feedback/action-feedback', () => actionFeedbackMocks);
vi.mock('@/features/context-menu/context-menu', () => contextMenuMocks);
vi.mock('@/db/db', () => dbMocks);
vi.mock('@/features/settings/settings-storage', () => settingsMocks);
vi.mock('@/features/sync/sync-service', () => syncMocks);
vi.mock('@/features/tabs/session-service', () => sessionServiceMocks);
vi.mock('@/features/active-tabs/active-tabs-service', () => activeTabsMocks);
vi.mock('@/features/chrome-tab-groups/chrome-tab-groups', () => chromeTabGroupMocks);

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

  it('registers toolbar action click handling', async () => {
    await import('../entrypoints/background');

    expect(browserMocks.action.onClicked.addListener).toHaveBeenCalledTimes(1);
  });

  it('stows the clicked tab window from the toolbar action', async () => {
    const result = {
      ok: true,
      data: { session: null, savedTabCount: 3, closedTabCount: 3 },
    };
    sessionServiceMocks.saveCurrentWindowAsSession.mockResolvedValue(result);

    await import('../entrypoints/background');

    const listener = browserMocks.action.onClicked.addListener.mock.calls[0]?.[0];
    await listener?.({ windowId: 41 } as chrome.tabs.Tab);

    expect(sessionServiceMocks.saveCurrentWindowAsSession).toHaveBeenCalledWith(41);
    expect(actionFeedbackMocks.showActionFeedback).toHaveBeenCalledWith(result);
  });

  it('falls back to the last focused window when toolbar tab has no window id', async () => {
    sessionServiceMocks.saveCurrentWindowAsSession.mockResolvedValue({
      ok: false,
      error: {
        code: 'no-eligible-tabs',
        message: 'No eligible tabs were found in the current window.',
      },
    });

    await import('../entrypoints/background');

    const listener = browserMocks.action.onClicked.addListener.mock.calls[0]?.[0];
    await listener?.({} as chrome.tabs.Tab);

    expect(sessionServiceMocks.saveCurrentWindowAsSession).toHaveBeenCalledWith(undefined);
  });

  it('routes active tab close messages', async () => {
    activeTabsMocks.closeActiveTabs.mockResolvedValue({
      ok: true,
      data: { closed: true, tabCount: 2 },
    });

    await import('../entrypoints/background');

    const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
    await listener?.({ type: 'active-tabs:close', tabIds: [11, 12] }, {});

    expect(activeTabsMocks.closeActiveTabs).toHaveBeenCalledWith([11, 12]);
  });

  it('routes chrome tab group sync messages', async () => {
    chromeTabGroupMocks.syncChromeTabGroups.mockResolvedValue({
      ok: true,
      data: { enabled: true, mappings: [] },
    });

    await import('../entrypoints/background');

    const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
    await listener?.({
      type: 'chrome-tab-groups:sync',
      groups: [],
      state: { enabled: true, mappings: [] },
    }, {});

    expect(chromeTabGroupMocks.syncChromeTabGroups).toHaveBeenCalledWith([], { enabled: true, mappings: [] });
  });

  it('routes chrome tab group import messages', async () => {
    chromeTabGroupMocks.importChromeTabGroups.mockResolvedValue({
      ok: true,
      data: {
        manualGroups: { groups: [], assignments: {} },
        chromeTabGroups: { enabled: true, mappings: [] },
      },
    });

    await import('../entrypoints/background');

    const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const payload = {
      tabs: [],
      manualGroups: { groups: [], assignments: {} },
      state: { enabled: true, mappings: [] },
    };
    await listener?.({ type: 'chrome-tab-groups:import', ...payload }, {});

    expect(chromeTabGroupMocks.importChromeTabGroups).toHaveBeenCalledWith(
      payload.tabs,
      payload.manualGroups,
      payload.state,
    );
  });

  it('routes chrome tab group collapse messages', async () => {
    chromeTabGroupMocks.collapseChromeTabGroups.mockResolvedValue({
      ok: true,
      data: { collapsed: true, groupCount: 2 },
    });

    await import('../entrypoints/background');

    const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
    await listener?.({ type: 'chrome-tab-groups:collapse-window', windowId: 17 }, {});

    expect(chromeTabGroupMocks.collapseChromeTabGroups).toHaveBeenCalledWith(17);
  });
});

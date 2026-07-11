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
  deleteHistoryEntry: vi.fn(),
  listHistory: vi.fn(),
  listSessions: vi.fn(),
  moveSavedTab: vi.fn(),
  moveSavedTabToHistory: vi.fn(),
  moveSessionToHistory: vi.fn(),
  reorderSessions: vi.fn(),
  restoreHistoryEntry: vi.fn(),
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
  openHistoryTab: vi.fn(),
  openSavedTab: vi.fn(),
  restoreSession: vi.fn(),
  saveCurrentWindowAsSession: vi.fn(),
  saveTabsAsSession: vi.fn(),
}));

const activeTabsMocks = vi.hoisted(() => ({
  closeActiveTabs: vi.fn(),
  focusActiveTab: vi.fn(),
  listActiveTabs: vi.fn(),
  listActiveTabsSnapshot: vi.fn(),
  moveActiveTab: vi.fn(),
  moveActiveTabGroup: vi.fn(),
  runDefaultSearch: vi.fn(),
}));

const chromeTabGroupMocks = vi.hoisted(() => ({
  collapseChromeTabGroups: vi.fn(),
}));

const quickLinkMocks = vi.hoisted(() => ({
  reorderQuickLinks: vi.fn(),
  updateQuickLink: vi.fn(),
  updateQuickLinks: vi.fn(),
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
vi.mock('@/features/active-tabs/active-tab-moves', () => ({
  moveActiveTab: activeTabsMocks.moveActiveTab,
  moveActiveTabGroup: activeTabsMocks.moveActiveTabGroup,
}));
vi.mock('@/features/chrome-tab-groups/chrome-tab-groups', () => chromeTabGroupMocks);
vi.mock('@/features/quick-links/quick-links', () => ({
  reorderQuickLinks: quickLinkMocks.reorderQuickLinks,
  updateQuickLink: quickLinkMocks.updateQuickLink,
}));
vi.mock('@/features/quick-links/quick-links-storage', () => ({
  updateQuickLinks: quickLinkMocks.updateQuickLinks,
}));

async function dispatchRuntimeMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender = {},
): Promise<{ keepAlive: unknown; response: unknown }> {
  const listener = browserMocks.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const sendResponse = vi.fn();
  const keepAlive = listener?.(message, sender, sendResponse);

  for (let attempts = 0; attempts < 5 && sendResponse.mock.calls.length === 0; attempts += 1) {
    await Promise.resolve();
  }

  return { keepAlive, response: sendResponse.mock.calls[0]?.[0] };
}

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

    const { keepAlive } = await dispatchRuntimeMessage(
      { type: 'sessions:stow-current-window' },
      { tab: { windowId: 91 } } as chrome.runtime.MessageSender,
    );

    expect(keepAlive).toBe(true);
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

    await dispatchRuntimeMessage({ type: 'active-tabs:close', tabIds: [11, 12] });

    expect(activeTabsMocks.closeActiveTabs).toHaveBeenCalledWith([11, 12]);
  });

  it('routes semantic tab move messages', async () => {
    const request = {
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' as const },
        position: { kind: 'end' as const },
      },
    };
    activeTabsMocks.moveActiveTab.mockResolvedValue({ ok: true, data: { moved: false } });

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({ type: 'active-tabs:move-tab', request });

    expect(activeTabsMocks.moveActiveTab).toHaveBeenCalledWith(request);
    expect(response).toEqual({ ok: true, data: { moved: false } });
  });

  it('routes semantic group move messages', async () => {
    const request = {
      groupId: 31,
      sourceWindowId: 2,
      destination: { windowId: 3, position: { kind: 'end' as const } },
    };
    activeTabsMocks.moveActiveTabGroup.mockResolvedValue({ ok: true, data: { moved: true } });

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({ type: 'active-tabs:move-group', request });

    expect(activeTabsMocks.moveActiveTabGroup).toHaveBeenCalledWith(request);
    expect(response).toEqual({ ok: true, data: { moved: true } });
  });

  it('responds to active tab snapshot messages through sendResponse', async () => {
    activeTabsMocks.listActiveTabsSnapshot.mockResolvedValue({
      ok: true,
      data: {
        windows: [{ id: 2, focused: true, incognito: false, type: 'normal' }],
        tabs: [{ id: 3, windowId: 2, index: 0, url: 'https://example.com' }],
        chromeGroups: [],
      },
    });

    await import('../entrypoints/background');

    const { keepAlive, response } = await dispatchRuntimeMessage({ type: 'active-tabs:snapshot' });

    expect(keepAlive).toBe(true);
    expect(activeTabsMocks.listActiveTabsSnapshot).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      ok: true,
      data: {
        windows: [{ id: 2, focused: true, incognito: false, type: 'normal' }],
        tabs: [{ id: 3, windowId: 2, index: 0, url: 'https://example.com' }],
        chromeGroups: [],
      },
    });
  });

  it('responds to unsupported messages instead of returning null', async () => {
    await import('../entrypoints/background');

    const { keepAlive, response } = await dispatchRuntimeMessage({ type: 'unknown:message' });

    expect(keepAlive).toBe(true);
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'unknown-error',
        message: 'Unsupported extension message: unknown:message.',
      },
    });
  });

  it('routes selected tab stow messages', async () => {
    sessionServiceMocks.saveTabsAsSession.mockResolvedValue({
      ok: true,
      data: { session: null, savedTabCount: 1, closedTabCount: 1 },
    });

    await import('../entrypoints/background');

    await dispatchRuntimeMessage({ type: 'sessions:stow-tab', tabId: 42 });

    expect(sessionServiceMocks.saveTabsAsSession).toHaveBeenCalledWith([42]);
  });

  it('routes saved tab open messages with exact IDs and consume intent', async () => {
    const result = { ok: true, data: { opened: true, consumed: true } };
    sessionServiceMocks.openSavedTab.mockResolvedValue(result);

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'sessions:open-tab',
      sessionId: 'session-1',
      tabId: 'tab-2',
      consume: true,
    });

    expect(sessionServiceMocks.openSavedTab).toHaveBeenCalledWith(
      'session-1',
      'tab-2',
      true,
    );
    expect(response).toBe(result);
  });

  it('rejects string saved tab consume flags before calling the service', async () => {
    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'sessions:open-tab',
      sessionId: 'session-1',
      tabId: 'tab-2',
      consume: 'false',
    });

    expect(sessionServiceMocks.openSavedTab).not.toHaveBeenCalled();
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'unknown-error',
        message: 'Invalid sessions:open-tab message.',
      },
    });
  });

  it('rejects missing saved tab open IDs before calling the service', async () => {
    await import('../entrypoints/background');

    const missingSession = await dispatchRuntimeMessage({
      type: 'sessions:open-tab',
      sessionId: '',
      tabId: 'tab-2',
      consume: true,
    });
    const missingTab = await dispatchRuntimeMessage({
      type: 'sessions:open-tab',
      sessionId: 'session-1',
      tabId: '',
      consume: true,
    });

    expect(sessionServiceMocks.openSavedTab).not.toHaveBeenCalled();
    expect(missingSession.response).toEqual({
      ok: false,
      error: {
        code: 'session-not-found',
        message: 'Saved session was not found.',
      },
    });
    expect(missingTab.response).toEqual({
      ok: false,
      error: {
        code: 'saved-tab-not-found',
        message: 'Saved tab was not found.',
      },
    });
  });

  it('rejects malformed saved session restore IDs before calling the service', async () => {
    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'sessions:restore',
      sessionId: 7,
    });

    expect(sessionServiceMocks.restoreSession).not.toHaveBeenCalled();
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'session-not-found',
        message: 'Saved session was not found.',
      },
    });
  });

  it('routes saved session restore messages with exact IDs', async () => {
    const result = { ok: true, data: { restored: true, tabCount: 2 } };
    sessionServiceMocks.restoreSession.mockResolvedValue(result);

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'sessions:restore',
      sessionId: 'session-1',
    });

    expect(sessionServiceMocks.restoreSession).toHaveBeenCalledWith('session-1');
    expect(response).toBe(result);
  });

  it('routes saved tab delete messages into History', async () => {
    dbMocks.moveSavedTabToHistory.mockResolvedValue({ id: 'history-1' });

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'sessions:delete-tab',
      sessionId: 'session-1',
      tabId: 'tab-2',
    });

    expect(dbMocks.moveSavedTabToHistory).toHaveBeenCalledWith(
      'session-1',
      'tab-2',
      'deleted',
    );
    expect(response).toEqual({ ok: true, data: { deleted: true } });
  });

  it('routes saved session reorder messages with exact IDs', async () => {
    const sessions = [{ id: 'session-2' }, { id: 'session-1' }];
    dbMocks.reorderSessions.mockResolvedValue(sessions);

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'sessions:reorder',
      orderedIds: ['session-2', 'session-1'],
    });

    expect(dbMocks.reorderSessions).toHaveBeenCalledWith(['session-2', 'session-1']);
    expect(response).toEqual({ ok: true, data: sessions });
  });

  it('rejects malformed saved session reorder lists before calling the database', async () => {
    await import('../entrypoints/background');

    const nonArray = await dispatchRuntimeMessage({
      type: 'sessions:reorder',
      orderedIds: 'session-1',
    });
    const nonStringId = await dispatchRuntimeMessage({
      type: 'sessions:reorder',
      orderedIds: ['session-1', 2],
    });

    expect(dbMocks.reorderSessions).not.toHaveBeenCalled();
    for (const { response } of [nonArray, nonStringId]) {
      expect(response).toEqual({
        ok: false,
        error: {
          code: 'unknown-error',
          message: 'Invalid sessions:reorder message.',
        },
      });
    }
  });

  it('routes valid saved tab move requests unchanged', async () => {
    const request = {
      sourceSessionId: 'session-1',
      tabId: 'tab-2',
      destinationSessionId: 'session-2',
      destinationIndex: 1,
    };
    dbMocks.moveSavedTab.mockResolvedValue(undefined);

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({ type: 'sessions:move-tab', request });

    expect(dbMocks.moveSavedTab).toHaveBeenCalledWith(request);
    expect(response).toEqual({ ok: true, data: { moved: true } });
  });

  it('maps a database-rejected saved move to its structured error', async () => {
    const request = {
      sourceSessionId: 'session-1',
      tabId: 'tab-2',
      destinationSessionId: 'session-2',
      destinationIndex: 4,
    };
    dbMocks.moveSavedTab.mockRejectedValue(new Error('Invalid destination index: 4'));

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({ type: 'sessions:move-tab', request });

    expect(response).toEqual({
      ok: false,
      error: {
        code: 'invalid-saved-move',
        message: 'Saved tab move request is invalid.',
      },
    });
  });

  it('rejects malformed saved tab moves before they reach the database', async () => {
    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'sessions:move-tab',
      request: {
        sourceSessionId: 'session-1',
        tabId: 'tab-2',
        destinationSessionId: 'session-2',
        destinationIndex: -1,
      },
    });

    expect(dbMocks.moveSavedTab).not.toHaveBeenCalled();
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'invalid-saved-move',
        message: 'Saved tab move request is invalid.',
      },
    });
  });

  it('rejects a missing saved tab move request before it reaches the database', async () => {
    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({ type: 'sessions:move-tab' });

    expect(dbMocks.moveSavedTab).not.toHaveBeenCalled();
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'invalid-saved-move',
        message: 'Saved tab move request is invalid.',
      },
    });
  });

  it('moves deleted saved sessions to History', async () => {
    dbMocks.moveSessionToHistory.mockResolvedValue({ id: 'history-1' });

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'sessions:delete',
      sessionId: 'session-1',
    });

    expect(dbMocks.moveSessionToHistory).toHaveBeenCalledWith('session-1', 'deleted');
    expect(response).toEqual({ ok: true, data: { deleted: true } });
  });

  it('routes History list messages', async () => {
    const entries = [{ id: 'history-1' }];
    dbMocks.listHistory.mockResolvedValue(entries);

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({ type: 'history:list' });

    expect(dbMocks.listHistory).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ ok: true, data: entries });
  });

  it('routes History tab open messages with exact IDs', async () => {
    const result = { ok: true, data: { opened: true } };
    sessionServiceMocks.openHistoryTab.mockResolvedValue(result);

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'history:open-tab',
      historyId: 'history-1',
      tabId: 'tab-2',
    });

    expect(sessionServiceMocks.openHistoryTab).toHaveBeenCalledWith('history-1', 'tab-2');
    expect(response).toBe(result);
  });

  it('rejects malformed History tab open IDs before calling the service', async () => {
    await import('../entrypoints/background');

    const missingHistory = await dispatchRuntimeMessage({
      type: 'history:open-tab',
      historyId: '',
      tabId: 'tab-2',
    });
    const missingTab = await dispatchRuntimeMessage({
      type: 'history:open-tab',
      historyId: 'history-1',
      tabId: null,
    });

    expect(sessionServiceMocks.openHistoryTab).not.toHaveBeenCalled();
    expect(missingHistory.response).toEqual({
      ok: false,
      error: {
        code: 'history-entry-not-found',
        message: 'History entry was not found.',
      },
    });
    expect(missingTab.response).toEqual({
      ok: false,
      error: {
        code: 'saved-tab-not-found',
        message: 'Saved tab was not found.',
      },
    });
  });

  it('routes History restore messages with exact IDs', async () => {
    const restored = { id: 'session-restored' };
    dbMocks.restoreHistoryEntry.mockResolvedValue(restored);

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'history:restore',
      historyId: 'history-1',
    });

    expect(dbMocks.restoreHistoryEntry).toHaveBeenCalledWith('history-1');
    expect(response).toEqual({ ok: true, data: restored });
  });

  it('routes History delete messages with exact IDs', async () => {
    dbMocks.deleteHistoryEntry.mockResolvedValue(undefined);

    await import('../entrypoints/background');
    const { response } = await dispatchRuntimeMessage({
      type: 'history:delete',
      historyId: 'history-1',
    });

    expect(dbMocks.deleteHistoryEntry).toHaveBeenCalledWith('history-1');
    expect(response).toEqual({ ok: true, data: { deleted: true } });
  });

  it('rejects malformed History restore and delete IDs', async () => {
    await import('../entrypoints/background');
    const restored = await dispatchRuntimeMessage({
      type: 'history:restore',
      historyId: '',
    });
    const deleted = await dispatchRuntimeMessage({
      type: 'history:delete',
      historyId: null,
    });

    expect(dbMocks.restoreHistoryEntry).not.toHaveBeenCalled();
    expect(dbMocks.deleteHistoryEntry).not.toHaveBeenCalled();
    expect(restored.response).toEqual({
      ok: false,
      error: {
        code: 'history-entry-not-found',
        message: 'History entry was not found.',
      },
    });
    expect(deleted.response).toEqual(restored.response);
  });

  it('routes chrome tab group collapse messages', async () => {
    chromeTabGroupMocks.collapseChromeTabGroups.mockResolvedValue({
      ok: true,
      data: { collapsed: true, groupCount: 2 },
    });

    await import('../entrypoints/background');

    await dispatchRuntimeMessage({ type: 'chrome-tab-groups:collapse-window', windowId: 17 });

    expect(chromeTabGroupMocks.collapseChromeTabGroups).toHaveBeenCalledWith(17);
  });

  it('routes quick-link writes through the background update queue', async () => {
    const existingLink = {
      id: 'existing',
      url: 'https://existing.example/',
      label: 'Existing',
      icon: null,
      createdAt: '2026-07-07T00:00:00.000Z',
    };
    const newLink = {
      id: 'new',
      url: 'https://new.example/',
      label: 'New',
      icon: null,
      createdAt: '2026-07-08T00:00:00.000Z',
    };
    quickLinkMocks.updateQuickLinks.mockImplementation(async (update) => update([existingLink]));

    await import('../entrypoints/background');

    const { response } = await dispatchRuntimeMessage({ type: 'quick-links:add', link: newLink });

    expect(quickLinkMocks.updateQuickLinks).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ ok: true, data: [existingLink, newLink] });
  });
});

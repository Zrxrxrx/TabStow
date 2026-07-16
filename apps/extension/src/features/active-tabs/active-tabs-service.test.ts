import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://tabstow-test${path}`),
  },
  search: {
    query: vi.fn(),
  },
  tabGroups: {
    query: vi.fn(),
  },
  tabs: {
    discard: vi.fn(),
    get: vi.fn(),
    query: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
  windows: {
    getAll: vi.fn(),
    update: vi.fn(),
  },
}));

const tabLifecycleEventMocks = vi.hoisted(() => ({
  reconcileTabLifecycleTab: vi.fn(),
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));
vi.mock('@/features/tab-lifecycle/tab-lifecycle-events', () => tabLifecycleEventMocks);

describe('active tabs service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tabLifecycleEventMocks.reconcileTabLifecycleTab.mockResolvedValue(undefined);
    browserMocks.tabGroups.query.mockResolvedValue([]);
    browserMocks.windows.getAll.mockResolvedValue([
      { id: 2, focused: true, incognito: false, type: 'normal' },
    ]);
  });

  it('lists active browser tabs from all windows', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, url: 'https://example.com' },
    ]);

    const { listActiveTabs } = await import('./active-tabs-service');
    const result = await listActiveTabs();

    expect(browserMocks.tabs.query).toHaveBeenCalledWith({});
    expect(result).toEqual({
      ok: true,
      data: [{ id: 1, windowId: 2, index: 0, url: 'https://example.com' }],
    });
  });

  it('filters extension and browser-internal tabs from active tab listings', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, url: 'https://example.com' },
      { id: 2, windowId: 2, index: 1, url: 'chrome://extensions' },
      { id: 3, windowId: 2, index: 2, url: 'about:blank' },
      { id: 4, windowId: 2, index: 3, url: 'chrome-extension://abc/newtab.html' },
      { id: 5, windowId: 2, index: 4 },
    ]);

    const { listActiveTabs } = await import('./active-tabs-service');
    const result = await listActiveTabs();

    expect(result).toEqual({
      ok: true,
      data: [{ id: 1, windowId: 2, index: 0, url: 'https://example.com' }],
    });
  });

  it('detects other open Tabstow pages without counting the current page', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      { id: 7, url: 'chrome-extension://tabstow-test/newtab.html' },
      { id: 8, url: 'chrome-extension://tabstow-test/newtab.html' },
      { id: 9, url: 'chrome-extension://tabstow-test/options.html' },
      { id: 10, url: 'https://example.com/' },
      {
        id: 11,
        pendingUrl: 'chrome-extension://tabstow-test/newtab.html',
        url: 'chrome://newtab/',
      },
    ]);

    const { getDuplicateTabstowPageState } = await import('./active-tabs-service');

    await expect(getDuplicateTabstowPageState(7)).resolves.toEqual({
      ok: true,
      data: { duplicateCount: 2 },
    });
    expect(browserMocks.runtime.getURL).toHaveBeenCalledWith('/newtab.html');
    expect(browserMocks.tabs.query).toHaveBeenCalledWith({});
  });

  it('rechecks duplicate Tabstow pages before closing them and preserves the current page', async () => {
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 7, url: 'chrome-extension://tabstow-test/newtab.html' },
        { id: 8, url: 'chrome-extension://tabstow-test/newtab.html' },
      ])
      .mockResolvedValueOnce([
        { id: 7, url: 'chrome-extension://tabstow-test/newtab.html' },
        { id: 11, url: 'chrome-extension://tabstow-test/newtab.html' },
        { id: 12, url: 'chrome-extension://tabstow-test/options.html' },
      ]);

    const {
      closeDuplicateTabstowPages,
      getDuplicateTabstowPageState,
    } = await import('./active-tabs-service');

    await getDuplicateTabstowPageState(7);
    await expect(closeDuplicateTabstowPages(7)).resolves.toEqual({
      ok: true,
      data: { closedTabCount: 1 },
    });
    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([11]);
  });

  it('does not inspect or close tabs when the current Tabstow page cannot be identified', async () => {
    const {
      closeDuplicateTabstowPages,
      getDuplicateTabstowPageState,
    } = await import('./active-tabs-service');

    await expect(getDuplicateTabstowPageState(undefined)).resolves.toEqual({
      ok: false,
      error: {
        code: 'chrome-tabs-error',
        message: 'Tabstow could not identify the current tab.',
      },
    });
    await expect(closeDuplicateTabstowPages(undefined)).resolves.toEqual({
      ok: false,
      error: {
        code: 'chrome-tabs-error',
        message: 'Tabstow could not identify the current tab.',
      },
    });
    expect(browserMocks.tabs.query).not.toHaveBeenCalled();
    expect(browserMocks.tabs.remove).not.toHaveBeenCalled();
  });

  it('lists active tabs with Chrome tab-group metadata', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      {
        id: 1,
        windowId: 2,
        groupId: 31,
        index: 0,
        url: 'https://example.com',
        audible: true,
        discarded: true,
      },
    ]);
    browserMocks.tabGroups.query.mockResolvedValue([
      { id: 31, windowId: 2, title: 'Reading', color: 'blue', collapsed: false },
    ]);

    const { listActiveTabsSnapshot } = await import('./active-tabs-service');
    const result = await listActiveTabsSnapshot();

    expect(browserMocks.tabs.query).toHaveBeenCalledWith({});
    expect(browserMocks.tabGroups.query).toHaveBeenCalledWith({});
    expect(result).toEqual({
      ok: true,
      data: {
        windows: [{ id: 2, focused: true, incognito: false, type: 'normal' }],
        tabs: [
          {
            id: 1,
            windowId: 2,
            groupId: 31,
            index: 0,
            url: 'https://example.com',
            audible: true,
            discarded: true,
          },
        ],
        chromeGroups: [{ id: 31, windowId: 2, title: 'Reading', color: 'blue', collapsed: false }],
      },
    });
  });

  it('keeps active tabs when Chrome group metadata cannot be read', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, groupId: 31, index: 0, url: 'https://example.com' },
    ]);
    browserMocks.tabGroups.query.mockRejectedValue(new Error('tabGroups unavailable'));

    const { listActiveTabsSnapshot } = await import('./active-tabs-service');
    const result = await listActiveTabsSnapshot();

    expect(result).toEqual({
      ok: true,
      data: {
        windows: [{ id: 2, focused: true, incognito: false, type: 'normal' }],
        tabs: [{ id: 1, windowId: 2, groupId: 31, index: 0, url: 'https://example.com' }],
        chromeGroups: [],
      },
    });
  });

  it('returns eligible tabs and groups only from normal windows', async () => {
    browserMocks.windows.getAll.mockResolvedValue([
      { id: 2, focused: true, incognito: false, type: 'normal' },
      { id: 3, focused: false, incognito: false, type: 'popup' },
      { focused: false, incognito: false, type: 'normal' },
    ]);
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, url: 'https://visible.example/' },
      { id: 2, windowId: 2, index: 1, url: 'chrome://settings' },
      { id: 3, windowId: 3, index: 0, url: 'https://popup.example/' },
    ]);
    browserMocks.tabGroups.query.mockResolvedValue([
      { id: 31, windowId: 2, title: 'Normal', color: 'blue', collapsed: false },
      { id: 32, windowId: 3, title: 'Popup', color: 'red', collapsed: false },
    ]);

    const { listActiveTabsSnapshot } = await import('./active-tabs-service');

    await expect(listActiveTabsSnapshot()).resolves.toEqual({
      ok: true,
      data: {
        windows: [{ id: 2, focused: true, incognito: false, type: 'normal' }],
        tabs: [{ id: 1, windowId: 2, index: 0, url: 'https://visible.example/' }],
        chromeGroups: [
          { id: 31, windowId: 2, title: 'Normal', color: 'blue', collapsed: false },
        ],
      },
    });
  });

  it('returns a Chrome tabs error when normal windows cannot be read', async () => {
    browserMocks.tabs.query.mockResolvedValue([]);
    browserMocks.windows.getAll.mockRejectedValue(new Error('Windows unavailable'));

    const { listActiveTabsSnapshot } = await import('./active-tabs-service');

    await expect(listActiveTabsSnapshot()).resolves.toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'Windows unavailable' },
    });
  });

  it('focuses a tab and its window', async () => {
    const { focusActiveTab } = await import('./active-tabs-service');
    const result = await focusActiveTab(5, 8);

    expect(browserMocks.windows.update).toHaveBeenCalledWith(8, { focused: true });
    expect(browserMocks.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(result).toEqual({ ok: true, data: { focused: true } });
  });

  it('focuses the tab current window when a suggestion snapshot is stale', async () => {
    browserMocks.tabs.update.mockResolvedValue({ id: 5, windowId: 11 });
    const { focusActiveTab } = await import('./active-tabs-service');

    await expect(focusActiveTab(5, 8)).resolves.toEqual({
      ok: true,
      data: { focused: true },
    });

    expect(browserMocks.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(browserMocks.windows.update).toHaveBeenCalledWith(11, { focused: true });
    expect(browserMocks.windows.update).not.toHaveBeenCalledWith(8, { focused: true });
  });

  it('closes requested tabs', async () => {
    const { closeActiveTabs } = await import('./active-tabs-service');
    const result = await closeActiveTabs([3, 4]);

    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([3, 4]);
    expect(result).toEqual({ ok: true, data: { closed: true, tabCount: 2 } });
  });

  it('sleeps each requested eligible tab once with an explicit tab id', async () => {
    browserMocks.tabs.get.mockImplementation(async (tabId: number) => ({
      id: tabId,
      active: false,
      audible: false,
      autoDiscardable: false,
      discarded: false,
      incognito: false,
      pinned: false,
      url: `https://example.com/${tabId}`,
    }));
    browserMocks.tabs.discard.mockImplementation(async (tabId: number) => ({
      id: tabId,
      discarded: true,
    }));

    const { sleepActiveTabs } = await import('./active-tabs-service');
    const result = await sleepActiveTabs([3, 4, 3]);

    expect(browserMocks.tabs.get.mock.calls).toEqual([[3], [4]]);
    expect(browserMocks.tabs.discard.mock.calls).toEqual([[3], [4]]);
    expect(tabLifecycleEventMocks.reconcileTabLifecycleTab.mock.calls).toEqual([
      [{ id: 3, discarded: true }],
      [{ id: 4, discarded: true }],
    ]);
    expect(result).toEqual({
      ok: true,
      data: {
        sleptTabIds: [3, 4],
        skippedTabIds: [],
        failures: [],
      },
    });
  });

  it('skips tabs protected by the manual sleep policy', async () => {
    const protectedTabs = new Map<number, Partial<chrome.tabs.Tab>>([
      [10, { active: true }],
      [11, { discarded: true }],
      [12, { pinned: true }],
      [13, { audible: true }],
      [14, { incognito: true }],
      [15, { url: 'chrome://settings' }],
      [16, { url: 'devtools://devtools/bundled/inspector.html' }],
    ]);
    browserMocks.tabs.get.mockImplementation(async (tabId: number) => ({
      id: tabId,
      active: false,
      audible: false,
      discarded: false,
      incognito: false,
      pinned: false,
      url: 'https://example.com',
      ...protectedTabs.get(tabId),
    }));

    const { sleepActiveTabs } = await import('./active-tabs-service');
    const result = await sleepActiveTabs([10, 11, 12, 13, 14, 15, 16]);

    expect(browserMocks.tabs.discard).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      data: {
        sleptTabIds: [],
        skippedTabIds: [10, 11, 12, 13, 14, 15, 16],
        failures: [],
      },
    });
  });

  it('reports a tab as skipped when Chrome declines the discard after validation', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 18,
      active: false,
      audible: false,
      discarded: false,
      incognito: false,
      pinned: false,
      url: 'https://example.com/racing-tab',
    });
    browserMocks.tabs.discard.mockResolvedValue(undefined);

    const { sleepActiveTabs } = await import('./active-tabs-service');
    const result = await sleepActiveTabs([18]);

    expect(result).toEqual({
      ok: true,
      data: {
        sleptTabIds: [],
        skippedTabIds: [18],
        failures: [],
      },
    });
  });

  it('keeps a successful manual sleep when direct observation fails', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 19,
      active: false,
      audible: false,
      discarded: false,
      incognito: false,
      pinned: false,
      url: 'https://example.com/observed-later',
    });
    const discarded = { id: 19, discarded: true };
    browserMocks.tabs.discard.mockResolvedValue(discarded);
    tabLifecycleEventMocks.reconcileTabLifecycleTab.mockRejectedValue(
      new Error('observation unavailable'),
    );
    const { sleepActiveTabs } = await import('./active-tabs-service');

    await expect(sleepActiveTabs([19])).resolves.toEqual({
      ok: true,
      data: { sleptTabIds: [19], skippedTabIds: [], failures: [] },
    });
    expect(tabLifecycleEventMocks.reconcileTabLifecycleTab).toHaveBeenCalledWith(
      discarded,
    );
  });

  it('reports per-tab failures without stopping the remaining batch', async () => {
    browserMocks.tabs.get.mockImplementation(async (tabId: number) => {
      if (tabId === 22) throw new Error('Tab disappeared');
      return {
        id: tabId,
        active: false,
        audible: false,
        discarded: false,
        incognito: false,
        pinned: false,
        url: `https://example.com/${tabId}`,
      };
    });
    browserMocks.tabs.discard.mockImplementation(async (tabId: number) => {
      if (tabId === 20) throw new Error('Cannot discard tab');
      return { id: tabId, discarded: true };
    });

    const { sleepActiveTabs } = await import('./active-tabs-service');
    const result = await sleepActiveTabs([20, 21, 22]);

    expect(browserMocks.tabs.discard.mock.calls).toEqual([[20], [21]]);
    expect(result).toEqual({
      ok: true,
      data: {
        sleptTabIds: [21],
        skippedTabIds: [],
        failures: [
          { tabId: 20, message: 'Cannot discard tab' },
          { tabId: 22, message: 'Tab disappeared' },
        ],
      },
    });
  });

  it('runs a default search with trimmed query text', async () => {
    const { runDefaultSearch } = await import('./active-tabs-service');
    const result = await runDefaultSearch('  tab groups  ');

    expect(browserMocks.search.query).toHaveBeenCalledWith({ text: 'tab groups' });
    expect(result).toEqual({ ok: true, data: { searched: true } });
  });
});

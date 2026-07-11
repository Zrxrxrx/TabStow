import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  search: {
    query: vi.fn(),
  },
  tabGroups: {
    query: vi.fn(),
  },
  tabs: {
    query: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
  windows: {
    getAll: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

describe('active tabs service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('lists active tabs with Chrome tab-group metadata', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, groupId: 31, index: 0, url: 'https://example.com' },
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
        tabs: [{ id: 1, windowId: 2, groupId: 31, index: 0, url: 'https://example.com' }],
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

  it('closes requested tabs', async () => {
    const { closeActiveTabs } = await import('./active-tabs-service');
    const result = await closeActiveTabs([3, 4]);

    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([3, 4]);
    expect(result).toEqual({ ok: true, data: { closed: true, tabCount: 2 } });
  });

  it('runs a default search with trimmed query text', async () => {
    const { runDefaultSearch } = await import('./active-tabs-service');
    const result = await runDefaultSearch('  tab groups  ');

    expect(browserMocks.search.query).toHaveBeenCalledWith({ text: 'tab groups' });
    expect(result).toEqual({ ok: true, data: { searched: true } });
  });
});

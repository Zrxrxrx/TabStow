import { beforeEach, describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  tabs: {
    get: vi.fn(),
    group: vi.fn(),
    move: vi.fn(),
    query: vi.fn(),
    ungroup: vi.fn(),
  },
  tabGroups: {
    get: vi.fn(),
    move: vi.fn(),
  },
  windows: {
    get: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

describe('active tab moves', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('reorders an ungrouped tab after a fresh tab anchor', async () => {
    browserMocks.tabs.get.mockResolvedValue({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' },
        position: { kind: 'after', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { index: 1 });
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('groups an ungrouped tab and resolves its final group position again', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 })
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 2, pinned: false, groupId: 31 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
        { id: 11, windowId: 2, index: 1, pinned: false, groupId: 31 },
      ])
      .mockResolvedValueOnce([
        { id: 11, windowId: 2, index: 1, pinned: false, groupId: 31 },
        { id: 10, windowId: 2, index: 2, pinned: false, groupId: 31 },
      ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(browserMocks.tabs.group).toHaveBeenCalledWith({ groupId: 31, tabIds: 10 });
    expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { index: 1 });
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('ungroups before resolving an ungrouped group boundary', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: 31 })
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 10, windowId: 2, index: 0, pinned: false, groupId: 31 },
        { id: 11, windowId: 2, index: 1, pinned: false, groupId: 32 },
      ])
      .mockResolvedValueOnce([
        { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
        { id: 11, windowId: 2, index: 1, pinned: false, groupId: 32 },
      ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' },
        position: { kind: 'after', anchor: { kind: 'group', groupId: 32 } },
      },
    });

    expect(browserMocks.tabs.ungroup).toHaveBeenCalledWith(10);
    expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { index: 1 });
  });

  it.each(['before', 'after'] as const)(
    'preserves a sole-tab ungroup when its source group disappears from the %s anchor',
    async (kind) => {
      browserMocks.tabs.get.mockResolvedValue({
        id: 10,
        windowId: 2,
        index: 1,
        pinned: false,
        groupId: 31,
      });
      browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
      browserMocks.tabs.query
        .mockResolvedValueOnce([
          { id: 20, windowId: 2, index: 0, pinned: false, groupId: -1 },
          { id: 10, windowId: 2, index: 1, pinned: false, groupId: 31 },
          { id: 21, windowId: 2, index: 2, pinned: false, groupId: -1 },
        ])
        .mockResolvedValueOnce([
          { id: 20, windowId: 2, index: 0, pinned: false, groupId: -1 },
          { id: 10, windowId: 2, index: 1, pinned: false, groupId: -1 },
          { id: 21, windowId: 2, index: 2, pinned: false, groupId: -1 },
        ]);

      const { moveActiveTab } = await import('./active-tab-moves');
      const result = await moveActiveTab({
        tabId: 10,
        destination: {
          windowId: 2,
          lane: { kind: 'ungrouped' },
          position: { kind, anchor: { kind: 'group', groupId: 31 } },
        },
      });

      expect(result).toEqual({ ok: true, data: { moved: true } });
      expect(browserMocks.tabs.ungroup).toHaveBeenCalledTimes(1);
      expect(browserMocks.tabs.ungroup).toHaveBeenCalledWith(10);
      expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    },
  );

  it('rejects the ungrouped sentinel as a group anchor before mutation', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 10,
      windowId: 2,
      index: 0,
      pinned: false,
      groupId: -1,
    });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' },
        position: { kind: 'after', anchor: { kind: 'group', groupId: -1 } },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'The drop group is invalid.' },
    });
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('rejects pinned and incognito lane mismatches without mutation', async () => {
    browserMocks.tabs.get.mockResolvedValue({ id: 10, windowId: 2, index: 0, pinned: true, groupId: -1 });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: true });

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: { windowId: 3, lane: { kind: 'ungrouped' }, position: { kind: 'end' } },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'Tabs cannot move between regular and incognito windows.' },
    });
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('does not mutate Chrome when the tab is already at the resolved position', async () => {
    const source = { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 };
    browserMocks.tabs.get.mockResolvedValue(source);
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      source,
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' },
        position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(result).toEqual({ ok: true, data: { moved: false } });
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('uses the fresh query index for a same-window no-op', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 10,
      windowId: 2,
      index: 0,
      pinned: false,
      groupId: -1,
    });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 11, windowId: 2, index: 0, pinned: false, groupId: -1 },
      { id: 10, windowId: 2, index: 1, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' },
        position: { kind: 'after', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(result).toEqual({ ok: true, data: { moved: false } });
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('treats a tab in the destination query as already moved despite a stale source window', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 10,
      windowId: 2,
      index: 0,
      pinned: false,
      groupId: -1,
    });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 10, windowId: 3, index: 0, pinned: false, groupId: -1 },
      { id: 11, windowId: 3, index: 1, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 3,
        lane: { kind: 'ungrouped' },
        position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(result).toEqual({ ok: true, data: { moved: false } });
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
  });

  it('uses fresh same-window group membership instead of regrouping', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 10,
      windowId: 2,
      index: 0,
      pinned: false,
      groupId: 32,
    });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 11, windowId: 2, index: 0, pinned: false, groupId: 31 },
      { id: 10, windowId: 2, index: 1, pinned: false, groupId: 31 },
    ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'end' },
      },
    });

    expect(result).toEqual({ ok: true, data: { moved: false } });
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'unpinned source into pinned lane',
      source: { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
      lane: { kind: 'pinned' } as const,
      message: 'Pinned state cannot be changed by dragging.',
    },
    {
      name: 'pinned source into a group lane',
      source: { id: 10, windowId: 2, index: 0, pinned: true, groupId: -1 },
      lane: { kind: 'group', groupId: 31 } as const,
      message: 'Pinned state cannot be changed by dragging.',
    },
  ])('rejects $name', async ({ source, lane, message }) => {
    browserMocks.tabs.get.mockResolvedValue(source);
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([source]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: { windowId: 2, lane, position: { kind: 'end' } },
    });

    expect(result).toEqual({ ok: false, error: { code: 'chrome-tabs-error', message } });
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
  });

  it('moves across windows, joins the target group, and counts hidden tabs', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 })
      .mockResolvedValueOnce({ id: 10, windowId: 3, index: 2, pinned: false, groupId: -1 })
      .mockResolvedValueOnce({ id: 10, windowId: 3, index: 2, pinned: false, groupId: 31 });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 3 });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 90, windowId: 3, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
        { id: 11, windowId: 3, index: 1, pinned: false, groupId: 31 },
      ])
      .mockResolvedValueOnce([
        { id: 90, windowId: 3, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
        { id: 11, windowId: 3, index: 1, pinned: false, groupId: 31 },
        { id: 10, windowId: 3, index: 2, pinned: false, groupId: -1 },
      ])
      .mockResolvedValueOnce([
        { id: 90, windowId: 3, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
        { id: 11, windowId: 3, index: 1, pinned: false, groupId: 31 },
        { id: 10, windowId: 3, index: 2, pinned: false, groupId: 31 },
      ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 3,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(browserMocks.tabs.move).toHaveBeenNthCalledWith(1, 10, { windowId: 3, index: -1 });
    expect(browserMocks.tabs.group).toHaveBeenCalledWith({ groupId: 31, tabIds: 10 });
    expect(browserMocks.tabs.move).toHaveBeenNthCalledWith(2, 10, { index: 1 });
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('uses fresh group membership after a cross-window move', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 })
      .mockResolvedValueOnce({ id: 10, windowId: 3, index: 1, pinned: false, groupId: -1 });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 3 });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 11, windowId: 3, index: 0, pinned: false, groupId: 31 },
      ])
      .mockResolvedValueOnce([
        { id: 11, windowId: 3, index: 0, pinned: false, groupId: 31 },
        { id: 10, windowId: 3, index: 1, pinned: false, groupId: 31 },
      ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 3,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'end' },
      },
    });

    expect(browserMocks.tabs.move).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { windowId: 3, index: -1 });
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('uses the final complete query index after a cross-window move', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 })
      .mockResolvedValueOnce({ id: 10, windowId: 3, index: 0, pinned: false, groupId: -1 });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 20, windowId: 3, index: 0, pinned: false, groupId: -1 },
      ])
      .mockResolvedValueOnce([
        { id: 20, windowId: 3, index: 0, pinned: false, groupId: -1 },
        { id: 10, windowId: 3, index: 1, pinned: false, groupId: -1 },
      ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 3,
        lane: { kind: 'ungrouped' },
        position: { kind: 'end' },
      },
    });

    expect(browserMocks.tabs.move).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { windowId: 3, index: -1 });
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('moves a tab from one Chrome group to another', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: 32 })
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 2, pinned: false, groupId: 31 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 10, windowId: 2, index: 0, pinned: false, groupId: 32 },
        { id: 11, windowId: 2, index: 1, pinned: false, groupId: 31 },
      ])
      .mockResolvedValueOnce([
        { id: 11, windowId: 2, index: 1, pinned: false, groupId: 31 },
        { id: 10, windowId: 2, index: 2, pinned: false, groupId: 31 },
      ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'end' },
      },
    });

    expect(browserMocks.tabs.group).toHaveBeenCalledWith({ groupId: 31, tabIds: 10 });
  });

  it('reports an anchor that disappears after membership changes', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: 31 })
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 10, windowId: 2, index: 0, pinned: false, groupId: 31 },
        { id: 11, windowId: 2, index: 1, pinned: false, groupId: 32 },
      ])
      .mockResolvedValueOnce([
        { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
      ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' },
        position: { kind: 'after', anchor: { kind: 'group', groupId: 32 } },
      },
    });

    expect(browserMocks.tabs.ungroup).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'The drop group no longer exists.' },
    });
  });

  it('does not retry Chrome while a native tab drag blocks editing', async () => {
    browserMocks.tabs.get.mockResolvedValue({ id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 10, windowId: 2, index: 0, pinned: false, groupId: -1 },
      { id: 11, windowId: 2, index: 1, pinned: false, groupId: -1 },
    ]);
    browserMocks.tabs.move.mockRejectedValue(
      new Error('Tabs cannot be edited right now (user may be dragging a tab).'),
    );

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'ungrouped' },
        position: { kind: 'after', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(browserMocks.tabs.move).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'chrome-tabs-error',
        message: 'Tabs cannot be edited right now (user may be dragging a tab).',
      },
    });
  });

  it('reorders a tab within its existing Chrome group', async () => {
    browserMocks.tabs.get.mockResolvedValue({ id: 10, windowId: 2, index: 1, pinned: false, groupId: 31 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 90, windowId: 2, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
      { id: 10, windowId: 2, index: 1, pinned: false, groupId: 31 },
      { id: 11, windowId: 2, index: 2, pinned: false, groupId: 31 },
    ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 2,
        lane: { kind: 'group', groupId: 31 },
        position: { kind: 'after', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { index: 2 });
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('moves a pinned tab to another window pinned lane without changing pinned state', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({ id: 10, windowId: 2, index: 0, pinned: true, groupId: -1 })
      .mockResolvedValueOnce({ id: 10, windowId: 3, index: 1, pinned: true, groupId: -1 });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
    browserMocks.tabs.query
      .mockResolvedValueOnce([
        { id: 20, windowId: 3, index: 0, pinned: true, groupId: -1 },
        { id: 21, windowId: 3, index: 1, pinned: false, groupId: -1 },
      ])
      .mockResolvedValueOnce([
        { id: 20, windowId: 3, index: 0, pinned: true, groupId: -1 },
        { id: 10, windowId: 3, index: 1, pinned: true, groupId: -1 },
        { id: 21, windowId: 3, index: 2, pinned: false, groupId: -1 },
      ]);

    const { moveActiveTab } = await import('./active-tab-moves');
    const result = await moveActiveTab({
      tabId: 10,
      destination: {
        windowId: 3,
        lane: { kind: 'pinned' },
        position: { kind: 'after', anchor: { kind: 'tab', tabId: 20 } },
      },
    });

    expect(browserMocks.tabs.move).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.move).toHaveBeenCalledWith(10, { windowId: 3, index: 1 });
    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(browserMocks.tabs.ungroup).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('moves a complete group after another complete group without splitting it', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
      { id: 2, windowId: 2, index: 1, pinned: false, groupId: 31 },
      { id: 3, windowId: 2, index: 2, pinned: false, groupId: 32 },
      { id: 4, windowId: 2, index: 3, pinned: false, groupId: 32 },
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: {
        windowId: 2,
        position: { kind: 'after', anchor: { kind: 'group', groupId: 32 } },
      },
    });

    expect(browserMocks.tabGroups.move).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabGroups.move).toHaveBeenCalledWith(31, { windowId: 2, index: 2 });
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('returns a no-op when a group is already after its complete group anchor', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, pinned: false, groupId: 32 },
      { id: 2, windowId: 2, index: 1, pinned: false, groupId: 32 },
      { id: 3, windowId: 2, index: 2, pinned: false, groupId: 31 },
      { id: 4, windowId: 2, index: 3, pinned: false, groupId: 31 },
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: {
        windowId: 2,
        position: { kind: 'after', anchor: { kind: 'group', groupId: 32 } },
      },
    });

    expect(result).toEqual({ ok: true, data: { moved: false } });
    expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
  });

  it('moves a group before an ungrouped tab in another normal window', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 90, windowId: 3, index: 0, pinned: false, groupId: -1, url: 'chrome://settings' },
      { id: 11, windowId: 3, index: 1, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: {
        windowId: 3,
        position: { kind: 'before', anchor: { kind: 'tab', tabId: 11 } },
      },
    });

    expect(browserMocks.tabs.query).toHaveBeenCalledWith({ windowId: 3 });
    expect(browserMocks.tabGroups.move).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabGroups.move).toHaveBeenCalledWith(31, { windowId: 3, index: 1 });
    expect(browserMocks.tabs.move).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('moves a group to the end of another normal window', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 11, windowId: 3, index: 0, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: { windowId: 3, position: { kind: 'end' } },
    });

    expect(browserMocks.tabGroups.move).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabGroups.move).toHaveBeenCalledWith(31, { windowId: 3, index: -1 });
    expect(result).toEqual({ ok: true, data: { moved: true } });
  });

  it('returns a no-op when the source group is already at the window end', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, pinned: false, groupId: -1 },
      { id: 2, windowId: 2, index: 1, pinned: false, groupId: 31 },
      { id: 3, windowId: 2, index: 2, pinned: false, groupId: 31 },
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: { windowId: 2, position: { kind: 'end' } },
    });

    expect(result).toEqual({ ok: true, data: { moved: false } });
    expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
  });

  it('treats the source group as a no-op anchor', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: {
        windowId: 2,
        position: { kind: 'before', anchor: { kind: 'group', groupId: 31 } },
      },
    });

    expect(result).toEqual({ ok: true, data: { moved: false } });
    expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
  });

  it('rejects a source-group anchor that is absent from another destination window', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get
      .mockResolvedValueOnce({ id: 2, type: 'normal', incognito: false })
      .mockResolvedValueOnce({ id: 3, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 3, index: 0, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: {
        windowId: 3,
        position: { kind: 'before', anchor: { kind: 'group', groupId: 31 } },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'The drop group no longer exists.' },
    });
    expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'a grouped tab anchor',
      anchor: { id: 2, windowId: 2, index: 1, pinned: false, groupId: 32 },
    },
    {
      name: 'a pinned tab anchor',
      anchor: { id: 2, windowId: 2, index: 1, pinned: true, groupId: -1 },
    },
  ])('rejects $name because it would split a top-level item', async ({ anchor }) => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
      anchor,
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: {
        windowId: 2,
        position: { kind: 'before', anchor: { kind: 'tab', tabId: 2 } },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'Group moves cannot split another Chrome group.' },
    });
    expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
  });

  it('rejects the ungrouped sentinel as a native group anchor', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
      { id: 2, windowId: 2, index: 1, pinned: false, groupId: -1 },
    ]);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: {
        windowId: 2,
        position: { kind: 'before', anchor: { kind: 'group', groupId: -1 } },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'The drop group is invalid.' },
    });
    expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'source window changed',
      request: {
        groupId: 31,
        sourceWindowId: 9,
        destination: { windowId: 2, position: { kind: 'end' as const } },
      },
      sourceWindow: { id: 2, type: 'normal', incognito: false },
      targetWindow: { id: 2, type: 'normal', incognito: false },
      message: 'The dragged Chrome group moved to another window.',
    },
    {
      name: 'target is incognito-incompatible',
      request: {
        groupId: 31,
        sourceWindowId: 2,
        destination: { windowId: 3, position: { kind: 'end' as const } },
      },
      sourceWindow: { id: 2, type: 'normal', incognito: false },
      targetWindow: { id: 3, type: 'normal', incognito: true },
      message: 'Groups cannot move between regular and incognito windows.',
    },
  ])('rejects $name before mutation', async ({ request, sourceWindow, targetWindow, message }) => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get
      .mockResolvedValueOnce(sourceWindow)
      .mockResolvedValueOnce(targetWindow);

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup(request);

    expect(result).toEqual({ ok: false, error: { code: 'chrome-tabs-error', message } });
    expect(browserMocks.tabs.query).not.toHaveBeenCalled();
    expect(browserMocks.tabGroups.move).not.toHaveBeenCalled();
  });

  it('returns the Chrome group move failure without retrying', async () => {
    browserMocks.tabGroups.get.mockResolvedValue({ id: 31, windowId: 2 });
    browserMocks.windows.get.mockResolvedValue({ id: 2, type: 'normal', incognito: false });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, index: 0, pinned: false, groupId: 31 },
      { id: 2, windowId: 2, index: 1, pinned: false, groupId: -1 },
    ]);
    browserMocks.tabGroups.move.mockRejectedValue(new Error('Group move failed'));

    const { moveActiveTabGroup } = await import('./active-tab-moves');
    const result = await moveActiveTabGroup({
      groupId: 31,
      sourceWindowId: 2,
      destination: { windowId: 2, position: { kind: 'end' } },
    });

    expect(browserMocks.tabGroups.move).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'Group move failed' },
    });
  });
});

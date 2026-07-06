import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveTabGroup } from '@/features/active-tabs/types';

const browserMocks = vi.hoisted(() => ({
  tabGroups: {
    query: vi.fn(),
    update: vi.fn(),
  },
  tabs: {
    group: vi.fn(),
    query: vi.fn(),
  },
}));

vi.mock('@/lib/browser', () => ({
  browser: browserMocks,
}));

const groups: ActiveTabGroup[] = [
  {
    key: 'manual:launch',
    kind: 'manual',
    title: 'Launch',
    pinned: false,
    tabs: [
      { id: 10, windowId: 2, index: 0, active: false, pinned: false, url: 'https://example.com/a' },
      { id: 11, windowId: 2, index: 1, active: false, pinned: false, url: 'https://example.com/b' },
    ],
  },
];

const crossWindowGroups: ActiveTabGroup[] = [
  {
    key: 'manual:launch',
    kind: 'manual',
    title: 'Launch',
    pinned: false,
    tabs: [
      { id: 10, windowId: 2, index: 0, active: false, pinned: false, url: 'https://example.com/a' },
      { id: 11, windowId: 2, index: 1, active: false, pinned: false, url: 'https://example.com/b' },
      { id: 21, windowId: 3, index: 0, active: false, pinned: false, url: 'https://example.com/c' },
      { id: 22, windowId: 3, index: 1, active: false, pinned: false, url: 'https://example.com/d' },
    ],
  },
];

describe('chrome tab groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('groups tabs and stores mapping metadata', async () => {
    browserMocks.tabs.group.mockResolvedValue(99);

    const { syncChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await syncChromeTabGroups(groups, { enabled: true, mappings: [] });

    expect(browserMocks.tabs.group).toHaveBeenCalledWith({ tabIds: [10, 11] });
    expect(browserMocks.tabGroups.update).toHaveBeenCalledWith(99, { title: 'Launch', collapsed: true });
    expect(result).toEqual({
      ok: true,
      data: { enabled: true, mappings: [{ virtualGroupKey: 'manual:launch', windowId: 2, chromeGroupId: 99 }] },
    });
  });

  it('does nothing when native tab-group sync is disabled', async () => {
    const { syncChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await syncChromeTabGroups(groups, { enabled: false, mappings: [] });

    expect(browserMocks.tabs.group).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true, data: { enabled: false, mappings: [] } });
  });

  it('syncs manual groups separately per window', async () => {
    browserMocks.tabs.group
      .mockResolvedValueOnce(99)
      .mockResolvedValueOnce(199);

    const { syncChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await syncChromeTabGroups(crossWindowGroups, { enabled: true, mappings: [] });

    expect(browserMocks.tabs.group).toHaveBeenNthCalledWith(1, { tabIds: [10, 11] });
    expect(browserMocks.tabs.group).toHaveBeenNthCalledWith(2, { tabIds: [21, 22] });
    expect(browserMocks.tabGroups.update).toHaveBeenNthCalledWith(1, 99, { title: 'Launch', collapsed: true });
    expect(browserMocks.tabGroups.update).toHaveBeenNthCalledWith(2, 199, { title: 'Launch', collapsed: true });
    expect(result).toEqual({
      ok: true,
      data: {
        enabled: true,
        mappings: [
          { virtualGroupKey: 'manual:launch', windowId: 2, chromeGroupId: 99 },
          { virtualGroupKey: 'manual:launch', windowId: 3, chromeGroupId: 199 },
        ],
      },
    });
  });

  it('recovers stale native mappings during sync', async () => {
    browserMocks.tabs.group
      .mockRejectedValueOnce(new Error('No group with id: 88'))
      .mockResolvedValueOnce(123);

    const { syncChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await syncChromeTabGroups(groups, {
      enabled: true,
      mappings: [{ virtualGroupKey: 'manual:launch', windowId: 2, chromeGroupId: 88 }],
    });

    expect(browserMocks.tabs.group).toHaveBeenNthCalledWith(1, { groupId: 88, tabIds: [10, 11] });
    expect(browserMocks.tabs.group).toHaveBeenNthCalledWith(2, { tabIds: [10, 11] });
    expect(browserMocks.tabGroups.update).toHaveBeenCalledWith(123, { title: 'Launch', collapsed: true });
    expect(result).toEqual({
      ok: true,
      data: { enabled: true, mappings: [{ virtualGroupKey: 'manual:launch', windowId: 2, chromeGroupId: 123 }] },
    });
  });

  it('collapses all groups in a window', async () => {
    browserMocks.tabGroups.query.mockResolvedValue([{ id: 3, windowId: 7 }, { id: 4, windowId: 8 }]);

    const { collapseChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await collapseChromeTabGroups(7);

    expect(browserMocks.tabGroups.update).toHaveBeenCalledWith(3, { collapsed: true });
    expect(browserMocks.tabGroups.update).not.toHaveBeenCalledWith(4, expect.anything());
    expect(result).toEqual({ ok: true, data: { collapsed: true, groupCount: 1 } });
  });

  it('imports existing Chrome groups into manual groups', async () => {
    browserMocks.tabGroups.query.mockResolvedValue([{ id: 31, windowId: 7, title: 'Reading' }]);

    const { importChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await importChromeTabGroups(
      [
        { id: 1, windowId: 7, groupId: 31, index: 0, active: false, pinned: false, url: 'https://example.com' },
      ],
      { groups: [], assignments: {} },
      { enabled: true, mappings: [] },
      () => 'manual-31',
    );

    expect(result).toEqual({
      ok: true,
      data: {
        manualGroups: {
          groups: [{ id: 'manual-31', name: 'Reading', createdAt: expect.any(String) }],
          assignments: { '1': 'manual-31' },
        },
        chromeTabGroups: {
          enabled: true,
          mappings: [{ virtualGroupKey: 'manual:manual-31', windowId: 7, chromeGroupId: 31 }],
        },
      },
    });
  });

  it('replaces stale mappings when importing into a recreated manual group', async () => {
    browserMocks.tabGroups.query.mockResolvedValue([{ id: 31, windowId: 7, title: 'Reading' }]);

    const { importChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await importChromeTabGroups(
      [
        { id: 1, windowId: 7, groupId: 31, index: 0, active: false, pinned: false, url: 'https://example.com' },
      ],
      { groups: [], assignments: {} },
      {
        enabled: true,
        mappings: [{ virtualGroupKey: 'manual:missing-group', windowId: 1, chromeGroupId: 31 }],
      },
      () => 'replacement-group',
    );

    expect(result).toEqual({
      ok: true,
      data: {
        manualGroups: {
          groups: [{ id: 'replacement-group', name: 'Reading', createdAt: expect.any(String) }],
          assignments: { '1': 'replacement-group' },
        },
        chromeTabGroups: {
          enabled: true,
          mappings: [{ virtualGroupKey: 'manual:replacement-group', windowId: 7, chromeGroupId: 31 }],
        },
      },
    });
  });

  it('does not mutate input mappings when retargeting stale imports', async () => {
    browserMocks.tabGroups.query.mockResolvedValue([{ id: 31, windowId: 7, title: 'Reading' }]);
    const state = {
      enabled: true,
      mappings: [{ virtualGroupKey: 'manual:missing-group', windowId: 1, chromeGroupId: 31 }],
    };

    const { importChromeTabGroups } = await import('./chrome-tab-groups');
    const result = await importChromeTabGroups(
      [
        { id: 1, windowId: 7, groupId: 31, index: 0, active: false, pinned: false, url: 'https://example.com' },
      ],
      { groups: [], assignments: {} },
      state,
      () => 'replacement-group',
    );

    expect(state.mappings).toEqual([
      { virtualGroupKey: 'manual:missing-group', windowId: 1, chromeGroupId: 31 },
    ]);
    expect(result).toEqual({
      ok: true,
      data: {
        manualGroups: {
          groups: [{ id: 'replacement-group', name: 'Reading', createdAt: expect.any(String) }],
          assignments: { '1': 'replacement-group' },
        },
        chromeTabGroups: {
          enabled: true,
          mappings: [{ virtualGroupKey: 'manual:replacement-group', windowId: 7, chromeGroupId: 31 }],
        },
      },
    });
  });
});

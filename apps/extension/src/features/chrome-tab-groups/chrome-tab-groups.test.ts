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
});

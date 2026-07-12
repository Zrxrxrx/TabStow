import { describe, expect, it } from 'vitest';
import { buildActiveTabWindows } from './active-tab-windows';
import type { ActiveBrowserTab, ActiveTabsSnapshot } from './types';

function tab(
  id: number,
  windowId: number,
  index: number,
  partial: Partial<ActiveBrowserTab> = {},
): ActiveBrowserTab {
  return {
    active: false,
    groupId: -1,
    id,
    index,
    pinned: false,
    title: `Tab ${id}`,
    url: `https://same.example/${id}`,
    windowId,
    ...partial,
  };
}

describe('buildActiveTabWindows', () => {
  it('keeps windows separate and follows Chrome tab index instead of URL', () => {
    const snapshot: ActiveTabsSnapshot = {
      windows: [
        { id: 8, focused: false, incognito: false, type: 'normal' },
        { id: 3, focused: true, incognito: false, type: 'normal' },
      ],
      tabs: [
        tab(1, 3, 0, { pinned: true, url: 'https://same.example/' }),
        tab(2, 3, 1, { audible: true, discarded: true, url: 'https://same.example/' }),
        tab(3, 3, 2, { groupId: 31 }),
        tab(4, 3, 3, { groupId: 31 }),
        tab(5, 3, 4, { url: 'https://different.example/' }),
        tab(6, 8, 0, { url: 'https://same.example/' }),
      ],
      chromeGroups: [
        { id: 31, windowId: 3, title: 'Reading', color: 'blue', collapsed: true },
      ],
    };

    expect(buildActiveTabWindows(snapshot)).toEqual([
      {
        key: 'window:3',
        windowId: 3,
        focused: true,
        incognito: false,
        visibleTabCount: 5,
        pinnedTabs: [expect.objectContaining({ id: 1 })],
        items: [
          {
            kind: 'tab',
            key: 'tab:2',
            tab: expect.objectContaining({ id: 2, audible: true, discarded: true }),
          },
          {
            kind: 'group',
            key: 'chrome:3:31',
            windowId: 3,
            groupId: 31,
            title: 'Reading',
            color: 'blue',
            collapsed: true,
            tabs: [expect.objectContaining({ id: 3 }), expect.objectContaining({ id: 4 })],
          },
          { kind: 'tab', key: 'tab:5', tab: expect.objectContaining({ id: 5 }) },
        ],
      },
      expect.objectContaining({ key: 'window:8', visibleTabCount: 1 }),
    ]);
  });

  it('uses the window/group pair and keeps grouped tabs grouped without metadata', () => {
    const snapshot: ActiveTabsSnapshot = {
      windows: [
        { id: 2, focused: false, incognito: false, type: 'normal' },
        { id: 7, focused: false, incognito: false, type: 'normal' },
        { id: 9, focused: false, incognito: false, type: 'normal' },
      ],
      tabs: [
        tab(10, 7, 1, { groupId: 31 }),
        tab(11, 2, 0, { groupId: 31 }),
        tab(12, 7, 0, { pinned: true, groupId: 31 }),
      ],
      chromeGroups: [],
    };

    const windows = buildActiveTabWindows(snapshot);

    expect(windows.map((window) => window.windowId)).toEqual([2, 7]);
    expect(windows[0]?.items[0]).toMatchObject({
      key: 'chrome:2:31',
      title: null,
      color: null,
      collapsed: null,
    });
    expect(windows[1]?.items[0]).toMatchObject({ key: 'chrome:7:31' });
    expect(windows[1]?.pinnedTabs[0]).toMatchObject({ id: 12 });
  });
});

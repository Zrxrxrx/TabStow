import { describe, expect, it } from 'vitest';
import { buildActiveTabGroups, findDuplicateTabGroups } from './active-tab-groups';
import { getTabLabel, isLandingPage } from './tab-labels';
import type { ActiveBrowserTab } from './types';

const tabs: ActiveBrowserTab[] = [
  { id: 1, windowId: 7, groupId: -1, index: 0, active: false, pinned: false, title: 'GitHub', url: 'https://github.com/' },
  { id: 2, windowId: 7, groupId: -1, index: 1, active: true, pinned: false, title: 'openai/tabstow PR #4 · GitHub', url: 'https://github.com/openai/tabstow/pull/4' },
  { id: 3, windowId: 7, groupId: -1, index: 2, active: false, pinned: false, title: 'Mail', url: 'https://mail.google.com/mail/u/0/#inbox' },
  { id: 4, windowId: 7, groupId: -1, index: 3, active: false, pinned: false, title: 'Duplicate', url: 'https://example.com/a' },
  { id: 5, windowId: 7, groupId: -1, index: 4, active: false, pinned: false, title: 'Duplicate 2', url: 'https://example.com/a' },
];

const multiWindowTabs: ActiveBrowserTab[] = [
  { id: 10, windowId: 2, groupId: -1, index: 3, active: false, pinned: false, title: 'Example A', url: 'https://example.com/a' },
  { id: 11, windowId: 1, groupId: -1, index: 8, active: false, pinned: false, title: 'Example A copy', url: 'https://example.com/a' },
  { id: 12, windowId: 1, groupId: -1, index: 9, active: false, pinned: false, title: 'Example B', url: 'https://example.com/b' },
];

describe('active tab labels', () => {
  it('identifies landing pages', () => {
    expect(isLandingPage('https://github.com/')).toBe(true);
    expect(isLandingPage('https://github.com/openai/tabstow/pull/4')).toBe(false);
  });

  it('uses a readable GitHub title', () => {
    expect(getTabLabel(tabs[1])).toBe('openai/tabstow PR #4');
  });
});

describe('active tab groups', () => {
  it('groups homepage-style tabs separately from domain work tabs', () => {
    const groups = buildActiveTabGroups(tabs, { groups: [], assignments: {} }, { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} });

    expect(groups.map((group) => group.key)).toContain('landing:homepages');
    expect(groups.find((group) => group.key === 'domain:github.com')?.tabs.map((tab) => tab.id)).toEqual([2]);
  });

  it('applies manual group assignments before domain grouping', () => {
    const groups = buildActiveTabGroups(
      tabs,
      { groups: [{ id: 'manual-1', name: 'Launch', createdAt: '2026-07-06T00:00:00.000Z' }], assignments: { '2': 'manual-1' } },
      { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} },
    );

    expect(groups.find((group) => group.key === 'manual:manual-1')?.tabs.map((tab) => tab.id)).toEqual([2]);
    expect(groups.find((group) => group.key === 'domain:github.com')).toBeUndefined();
  });

  it('finds duplicate tabs by exact URL and keeps the first tab out of the close list', () => {
    expect(findDuplicateTabGroups(tabs)).toEqual([
      {
        url: 'https://example.com/a',
        keepTabId: 4,
        duplicateTabIds: [5],
      },
    ]);
  });

  it('orders tabs and duplicate retention deterministically across windows', () => {
    const groups = buildActiveTabGroups(multiWindowTabs, { groups: [], assignments: {} }, { groupOrder: [], pinnedGroupKeys: [], groupTabOrder: {} });

    expect(groups.find((group) => group.key === 'domain:example.com')?.tabs.map((tab) => tab.id)).toEqual([11, 12, 10]);
    expect(findDuplicateTabGroups(multiWindowTabs)).toEqual([
      {
        url: 'https://example.com/a',
        keepTabId: 11,
        duplicateTabIds: [10],
      },
    ]);
  });
});

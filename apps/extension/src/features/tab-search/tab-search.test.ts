import { describe, expect, it } from 'vitest';
import type { TabSession } from '@tabstow/core';
import type { ActiveTabsSnapshot } from '@/features/active-tabs/types';
import { filterActiveTabsSnapshot, filterSavedSessions } from './tab-search';

const snapshot: ActiveTabsSnapshot = {
  windows: [
    { id: 8, focused: true, incognito: false, type: 'normal' },
    { id: 12, focused: false, incognito: false, type: 'normal' },
  ],
  tabs: [
    {
      active: false,
      groupId: -1,
      id: 21,
      index: 0,
      pinned: false,
      title: 'API reference',
      url: 'https://docs.example.com/api',
      windowId: 8,
    },
    {
      active: true,
      groupId: 31,
      id: 22,
      index: 1,
      pinned: false,
      title: 'Issue tracker',
      url: 'https://github.com/openai/tabstow/issues',
      windowId: 8,
    },
    {
      active: true,
      groupId: 42,
      id: 23,
      index: 0,
      pinned: false,
      title: 'Inbox',
      url: 'https://mail.example.com',
      windowId: 12,
    },
  ],
  chromeGroups: [
    { id: 31, windowId: 8, title: 'Work', color: 'blue', collapsed: false },
    { id: 42, windowId: 12, title: 'Mail', color: 'red', collapsed: true },
  ],
};

const reading: TabSession = {
  id: 'reading',
  title: 'Reading',
  tabs: [
    {
      id: 'article',
      title: 'Article',
      url: 'https://example.com/article',
      createdAt: '2026-07-11T00:00:00.000Z',
    },
  ],
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z',
  deviceId: 'device-1',
};

const work: TabSession = {
  ...reading,
  id: 'work',
  title: 'Work',
  tabs: [
    {
      id: 'issue',
      title: 'Issue tracker',
      url: 'https://github.com/openai/tabstow/issues',
      createdAt: '2026-07-11T00:00:00.000Z',
    },
    {
      id: 'docs',
      title: 'API reference',
      url: 'https://docs.example.com/api',
      createdAt: '2026-07-11T00:00:00.000Z',
    },
  ],
};

describe('tab search', () => {
  it('matches active tab titles and URLs case-insensitively', () => {
    expect(filterActiveTabsSnapshot(snapshot, 'REFERENCE').tabs.map(({ id }) => id)).toEqual([21]);
    expect(filterActiveTabsSnapshot(snapshot, 'GITHUB').tabs.map(({ id }) => id)).toEqual([22]);
  });

  it('keeps metadata for matching active tabs and removes empty windows and groups', () => {
    const result = filterActiveTabsSnapshot(snapshot, 'github');

    expect(result.windows).toEqual([snapshot.windows[0]]);
    expect(result.chromeGroups).toEqual([snapshot.chromeGroups[0]]);
    expect(result.tabs.map(({ id }) => id)).toEqual([22]);
  });

  it('keeps saved session metadata while removing nonmatching tabs and sessions', () => {
    expect(filterSavedSessions([reading, work], 'DOCS')).toEqual([
      { ...work, tabs: [work.tabs[1]] },
    ]);
  });

  it('returns the original collections for blank queries', () => {
    const sessions = [reading, work];

    expect(filterActiveTabsSnapshot(snapshot, '  ')).toBe(snapshot);
    expect(filterSavedSessions(sessions, '\t')).toBe(sessions);
  });
});

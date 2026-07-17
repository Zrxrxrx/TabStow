import { describe, expect, it } from 'vitest';
import type { TabSession } from '@tabstow/core';
import type { ActiveTabsSnapshot } from '@/features/active-tabs/types';
import {
  buildOpenTabChoices,
  buildUnifiedSearchSuggestions,
  filterActiveTabsSnapshot,
  filterSavedSessions,
} from './tab-search';

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

  it('ranks title prefixes before title and URL matches while preserving source order', () => {
    const suggestions = buildUnifiedSearchSuggestions(snapshot, [reading, work], 'api', 5);

    expect(suggestions.map(({ source, title }) => `${source}:${title}`)).toEqual([
      'active:API reference',
      'saved:API reference',
    ]);
    expect(buildUnifiedSearchSuggestions(snapshot, [reading, work], 'example', 2)).toHaveLength(2);
  });

  it('keeps ranking stable with bounded result sets and allows one source to fill the limit', () => {
    const activeOnly: ActiveTabsSnapshot = {
      windows: snapshot.windows,
      chromeGroups: [],
      tabs: Array.from({ length: 1_000 }, (_, index) => ({
        active: index === 0,
        groupId: -1,
        id: index + 100,
        index,
        pinned: false,
        title:
          index >= 900
            ? `Needle prefix ${index}`
            : index >= 600
              ? `Contains needle ${index}`
              : `Unrelated ${index}`,
        url: index < 600 ? `https://example.com/needle/${index}` : `https://example.com/${index}`,
        windowId: 8,
      })),
    };

    const matchingSaved: TabSession = {
      ...work,
      tabs: [
        {
          ...work.tabs[0],
          title: 'Needle saved',
        },
      ],
    };
    const suggestions = buildUnifiedSearchSuggestions(activeOnly, [matchingSaved], 'needle', 5);

    expect(suggestions).toHaveLength(5);
    expect(suggestions.every(({ source }) => source === 'active')).toBe(true);
    expect(suggestions.map(({ title }) => title)).toEqual([
      'Needle prefix 900',
      'Needle prefix 901',
      'Needle prefix 902',
      'Needle prefix 903',
      'Needle prefix 904',
    ]);
    expect(buildUnifiedSearchSuggestions(activeOnly, [matchingSaved], 'needle', 0)).toEqual([]);
  });

  it('adds structural window, group, lane, and saved-window context without exposing IDs', () => {
    const suggestions = buildUnifiedSearchSuggestions(snapshot, [reading, work], 'issue', 5);
    const active = suggestions.find(({ source }) => source === 'active');
    const saved = suggestions.find(({ source }) => source === 'saved');

    expect(active).toMatchObject({
      source: 'active',
      context: {
        currentWindow: true,
        windowNumber: 1,
        lane: { kind: 'group', title: 'Work' },
      },
    });
    expect(saved).toMatchObject({
      source: 'saved',
      context: { sessionTitle: 'Work', tabCount: 2 },
    });
    expect(JSON.stringify({ active, saved })).not.toContain('31');
  });

  it('uses the same focused-first window numbering as the active workspace', () => {
    const permuted = { ...snapshot, windows: [...snapshot.windows].reverse() };
    const suggestion = buildUnifiedSearchSuggestions(permuted, [], 'inbox', 5)[0];

    expect(suggestion).toMatchObject({
      source: 'active',
      context: { currentWindow: false, windowNumber: 2 },
    });
  });

  it('keeps a title match when an active tab has no URL', () => {
    const noUrl: ActiveTabsSnapshot = {
      windows: [snapshot.windows[0]],
      chromeGroups: [],
      tabs: [{ ...snapshot.tabs[0], id: 99, title: 'API scratchpad', url: undefined }],
    };

    expect(buildUnifiedSearchSuggestions(noUrl, [], 'api', 5)).toMatchObject([
      { source: 'active', title: 'API scratchpad', url: '' },
    ]);
  });

  it('builds a capped local quick-link chooser with context and overflow state', () => {
    const largeSnapshot: ActiveTabsSnapshot = {
      windows: snapshot.windows,
      chromeGroups: snapshot.chromeGroups,
      tabs: Array.from({ length: 51 }, (_, index) => ({
        active: index === 0,
        groupId: index === 0 ? 31 : -1,
        id: index + 200,
        index,
        pinned: index === 1,
        title: `Choice ${index}`,
        url: `https://example.com/${index}`,
        windowId: 8,
      })),
    };

    const all = buildOpenTabChoices(largeSnapshot, '', 50);
    const filtered = buildOpenTabChoices(largeSnapshot, 'choice 50', 50);

    expect(all.choices).toHaveLength(50);
    expect(all.overflow).toBe(true);
    expect(all.choices[0]).toMatchObject({
      label: 'Choice 0',
      context: { lane: { kind: 'group', title: 'Work' } },
    });
    expect(filtered).toMatchObject({ overflow: false });
    expect(filtered.choices.map(({ label }) => label)).toEqual(['Choice 50']);
  });

  it('returns no unified suggestions for blank queries', () => {
    expect(buildUnifiedSearchSuggestions(snapshot, [reading, work], '   ')).toEqual([]);
  });
});

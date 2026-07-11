import { describe, expect, it } from 'vitest';
import type { SavedTab, TabSession } from './schemas';
import {
  deduplicateIncomingTabs,
  deduplicateSessionsByUrl,
  mergeSessionsById,
  normalizeSavedTabUrl,
  sortSessionsForDisplay,
} from './tab-session';

const baseSession: TabSession = {
  id: 'session-1',
  title: 'Local',
  tabs: [],
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  deviceId: 'local-device',
};

function tab(id: string, url: string, createdAt: string): SavedTab {
  return { id, url, title: id, createdAt };
}

function session(
  id: string,
  updatedAt: string,
  tabs: SavedTab[],
): TabSession {
  return { ...baseSession, id, title: id, tabs, updatedAt };
}

it('normalizes URL identity without collapsing distinct queries', () => {
  expect(normalizeSavedTabUrl('HTTPS://Example.COM:443/a?x=1#first')).toBe(
    'https://example.com/a?x=1',
  );
  expect(normalizeSavedTabUrl('https://example.com/a?x=2')).toBe(
    'https://example.com/a?x=2',
  );
  expect(normalizeSavedTabUrl('not a url')).toBeNull();
});

it('keeps the newest saved copy and removes emptied sessions', () => {
  const older = session('older', '2026-07-10T00:00:00.000Z', [
    tab('old-copy', 'https://example.com/read#old', '2026-07-10T00:00:00.000Z'),
  ]);
  const newer = session('newer', '2026-07-11T00:00:00.000Z', [
    tab('new-copy', 'https://example.com/read#new', '2026-07-11T00:00:00.000Z'),
  ]);

  expect(deduplicateSessionsByUrl([older, newer])).toEqual([newer]);
});

it('uses tab creation time before stable IDs when session update times tie', () => {
  const olderTab = session('a-session', '2026-07-11T00:00:00.000Z', [
    tab('a-tab', 'https://example.com/read#old', '2026-07-10T00:00:00.000Z'),
  ]);
  const newerTab = session('z-session', '2026-07-11T00:00:00.000Z', [
    tab('z-tab', 'https://example.com/read#new', '2026-07-11T00:00:00.000Z'),
  ]);

  expect(deduplicateSessionsByUrl([olderTab, newerTab])).toEqual([newerTab]);
});

it('uses stable IDs when duplicate ranking timestamps fully tie', () => {
  const stableWinner = session('a-session', '2026-07-11T00:00:00.000Z', [
    tab('a-tab', 'https://example.com/read#a', '2026-07-11T00:00:00.000Z'),
  ]);
  const stableLoser = session('z-session', '2026-07-11T00:00:00.000Z', [
    tab('z-tab', 'https://example.com/read#z', '2026-07-11T00:00:00.000Z'),
  ]);

  expect(deduplicateSessionsByUrl([stableLoser, stableWinner])).toEqual([stableWinner]);
});

it('keeps the last duplicate in one incoming save batch', () => {
  expect(
    deduplicateIncomingTabs([
      tab('first', 'https://example.com/read#one', '2026-07-11T00:00:00.000Z'),
      tab('last', 'https://example.com/read#two', '2026-07-11T00:00:00.000Z'),
    ]).map(({ id }) => id),
  ).toEqual(['last']);
});

it('deduplicates duplicate-id occurrences without retaining every matching occurrence', () => {
  const malicious = session('session', '2026-07-11T00:00:00.000Z', [
    tab('duplicate', 'https://example.com/read#first', '2026-07-11T00:00:00.000Z'),
    tab('duplicate', 'https://example.com/read#second', '2026-07-11T00:00:00.000Z'),
  ]);

  expect(deduplicateSessionsByUrl([malicious])[0]?.tabs).toHaveLength(1);
});

it('keeps distinct URLs even when malicious input reuses a tab id', () => {
  const malicious = session('session', '2026-07-11T00:00:00.000Z', [
    tab('duplicate', 'https://example.com/one', '2026-07-11T00:00:00.000Z'),
    tab('duplicate', 'https://example.com/two', '2026-07-11T00:00:00.000Z'),
  ]);

  expect(
    deduplicateSessionsByUrl([malicious])[0]?.tabs.map(({ url }) => url),
  ).toEqual(['https://example.com/one', 'https://example.com/two']);
});

it('sorts explicit session order before the created-at fallback', () => {
  expect(
    sortSessionsForDisplay([
      { ...baseSession, id: 'second', sortOrder: 1 },
      { ...baseSession, id: 'first', sortOrder: 0 },
    ]).map(({ id }) => id),
  ).toEqual(['first', 'second']);
});

it('sorts legacy sessions newest first by createdAt', () => {
  expect(
    sortSessionsForDisplay([
      { ...baseSession, id: 'older', createdAt: '2026-07-01T00:00:00.000Z' },
      { ...baseSession, id: 'newer', createdAt: '2026-07-02T00:00:00.000Z' },
    ]).map(({ id }) => id),
  ).toEqual(['newer', 'older']);
});

it('uses stable session ids when display ordering fully ties', () => {
  expect(
    sortSessionsForDisplay([
      { ...baseSession, id: 'z-session', sortOrder: 0 },
      { ...baseSession, id: 'a-session', sortOrder: 0 },
    ]).map(({ id }) => id),
  ).toEqual(['a-session', 'z-session']);
});

describe('mergeSessionsById', () => {
  it('keeps local-only sessions, adds remote-only sessions, and lets remote win on matching IDs', () => {
    const localOnly: TabSession = { ...baseSession, id: 'local-only', title: 'Local only' };
    const sharedLocal: TabSession = { ...baseSession, id: 'shared', title: 'Local shared' };
    const sharedRemote: TabSession = {
      ...baseSession,
      id: 'shared',
      title: 'Remote shared',
      deviceId: 'remote-device',
      updatedAt: '2026-07-07T00:00:00.000Z',
    };
    const remoteOnly: TabSession = {
      ...baseSession,
      id: 'remote-only',
      title: 'Remote only',
      deviceId: 'remote-device',
    };

    const merged = mergeSessionsById([localOnly, sharedLocal], [sharedRemote, remoteOnly]);

    expect(merged.map((session) => session.id).sort()).toEqual([
      'local-only',
      'remote-only',
      'shared',
    ]);
    expect(merged.find((session) => session.id === 'shared')?.title).toBe('Remote shared');
  });
});

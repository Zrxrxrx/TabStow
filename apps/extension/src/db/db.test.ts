import 'fake-indexeddb/auto';

import Dexie, { type Table } from 'dexie';
import type { SavedTab, TabSession } from '@tabstow/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const DATABASE_NAME = 'tabstow';

let openDatabase: { close(): void } | undefined;

function makeTab(id: string, url: string, createdAt: string): SavedTab {
  return {
    id,
    url,
    title: id,
    createdAt,
  };
}

function makeSession(
  id: string,
  url: string,
  createdAt: string,
  updatedAt = createdAt,
): TabSession {
  return {
    id,
    title: id,
    tabs: [makeTab(`${id}-tab`, url, createdAt)],
    createdAt,
    updatedAt,
    deviceId: 'device',
  };
}

async function seedVersionOne(sessions: TabSession[]): Promise<void> {
  class VersionOneDatabase extends Dexie {
    sessions!: Table<TabSession, string>;

    constructor() {
      super(DATABASE_NAME);
      this.version(1).stores({
        sessions: 'id, createdAt, updatedAt, deviceId',
      });
    }
  }

  const database = new VersionOneDatabase();
  await database.sessions.bulkPut(sessions);
  database.close();
}

async function importDatabase() {
  const databaseModule = await import('./db');
  openDatabase = databaseModule.db;
  return databaseModule;
}

beforeEach(async () => {
  vi.restoreAllMocks();
  openDatabase?.close();
  openDatabase = undefined;
  await Dexie.delete(DATABASE_NAME);
  vi.resetModules();
});

describe('session database', () => {
  it('migrates existing sessions to explicit display order', async () => {
    const newerSession = makeSession(
      'newer',
      'https://example.com/newer',
      '2026-07-02T00:00:00.000Z',
    );
    const olderSession = makeSession(
      'older',
      'https://example.com/older',
      '2026-07-01T00:00:00.000Z',
    );

    await seedVersionOne([newerSession, olderSession]);
    const { listSessions } = await importDatabase();

    expect((await listSessions()).map(({ id, sortOrder }) => [id, sortOrder])).toEqual([
      ['newer', 0],
      ['older', 1],
    ]);
  });

  it('deduplicates old sessions when saving a newest copy', async () => {
    const oldSessionWithHashedUrl = makeSession(
      'old',
      'https://example.com/article#old',
      '2026-07-01T00:00:00.000Z',
    );
    const newSessionWithSameNormalizedUrl = makeSession(
      'new',
      'https://example.com/article',
      '2026-07-02T00:00:00.000Z',
    );
    const { createSession, listSessions } = await importDatabase();

    await createSession(oldSessionWithHashedUrl);
    await createSession(newSessionWithSameNormalizedUrl);

    expect((await listSessions()).map(({ id }) => id)).toEqual(['new']);
  });

  it('deduplicates tabs within a newly saved session', async () => {
    const session = makeSession(
      'session',
      'https://example.com/article#first',
      '2026-07-01T00:00:00.000Z',
    );
    session.tabs.push(
      makeTab('last-tab', 'https://example.com/article', '2026-07-02T00:00:00.000Z'),
    );
    const { createSession } = await importDatabase();

    const saved = await createSession(session);

    expect(saved.tabs.map(({ id }) => id)).toEqual(['last-tab']);
  });

  it('persists explicit session reorder', async () => {
    const first = makeSession(
      'first',
      'https://example.com/first',
      '2026-07-01T00:00:00.000Z',
    );
    const second = makeSession(
      'second',
      'https://example.com/second',
      '2026-07-02T00:00:00.000Z',
    );
    const { createSession, reorderSessions, listSessions } = await importDatabase();

    await createSession(first);
    await createSession(second);
    await reorderSessions(['first', 'second']);

    expect((await listSessions()).map(({ id }) => id)).toEqual(['first', 'second']);
  });

  it('rejects an incomplete session reorder without changing stored order', async () => {
    const first = makeSession(
      'first',
      'https://example.com/first',
      '2026-07-01T00:00:00.000Z',
    );
    const second = makeSession(
      'second',
      'https://example.com/second',
      '2026-07-02T00:00:00.000Z',
    );
    const { createSession, reorderSessions, listSessions } = await importDatabase();
    await createSession(first);
    await createSession(second);

    await expect(reorderSessions(['first'])).rejects.toThrow(
      'orderedIds must contain every session ID exactly once',
    );
    expect((await listSessions()).map(({ id }) => id)).toEqual(['second', 'first']);
  });

  it('replaces stale rows when importing a deduplicated merged set', async () => {
    const stale = makeSession(
      'stale',
      'https://example.com/stale',
      '2026-07-01T00:00:00.000Z',
    );
    const replacement = makeSession(
      'replacement',
      'https://example.com/replacement',
      '2026-07-02T00:00:00.000Z',
    );
    const { createSession, importSessions, listSessions } = await importDatabase();

    await createSession(stale);
    await importSessions([replacement]);

    expect((await listSessions()).map(({ id }) => id)).toEqual(['replacement']);
  });

  it('deduplicates imported sessions before replacing stored rows', async () => {
    const older = makeSession(
      'older',
      'https://example.com/article#older',
      '2026-07-01T00:00:00.000Z',
    );
    const newer = makeSession(
      'newer',
      'https://example.com/article',
      '2026-07-02T00:00:00.000Z',
    );
    const { importSessions, listSessions } = await importDatabase();

    await importSessions([older, newer]);

    expect((await listSessions()).map(({ id, sortOrder }) => [id, sortOrder])).toEqual([
      ['newer', 0],
    ]);
  });

  it('atomically moves one saved tab into History', async () => {
    const source = makeSession(
      'source',
      'https://example.com/one',
      '2026-07-01T00:00:00.000Z',
    );
    source.tabs.push(
      makeTab('tab-2', 'https://example.com/two', '2026-07-02T00:00:00.000Z'),
    );
    const {
      createSession,
      getSession,
      listHistory,
      moveSavedTabToHistory,
    } = await importDatabase();
    await createSession(source);

    const moved = await moveSavedTabToHistory('source', 'source-tab', 'opened');

    expect(moved).toMatchObject({
      sourceSessionId: 'source',
      sourceTitle: 'source',
      originalCreatedAt: '2026-07-01T00:00:00.000Z',
      reason: 'opened',
      deviceId: 'device',
    });
    expect(moved.tabs.map(({ id }) => id)).toEqual(['source-tab']);
    expect((await getSession('source'))?.tabs.map(({ id }) => id)).toEqual(['tab-2']);
    expect((await getSession('source'))?.updatedAt).not.toBe(source.updatedAt);
    expect((await listHistory()).map(({ id }) => id)).toEqual([moved.id]);
  });

  it('moves only the located saved tab when another tab shares its ID', async () => {
    const source = makeSession(
      'source',
      'https://example.com/selected',
      '2026-07-01T00:00:00.000Z',
    );
    source.tabs.push(
      makeTab(
        'source-tab',
        'https://example.com/duplicate-id',
        '2026-07-02T00:00:00.000Z',
      ),
    );
    const { createSession, getSession, moveSavedTabToHistory } = await importDatabase();
    await createSession(source);

    const moved = await moveSavedTabToHistory('source', 'source-tab', 'opened');

    expect(moved.tabs.map(({ url }) => url)).toEqual(['https://example.com/selected']);
    expect((await getSession('source'))?.tabs.map(({ url }) => url)).toEqual([
      'https://example.com/duplicate-id',
    ]);
  });

  it('deletes the source session when its final tab moves into History', async () => {
    const source = makeSession(
      'source',
      'https://example.com/only',
      '2026-07-01T00:00:00.000Z',
    );
    const { createSession, getSession, moveSavedTabToHistory } = await importDatabase();
    await createSession(source);

    await moveSavedTabToHistory('source', 'source-tab', 'deleted');

    expect(await getSession('source')).toBeUndefined();
  });

  it('atomically moves a complete saved session into History', async () => {
    const source = makeSession(
      'source',
      'https://example.com/one',
      '2026-07-01T00:00:00.000Z',
    );
    source.tabs.push(
      makeTab('tab-2', 'https://example.com/two', '2026-07-02T00:00:00.000Z'),
    );
    const {
      createSession,
      getSession,
      listHistory,
      moveSessionToHistory,
    } = await importDatabase();
    await createSession(source);

    const moved = await moveSessionToHistory('source', 'deleted');

    expect(await getSession('source')).toBeUndefined();
    expect(moved.tabs.map(({ id }) => id)).toEqual(['source-tab', 'tab-2']);
    expect((await listHistory())[0]).toEqual(moved);
    expect((await listHistory())[0]?.reason).toBe('deleted');
  });

  it('lists History entries newest first', async () => {
    const older = makeSession(
      'older',
      'https://example.com/older',
      '2026-07-01T00:00:00.000Z',
    );
    const newer = makeSession(
      'newer',
      'https://example.com/newer',
      '2026-07-02T00:00:00.000Z',
    );
    const { createSession, db, listHistory, moveSessionToHistory } = await importDatabase();
    await createSession(older);
    const olderEntry = await moveSessionToHistory('older', 'deleted');
    await createSession(newer);
    const newerEntry = await moveSessionToHistory('newer', 'deleted');
    await db.history.update(olderEntry.id, { movedAt: '2026-07-10T00:00:00.000Z' });
    await db.history.update(newerEntry.id, { movedAt: '2026-07-11T00:00:00.000Z' });

    expect((await listHistory()).map(({ id }) => id)).toEqual([
      newerEntry.id,
      olderEntry.id,
    ]);
  });

  it('rolls back Saved and History when a move transaction aborts', async () => {
    const historyId = '00000000-0000-4000-8000-000000000001';
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(historyId);
    const first = makeSession(
      'first',
      'https://example.com/first',
      '2026-07-01T00:00:00.000Z',
    );
    const second = makeSession(
      'second',
      'https://example.com/second',
      '2026-07-02T00:00:00.000Z',
    );
    second.tabs.push(
      makeTab('second-kept', 'https://example.com/kept', '2026-07-03T00:00:00.000Z'),
    );
    const {
      createSession,
      getSession,
      listHistory,
      moveSavedTabToHistory,
    } = await importDatabase();
    await createSession(first);
    await moveSavedTabToHistory('first', 'first-tab', 'opened');
    await createSession(second);
    const savedBefore = await getSession('second');
    const historyBefore = await listHistory();

    await expect(
      moveSavedTabToHistory('second', 'second-tab', 'opened'),
    ).rejects.toThrow();

    expect(await getSession('second')).toEqual(savedBefore);
    expect(await listHistory()).toEqual(historyBefore);
  });

  it('restores History as a newest session and deduplicates existing Saved URLs', async () => {
    const source = makeSession(
      'source',
      'https://example.com/read',
      '2026-07-01T00:00:00.000Z',
    );
    const existing = makeSession(
      'existing',
      'https://example.com/read#existing',
      '2026-07-02T00:00:00.000Z',
    );
    existing.tabs.push(
      makeTab('existing-kept', 'https://example.com/kept', '2026-07-03T00:00:00.000Z'),
    );
    const {
      createSession,
      getHistoryEntry,
      getSession,
      listSessions,
      moveSessionToHistory,
      restoreHistoryEntry,
    } = await importDatabase();
    await createSession(source);
    const historyEntry = await moveSessionToHistory('source', 'deleted');
    await createSession(existing);

    const restored = await restoreHistoryEntry(historyEntry.id);

    expect(restored.id).not.toBe('source');
    expect(restored.tabs.map(({ url }) => url)).toEqual(['https://example.com/read']);
    expect(restored.sortOrder).toBe(0);
    expect(restored.createdAt).toBe(restored.updatedAt);
    expect((await getSession('existing'))?.tabs.map(({ id }) => id)).toEqual([
      'existing-kept',
    ]);
    expect((await getSession('existing'))?.updatedAt).not.toBe(existing.updatedAt);
    expect((await listSessions()).map(({ id }) => id)).toEqual([restored.id, 'existing']);
    expect(await getHistoryEntry(historyEntry.id)).toBeUndefined();
  });

  it('rolls back Saved changes when a History restore transaction fails', async () => {
    const source = makeSession(
      'source',
      'https://example.com/source',
      '2026-07-01T00:00:00.000Z',
    );
    const existing = makeSession(
      'existing',
      'https://example.com/existing',
      '2026-07-02T00:00:00.000Z',
    );
    const {
      createSession,
      db,
      listHistory,
      listSessions,
      moveSessionToHistory,
      restoreHistoryEntry,
    } = await importDatabase();
    await createSession(source);
    const historyEntry = await moveSessionToHistory('source', 'deleted');
    await createSession(existing);
    const sessionsBefore = await listSessions();
    const historyBefore = await listHistory();
    vi.spyOn(db.history, 'delete').mockRejectedValueOnce(new Error('delete failed'));

    await expect(restoreHistoryEntry(historyEntry.id)).rejects.toThrow('delete failed');

    expect(await listSessions()).toEqual(sessionsBefore);
    expect(await listHistory()).toEqual(historyBefore);
  });

  it('permanently deletes only the selected History entry', async () => {
    const source = makeSession(
      'source',
      'https://example.com/source',
      '2026-07-01T00:00:00.000Z',
    );
    const kept = makeSession(
      'kept',
      'https://example.com/kept',
      '2026-07-02T00:00:00.000Z',
    );
    const {
      createSession,
      deleteHistoryEntry,
      getHistoryEntry,
      getSession,
      moveSessionToHistory,
    } = await importDatabase();
    await createSession(source);
    const historyEntry = await moveSessionToHistory('source', 'deleted');
    await createSession(kept);

    await deleteHistoryEntry(historyEntry.id);

    expect(await getHistoryEntry(historyEntry.id)).toBeUndefined();
    expect(await getSession('kept')).toBeDefined();
  });

  it('moves a saved tab between sessions at the requested index', async () => {
    const source = makeSession(
      'source',
      'https://example.com/one',
      '2026-07-01T00:00:00.000Z',
    );
    source.tabs.push(
      makeTab('tab-2', 'https://example.com/two', '2026-07-02T00:00:00.000Z'),
    );
    const destination = makeSession(
      'destination',
      'https://example.com/destination',
      '2026-07-03T00:00:00.000Z',
    );
    const { createSession, getSession, moveSavedTab } = await importDatabase();
    await createSession(source);
    await createSession(destination);

    await moveSavedTab({
      sourceSessionId: 'source',
      tabId: 'tab-2',
      destinationSessionId: 'destination',
      destinationIndex: 1,
    });

    expect((await getSession('source'))?.tabs.map(({ id }) => id)).toEqual(['source-tab']);
    expect((await getSession('destination'))?.tabs.map(({ id }) => id)).toEqual([
      'destination-tab',
      'tab-2',
    ]);
    expect((await getSession('source'))?.updatedAt).not.toBe(source.updatedAt);
    expect((await getSession('destination'))?.updatedAt).not.toBe(destination.updatedAt);
  });

  it('deletes an emptied source session after moving its final tab', async () => {
    const source = makeSession(
      'source',
      'https://example.com/source',
      '2026-07-01T00:00:00.000Z',
    );
    const destination = makeSession(
      'destination',
      'https://example.com/destination',
      '2026-07-02T00:00:00.000Z',
    );
    const { createSession, getSession, moveSavedTab } = await importDatabase();
    await createSession(source);
    await createSession(destination);

    await moveSavedTab({
      sourceSessionId: 'source',
      tabId: 'source-tab',
      destinationSessionId: 'destination',
      destinationIndex: 1,
    });

    expect(await getSession('source')).toBeUndefined();
    expect((await getSession('destination'))?.tabs.map(({ id }) => id)).toEqual([
      'destination-tab',
      'source-tab',
    ]);
  });

  it('reorders a saved tab within one session at the exact requested index', async () => {
    const source = makeSession(
      'source',
      'https://example.com/one',
      '2026-07-01T00:00:00.000Z',
    );
    source.tabs.push(
      makeTab('tab-2', 'https://example.com/two', '2026-07-02T00:00:00.000Z'),
      makeTab('tab-3', 'https://example.com/three', '2026-07-03T00:00:00.000Z'),
    );
    const { createSession, getSession, moveSavedTab } = await importDatabase();
    await createSession(source);

    await moveSavedTab({
      sourceSessionId: 'source',
      tabId: 'source-tab',
      destinationSessionId: 'source',
      destinationIndex: 2,
    });

    expect((await getSession('source'))?.tabs.map(({ id }) => id)).toEqual([
      'tab-2',
      'tab-3',
      'source-tab',
    ]);
    expect((await getSession('source'))?.updatedAt).not.toBe(source.updatedAt);
  });

  it('rejects an invalid saved-tab destination index without changing either table', async () => {
    const source = makeSession(
      'source',
      'https://example.com/source',
      '2026-07-01T00:00:00.000Z',
    );
    const destination = makeSession(
      'destination',
      'https://example.com/destination',
      '2026-07-02T00:00:00.000Z',
    );
    const { createSession, listHistory, listSessions, moveSavedTab } = await importDatabase();
    await createSession(source);
    await createSession(destination);
    const sessionsBefore = await listSessions();

    await expect(
      moveSavedTab({
        sourceSessionId: 'source',
        tabId: 'source-tab',
        destinationSessionId: 'destination',
        destinationIndex: 2,
      }),
    ).rejects.toThrow('Invalid destination index: 2');

    expect(await listSessions()).toEqual(sessionsBefore);
    expect(await listHistory()).toEqual([]);
  });
});

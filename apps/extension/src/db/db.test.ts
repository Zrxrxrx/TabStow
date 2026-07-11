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
});

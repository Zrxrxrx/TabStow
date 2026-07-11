import Dexie, { type Table } from 'dexie';
import {
  deduplicateIncomingTabs,
  deduplicateSessionsByUrl,
  normalizeSavedTabUrl,
  sortSessionsForDisplay,
  sortSessionsNewestFirst,
  tabSessionSchema,
  type TabSession,
} from '@tabstow/core';

class TabstowDatabase extends Dexie {
  sessions!: Table<TabSession, string>;

  constructor() {
    super('tabstow');
    this.version(1).stores({
      sessions: 'id, createdAt, updatedAt, deviceId',
    });
    this.version(2)
      .stores({
        sessions: 'id, createdAt, updatedAt, deviceId, sortOrder',
        history: 'id, movedAt, sourceSessionId, reason',
      })
      .upgrade(async (transaction) => {
        const table = transaction.table<TabSession, string>('sessions');
        const sessions = sortSessionsNewestFirst(await table.toArray());
        await table.bulkPut(sessions.map((session, sortOrder) => ({ ...session, sortOrder })));
      });
  }
}

export const db = new TabstowDatabase();

async function insertNewestSession(session: TabSession): Promise<TabSession> {
  return db.transaction('rw', db.sessions, async () => {
    const incomingUrls = new Set(
      session.tabs
        .map(({ url }) => normalizeSavedTabUrl(url))
        .filter((url): url is string => url !== null),
    );
    const existingSessions = sortSessionsForDisplay(await db.sessions.toArray());
    const survivors = existingSessions
      .filter(({ id }) => id !== session.id)
      .map((existingSession) => ({
        ...existingSession,
        tabs: existingSession.tabs.filter((tab) => {
          const normalizedUrl = normalizeSavedTabUrl(tab.url);
          return normalizedUrl === null || !incomingUrls.has(normalizedUrl);
        }),
      }))
      .filter(({ tabs }) => tabs.length > 0)
      .map((existingSession, index) => ({ ...existingSession, sortOrder: index + 1 }));
    const newestSession = { ...session, sortOrder: 0 };

    await db.sessions.clear();
    await db.sessions.bulkPut([newestSession, ...survivors]);

    return newestSession;
  });
}

export async function createSession(session: TabSession): Promise<TabSession> {
  const parsed = tabSessionSchema.parse(session);
  const uniqueIncomingTabs = deduplicateIncomingTabs(parsed.tabs);
  return insertNewestSession({ ...parsed, tabs: uniqueIncomingTabs });
}

export async function listSessions(): Promise<TabSession[]> {
  const sessions = await db.sessions.toArray();
  return sortSessionsForDisplay(sessions);
}

export async function getSession(id: string): Promise<TabSession | undefined> {
  return db.sessions.get(id);
}

export async function deleteSession(id: string): Promise<void> {
  await db.sessions.delete(id);
}

export async function updateSession(session: TabSession): Promise<TabSession> {
  const parsed = tabSessionSchema.parse(session);
  await db.sessions.put(parsed);
  return parsed;
}

export async function clearSessions(): Promise<void> {
  await db.sessions.clear();
}

export async function exportSessions(): Promise<TabSession[]> {
  return listSessions();
}

export async function reorderSessions(orderedIds: string[]): Promise<TabSession[]> {
  await db.transaction('rw', db.sessions, async () => {
    const sessions = await db.sessions.toArray();
    const sessionIds = new Set(sessions.map(({ id }) => id));
    const orderedIdSet = new Set(orderedIds);

    if (
      orderedIds.length !== sessions.length ||
      orderedIdSet.size !== sessions.length ||
      orderedIds.some((id) => !sessionIds.has(id))
    ) {
      throw new Error('orderedIds must contain every session ID exactly once');
    }

    await Promise.all(
      orderedIds.map((id, sortOrder) => db.sessions.update(id, { sortOrder })),
    );
  });

  return listSessions();
}

export async function importSessions(sessions: TabSession[]): Promise<TabSession[]> {
  const parsed = sessions.map((session) => tabSessionSchema.parse(session));

  return db.transaction('rw', db.sessions, async () => {
    const deduplicated = deduplicateSessionsByUrl(parsed).map((session, sortOrder) => ({
      ...session,
      sortOrder,
    }));

    await db.sessions.clear();
    await db.sessions.bulkPut(deduplicated);

    return deduplicated;
  });
}

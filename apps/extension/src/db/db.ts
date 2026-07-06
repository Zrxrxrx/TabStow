import Dexie, { type Table } from 'dexie';
import { sortSessionsNewestFirst, tabSessionSchema, type TabSession } from '@tabstow/core';

class TabstowDatabase extends Dexie {
  sessions!: Table<TabSession, string>;

  constructor() {
    super('tabstow');
    this.version(1).stores({
      sessions: 'id, createdAt, updatedAt, deviceId',
    });
  }
}

export const db = new TabstowDatabase();

export async function createSession(session: TabSession): Promise<TabSession> {
  const parsed = tabSessionSchema.parse(session);
  await db.sessions.put(parsed);
  return parsed;
}

export async function listSessions(): Promise<TabSession[]> {
  const sessions = await db.sessions.toArray();
  return sortSessionsNewestFirst(sessions);
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

export async function importSessions(sessions: TabSession[]): Promise<TabSession[]> {
  const parsed = sessions.map((session) => tabSessionSchema.parse(session));
  await db.transaction('rw', db.sessions, async () => {
    await db.sessions.bulkPut(parsed);
  });
  return listSessions();
}

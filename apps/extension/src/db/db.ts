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
import type {
  HistoryEntry,
  HistoryReason,
  MoveSavedTabRequest,
} from '@/features/history/types';

class TabstowDatabase extends Dexie {
  sessions!: Table<TabSession, string>;
  history!: Table<HistoryEntry, string>;

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

async function insertNewestSessionInCurrentTransaction(
  session: TabSession,
  survivorsUpdatedAt?: string,
): Promise<TabSession> {
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
    .map((existingSession, index) => ({
      ...existingSession,
      sortOrder: index + 1,
      ...(survivorsUpdatedAt ? { updatedAt: survivorsUpdatedAt } : {}),
    }));
  const newestSession = { ...session, sortOrder: 0 };

  await db.sessions.clear();
  await db.sessions.bulkPut([newestSession, ...survivors]);

  return newestSession;
}

async function insertNewestSession(session: TabSession): Promise<TabSession> {
  return db.transaction('rw', db.sessions, () =>
    insertNewestSessionInCurrentTransaction(session),
  );
}

function createHistoryEntry(
  session: TabSession,
  tabs: TabSession['tabs'],
  reason: HistoryReason,
  movedAt: string,
): HistoryEntry {
  return {
    id: crypto.randomUUID(),
    sourceSessionId: session.id,
    sourceTitle: session.title,
    tabs,
    originalCreatedAt: session.createdAt,
    movedAt,
    reason,
    deviceId: session.deviceId,
  };
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

export async function listHistory(): Promise<HistoryEntry[]> {
  const entries = await db.history.toArray();
  return entries.sort(
    (a, b) => b.movedAt.localeCompare(a.movedAt) || a.id.localeCompare(b.id),
  );
}

export async function getHistoryEntry(id: string): Promise<HistoryEntry | undefined> {
  return db.history.get(id);
}

export async function moveSavedTabToHistory(
  sourceSessionId: string,
  tabId: string,
  reason: HistoryReason,
): Promise<HistoryEntry> {
  return db.transaction('rw', db.sessions, db.history, async () => {
    const source = await db.sessions.get(sourceSessionId);
    if (!source) throw new Error(`Session not found: ${sourceSessionId}`);

    const tabIndex = source.tabs.findIndex(({ id }) => id === tabId);
    if (tabIndex < 0) throw new Error(`Saved tab not found: ${tabId}`);

    const remainingTabs = [...source.tabs];
    const [tab] = remainingTabs.splice(tabIndex, 1);
    if (!tab) throw new Error(`Saved tab not found: ${tabId}`);

    const movedAt = new Date().toISOString();
    const entry = createHistoryEntry(source, [tab], reason, movedAt);

    if (remainingTabs.length === 0) {
      await db.sessions.delete(source.id);
    } else {
      await db.sessions.put({ ...source, tabs: remainingTabs, updatedAt: movedAt });
    }
    await db.history.add(entry);

    return entry;
  });
}

export async function moveSessionToHistory(
  sourceSessionId: string,
  reason: HistoryReason,
): Promise<HistoryEntry> {
  return db.transaction('rw', db.sessions, db.history, async () => {
    const source = await db.sessions.get(sourceSessionId);
    if (!source) throw new Error(`Session not found: ${sourceSessionId}`);

    const entry = createHistoryEntry(source, source.tabs, reason, new Date().toISOString());
    await db.sessions.delete(source.id);
    await db.history.add(entry);

    return entry;
  });
}

export async function restoreHistoryEntry(id: string): Promise<TabSession> {
  return db.transaction('rw', db.sessions, db.history, async () => {
    const entry = await db.history.get(id);
    if (!entry) throw new Error(`History entry not found: ${id}`);

    const restoredAt = new Date().toISOString();
    const restored = await insertNewestSessionInCurrentTransaction(
      {
        id: crypto.randomUUID(),
        title: entry.sourceTitle,
        tabs: deduplicateIncomingTabs(entry.tabs),
        createdAt: restoredAt,
        updatedAt: restoredAt,
        sortOrder: 0,
        deviceId: entry.deviceId,
      },
      restoredAt,
    );
    await db.history.delete(id);

    return restored;
  });
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.history, async () => {
    if (!(await db.history.get(id))) throw new Error(`History entry not found: ${id}`);
    await db.history.delete(id);
  });
}

export async function moveSavedTab(request: MoveSavedTabRequest): Promise<void> {
  await db.transaction('rw', db.sessions, db.history, async () => {
    const source = await db.sessions.get(request.sourceSessionId);
    if (!source) throw new Error(`Session not found: ${request.sourceSessionId}`);

    const tabIndex = source.tabs.findIndex(({ id }) => id === request.tabId);
    if (tabIndex < 0) throw new Error(`Saved tab not found: ${request.tabId}`);

    const destination =
      request.destinationSessionId === source.id
        ? source
        : await db.sessions.get(request.destinationSessionId);
    if (!destination) throw new Error(`Session not found: ${request.destinationSessionId}`);

    const sourceTabs = [...source.tabs];
    const [tab] = sourceTabs.splice(tabIndex, 1);
    if (!tab) throw new Error(`Saved tab not found: ${request.tabId}`);

    const maximumDestinationIndex =
      source.id === destination.id ? sourceTabs.length : destination.tabs.length;
    if (
      !Number.isInteger(request.destinationIndex) ||
      request.destinationIndex < 0 ||
      request.destinationIndex > maximumDestinationIndex
    ) {
      throw new Error(`Invalid destination index: ${request.destinationIndex}`);
    }

    const updatedAt = new Date().toISOString();
    if (source.id === destination.id) {
      sourceTabs.splice(request.destinationIndex, 0, tab);
      await db.sessions.put({ ...source, tabs: sourceTabs, updatedAt });
      return;
    }

    const destinationTabs = [...destination.tabs];
    destinationTabs.splice(request.destinationIndex, 0, tab);
    if (sourceTabs.length === 0) {
      await db.sessions.delete(source.id);
    } else {
      await db.sessions.put({ ...source, tabs: sourceTabs, updatedAt });
    }
    await db.sessions.put({ ...destination, tabs: destinationTabs, updatedAt });
  });
}

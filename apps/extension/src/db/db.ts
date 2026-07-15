import Dexie, { type Table, type Transaction } from 'dexie';
import {
  canonicalSyncFingerprint,
  deduplicateIncomingTabs,
  deduplicateSessionsByUrl,
  mergeSyncDocuments,
  mergeSessionsById,
  normalizeSavedTabUrl,
  positionBetween,
  positionsForCount,
  repairDuplicateTabIds,
  savedTabSchema,
  sortSessionsForDisplay,
  sortSessionsNewestFirst,
  tabSessionSchema,
  type SyncDeletion,
  type SyncDocumentV2,
  type SyncPreference,
  type SyncQuickLinkEntity,
  type SyncRevision,
  type SyncSessionEntity,
  type SyncTabEntity,
  type TabSession,
} from '@tabstow/core';
import type { QuickLink, QuickLinkIcon } from '@/features/quick-links/quick-links';
import type {
  HistoryEntry,
  HistoryReason,
  MoveSavedTabRequest,
} from '@/features/history/types';

const SYNC_META_ID = 'state';
const SYNC_QUIET_PERIOD_MS = 60_000;

type StoredSyncQuickLink = SyncQuickLinkEntity & {
  localImageToken?: string;
};

type StoredSyncDeletion = SyncDeletion & {
  key: string;
};

type SyncMeta = {
  id: typeof SYNC_META_ID;
  replicaId: string;
  lamportCounter: number;
  preferences: {
    includePinnedTabs: SyncPreference;
    closePinnedTabs: SyncPreference;
  };
  preferencesInitialized: boolean;
  pendingGeneration: number;
  syncedGeneration: number;
  dueAt?: number;
  lastExportedAt?: string;
};

class TabstowDatabase extends Dexie {
  sessions!: Table<TabSession, string>;
  history!: Table<HistoryEntry, string>;
  syncSessions!: Table<SyncSessionEntity, string>;
  syncTabs!: Table<SyncTabEntity, string>;
  syncQuickLinks!: Table<StoredSyncQuickLink, string>;
  syncDeletions!: Table<StoredSyncDeletion, string>;
  syncMeta!: Table<SyncMeta, string>;

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
        const sessions = transaction.table<TabSession, string>('sessions');
        const history = transaction.table<HistoryEntry, string>('history');
        await migrateSessions(sessions);
        await migrateHistory(history);
      });
    this.version(3)
      .stores({
        sessions: 'id, createdAt, updatedAt, deviceId, sortOrder',
        history: 'id, movedAt, sourceSessionId, reason',
      })
      .upgrade(async (transaction) => {
        const sessions = transaction.table<TabSession, string>('sessions');
        const history = transaction.table<HistoryEntry, string>('history');
        await migrateSessions(sessions);
        await migrateHistory(history);
      });
    this.version(4)
      .stores({
        sessions: 'id, createdAt, updatedAt, deviceId, sortOrder',
        history: 'id, movedAt, sourceSessionId, reason',
        syncSessions: 'id, position',
        syncTabs: 'id, sessionId, position',
        syncQuickLinks: 'id, position, createdAt',
        syncDeletions: 'key, entityType, entityId',
        syncMeta: 'id',
      })
      .upgrade(migrateSyncTables);
  }
}

function prepareSessionsForStorage(sessions: TabSession[]): TabSession[] {
  return deduplicateSessionsByUrl(
    sessions.map((session) => ({
      ...session,
      tabs: repairDuplicateTabIds(session.tabs),
    })),
  ).map((session, sortOrder) => ({ ...session, sortOrder }));
}

async function migrateSessions(table: Table<TabSession, string>): Promise<void> {
  const migrated = prepareSessionsForStorage(
    sortSessionsNewestFirst(await table.toArray()),
  );
  await table.clear();
  await table.bulkPut(migrated);
}

function prepareHistoryTabs(tabs: HistoryEntry['tabs']): HistoryEntry['tabs'] {
  return repairDuplicateTabIds(tabs).map((tab) => savedTabSchema.parse(tab));
}

async function migrateHistory(table: Table<HistoryEntry, string>): Promise<void> {
  const entries = await table.toArray();
  await table.bulkPut(
    entries.map((entry) => ({ ...entry, tabs: prepareHistoryTabs(entry.tabs) })),
  );
}

function nextRevision(meta: SyncMeta): SyncRevision {
  meta.lamportCounter += 1;
  return { counter: meta.lamportCounter, replicaId: meta.replicaId };
}

function createMeta(replicaId: string): SyncMeta {
  return {
    id: SYNC_META_ID,
    replicaId,
    lamportCounter: 0,
    preferences: {
      includePinnedTabs: { value: false, revision: { counter: 0, replicaId } },
      closePinnedTabs: { value: false, revision: { counter: 0, replicaId } },
    },
    preferencesInitialized: false,
    pendingGeneration: 0,
    syncedGeneration: 0,
  };
}

async function migrateSyncTables(transaction: Transaction): Promise<void> {
  const sessionsTable = transaction.table<TabSession, string>('sessions');
  const syncSessions = transaction.table<SyncSessionEntity, string>('syncSessions');
  const syncTabs = transaction.table<SyncTabEntity, string>('syncTabs');
  const syncMeta = transaction.table<SyncMeta, string>('syncMeta');
  const sessions = prepareSessionsForStorage(await sessionsTable.toArray());
  if (sessions.length === 0) return;

  const replicaId = crypto.randomUUID();
  const meta = createMeta(replicaId);
  const sessionPositions = positionsForCount(sessions.length);
  const migratedSessions: SyncSessionEntity[] = [];
  const migratedTabs: SyncTabEntity[] = [];

  sessions.forEach((session, sessionIndex) => {
    migratedSessions.push({
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      position: sessionPositions[sessionIndex]!,
      revision: nextRevision(meta),
    });
    const tabPositions = positionsForCount(session.tabs.length);
    session.tabs.forEach((tab, tabIndex) => {
      migratedTabs.push({
        id: tab.id,
        sessionId: session.id,
        url: tab.url,
        title: tab.title,
        ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
        ...(typeof tab.pinned === 'boolean' ? { pinned: tab.pinned } : {}),
        createdAt: tab.createdAt,
        position: tabPositions[tabIndex]!,
        revision: nextRevision(meta),
      });
    });
  });

  meta.pendingGeneration = 1;
  meta.dueAt = Date.now() + SYNC_QUIET_PERIOD_MS;
  await syncSessions.bulkPut(migratedSessions);
  await syncTabs.bulkPut(migratedTabs);
  await syncMeta.put(meta);
}

export const db = new TabstowDatabase();

function deletionKey(
  deletion: Pick<SyncDeletion, 'entityType' | 'entityId'>,
): string {
  return `${deletion.entityType}:${deletion.entityId}`;
}

async function getOrCreateMetaInTransaction(
  preferredReplicaId?: string,
): Promise<SyncMeta> {
  const stored = await db.syncMeta.get(SYNC_META_ID);
  if (stored) return stored;

  const meta = createMeta(preferredReplicaId || crypto.randomUUID());
  await db.syncMeta.put(meta);
  return meta;
}

function markPending(meta: SyncMeta, now = Date.now()): void {
  meta.pendingGeneration += 1;
  meta.dueAt = now + SYNC_QUIET_PERIOD_MS;
}

function entityContent<T extends { revision: SyncRevision }>(entity: T): Omit<T, 'revision'> {
  const { revision: _revision, ...content } = entity;
  return content;
}

function entitiesHaveSameContent<T extends { revision: SyncRevision }>(left: T, right: T): boolean {
  return JSON.stringify(entityContent(left)) === JSON.stringify(entityContent(right));
}

function isSameIdOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function findSingleMovedId(currentIds: string[], desiredIds: string[]): string | null {
  if (currentIds.length !== desiredIds.length) return null;
  if (new Set(currentIds).size !== currentIds.length) return null;
  if (!desiredIds.every((id) => currentIds.includes(id))) return null;

  for (const id of desiredIds) {
    if (
      isSameIdOrder(
        currentIds.filter((candidate) => candidate !== id),
        desiredIds.filter((candidate) => candidate !== id),
      )
    ) {
      return id;
    }
  }
  return null;
}

function assignPositions<T extends { id: string; position: string }>(
  desiredIds: string[],
  currentEntities: T[],
): Map<string, string> {
  const currentById = new Map(currentEntities.map((entity) => [entity.id, entity]));
  const currentIds = [...currentEntities]
    .sort(
      (left, right) =>
        left.position.localeCompare(right.position) || left.id.localeCompare(right.id),
    )
    .map(({ id }) => id);
  const commonCurrent = currentIds.filter((id) => desiredIds.includes(id));
  const commonDesired = desiredIds.filter((id) => currentById.has(id));
  const result = new Map<string, string>();

  if (isSameIdOrder(commonCurrent, commonDesired)) {
    for (const id of commonDesired) {
      const position = currentById.get(id)?.position;
      if (position) result.set(id, position);
    }
  } else {
    const movedId = findSingleMovedId(commonCurrent, commonDesired);
    if (movedId) {
      for (const id of commonDesired) {
        if (id === movedId) continue;
        const position = currentById.get(id)?.position;
        if (position) result.set(id, position);
      }
    }
  }

  try {
    for (let index = 0; index < desiredIds.length; index += 1) {
      const id = desiredIds[index]!;
      if (result.has(id)) continue;

      let left: string | undefined;
      for (let leftIndex = index - 1; leftIndex >= 0; leftIndex -= 1) {
        const position = result.get(desiredIds[leftIndex]!);
        if (position) {
          left = position;
          break;
        }
      }

      let right: string | undefined;
      for (let rightIndex = index + 1; rightIndex < desiredIds.length; rightIndex += 1) {
        const position = result.get(desiredIds[rightIndex]!);
        if (position) {
          right = position;
          break;
        }
      }

      result.set(id, positionBetween(left, right));
    }
    return result;
  } catch {
    const rebalanced = positionsForCount(desiredIds.length);
    return new Map(desiredIds.map((id, index) => [id, rebalanced[index]!]));
  }
}

async function putDeletion(
  deletion: SyncDeletion,
): Promise<void> {
  const key = deletionKey(deletion);
  await db.syncDeletions.put({ ...deletion, key });
}

async function reconcileSessionReadModelInTransaction(
  meta: SyncMeta,
  nowIso: string,
): Promise<boolean> {
  const sessions = sortSessionsForDisplay(await db.sessions.toArray());
  const currentSessions = await db.syncSessions.toArray();
  const currentTabs = await db.syncTabs.toArray();
  const currentSessionById = new Map(currentSessions.map((entity) => [entity.id, entity]));
  const currentTabById = new Map(currentTabs.map((entity) => [entity.id, entity]));
  const sessionPositions = assignPositions(
    sessions.map(({ id }) => id),
    currentSessions,
  );
  let changed = false;

  for (const session of sessions) {
    const candidate: SyncSessionEntity = {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      position: sessionPositions.get(session.id)!,
      revision: { counter: 0, replicaId: meta.replicaId },
    };
    const current = currentSessionById.get(session.id);
    if (!current || !entitiesHaveSameContent(current, candidate)) {
      await db.syncSessions.put({ ...candidate, revision: nextRevision(meta) });
      await db.syncDeletions.delete(`session:${session.id}`);
      changed = true;
    }

    const currentSessionTabs = currentTabs.filter(
      (tab) => tab.sessionId === session.id && session.tabs.some(({ id }) => id === tab.id),
    );
    const tabPositions = assignPositions(
      session.tabs.map(({ id }) => id),
      currentSessionTabs,
    );
    for (const tab of session.tabs) {
      const tabCandidate: SyncTabEntity = {
        id: tab.id,
        sessionId: session.id,
        url: tab.url,
        title: tab.title,
        ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
        ...(typeof tab.pinned === 'boolean' ? { pinned: tab.pinned } : {}),
        createdAt: tab.createdAt,
        position: tabPositions.get(tab.id)!,
        revision: { counter: 0, replicaId: meta.replicaId },
      };
      const currentTab = currentTabById.get(tab.id);
      if (!currentTab || !entitiesHaveSameContent(currentTab, tabCandidate)) {
        await db.syncTabs.put({ ...tabCandidate, revision: nextRevision(meta) });
        await db.syncDeletions.delete(`tab:${tab.id}`);
        changed = true;
      }
    }
  }

  const desiredSessionIds = new Set(sessions.map(({ id }) => id));
  const desiredTabIds = new Set(sessions.flatMap(({ tabs }) => tabs.map(({ id }) => id)));
  for (const entity of currentTabs) {
    if (desiredTabIds.has(entity.id)) continue;
    await db.syncTabs.delete(entity.id);
    await putDeletion({
      entityType: 'tab',
      entityId: entity.id,
      deletedAt: nowIso,
      revision: nextRevision(meta),
    });
    changed = true;
  }
  for (const entity of currentSessions) {
    if (desiredSessionIds.has(entity.id)) continue;
    await db.syncSessions.delete(entity.id);
    await putDeletion({
      entityType: 'session',
      entityId: entity.id,
      deletedAt: nowIso,
      revision: nextRevision(meta),
    });
    changed = true;
  }

  if (changed) markPending(meta);
  await db.syncMeta.put(meta);
  return changed;
}

async function buildSyncDocumentInTransaction(meta: SyncMeta): Promise<SyncDocumentV2> {
  const deletions = await db.syncDeletions.toArray();
  return {
    format: 'tabstow',
    schemaVersion: 2,
    exportedAt: meta.lastExportedAt ?? new Date().toISOString(),
    sessions: await db.syncSessions.toArray(),
    tabs: await db.syncTabs.toArray(),
    quickLinks: (await db.syncQuickLinks.toArray()).map(
      ({ localImageToken: _localImageToken, ...entity }) => entity,
    ),
    preferences: meta.preferences,
    deletions: deletions.map(({ key: _key, ...deletion }) => deletion),
  };
}

function maximumRevisionCounter(document: SyncDocumentV2): number {
  return Math.max(
    document.preferences.includePinnedTabs.revision.counter,
    document.preferences.closePinnedTabs.revision.counter,
    ...document.sessions.map(({ revision }) => revision.counter),
    ...document.tabs.map(({ revision }) => revision.counter),
    ...document.quickLinks.map(({ revision }) => revision.counter),
    ...document.deletions.map(({ revision }) => revision.counter),
  );
}

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
    .map((existingSession) => {
      const tabs = existingSession.tabs.filter((tab) => {
        const normalizedUrl = normalizeSavedTabUrl(tab.url);
        return normalizedUrl === null || !incomingUrls.has(normalizedUrl);
      });
      return { existingSession, tabs, tabsChanged: tabs.length !== existingSession.tabs.length };
    })
    .map(({ existingSession, tabs, tabsChanged }) => ({
      ...existingSession,
      tabs,
      ...(survivorsUpdatedAt && tabsChanged ? { updatedAt: survivorsUpdatedAt } : {}),
    }))
    .filter(({ tabs }) => tabs.length > 0)
    .map((existingSession, index) => ({
      ...existingSession,
      sortOrder: index + 1,
    }));
  const newestSession = { ...session, sortOrder: 0 };

  await db.sessions.clear();
  await db.sessions.bulkPut([newestSession, ...survivors]);

  return newestSession;
}

async function insertNewestSession(session: TabSession): Promise<TabSession> {
  return db.transaction(
    'rw',
    [db.sessions, db.syncSessions, db.syncTabs, db.syncDeletions, db.syncMeta],
    async () => {
      const meta = await getOrCreateMetaInTransaction(session.deviceId);
      const inserted = await insertNewestSessionInCurrentTransaction(session);
      await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());
      return inserted;
    },
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
    tabs: prepareHistoryTabs(tabs),
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

export async function createSessionsBatch(
  sessions: TabSession[],
): Promise<TabSession[]> {
  const parsed = tabSessionSchema.array().parse(sessions);
  const incomingSessionIds = new Set<string>();
  for (const session of parsed) {
    if (incomingSessionIds.has(session.id)) {
      throw new Error('Session IDs must be unique within a batch.');
    }
    incomingSessionIds.add(session.id);
  }

  if (parsed.length === 0) return [];

  return db.transaction(
    'rw',
    [db.sessions, db.syncSessions, db.syncTabs, db.syncDeletions, db.syncMeta],
    async () => {
      const existingSessions = sortSessionsForDisplay(await db.sessions.toArray());
      const existingSessionIds = new Set(existingSessions.map(({ id }) => id));
      const reservedTabIds = new Set(
        existingSessions.flatMap(({ tabs }) => tabs.map(({ id }) => id)),
      );
      const reservedUrls = new Set(
        existingSessions.flatMap(({ tabs }) =>
          tabs
            .map(({ url }) => normalizeSavedTabUrl(url))
            .filter((url): url is string => url !== null),
        ),
      );
      const created: TabSession[] = [];

      for (const session of parsed) {
        if (existingSessionIds.has(session.id)) {
          throw new Error(`Session ID already exists: ${session.id}`);
        }

        const tabs = session.tabs.filter((tab) => {
          const normalizedUrl = normalizeSavedTabUrl(tab.url);
          if (normalizedUrl !== null && reservedUrls.has(normalizedUrl)) return false;

          if (reservedTabIds.has(tab.id)) {
            throw new Error(`Saved tab ID already exists: ${tab.id}`);
          }

          reservedTabIds.add(tab.id);
          if (normalizedUrl !== null) reservedUrls.add(normalizedUrl);
          return true;
        });

        if (tabs.length === 0) continue;
        created.push({ ...session, tabs, sortOrder: created.length });
      }

      if (created.length === 0) return [];

      const shiftedExisting = existingSessions.map((session, index) => ({
        ...session,
        sortOrder: created.length + index,
      }));
      await db.sessions.clear();
      await db.sessions.bulkPut([...created, ...shiftedExisting]);

      const meta = await getOrCreateMetaInTransaction(created[0]?.deviceId);
      await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());

      return created;
    },
  );
}

export async function listSessions(): Promise<TabSession[]> {
  const sessions = await db.sessions.toArray();
  return sortSessionsForDisplay(sessions);
}

export async function getSession(id: string): Promise<TabSession | undefined> {
  return db.sessions.get(id);
}

export async function deleteSession(id: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.sessions, db.syncSessions, db.syncTabs, db.syncDeletions, db.syncMeta],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
      await db.sessions.delete(id);
      await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());
    },
  );
}

export async function updateSession(session: TabSession): Promise<TabSession> {
  const parsed = tabSessionSchema.parse(session);
  await db.transaction(
    'rw',
    [db.sessions, db.syncSessions, db.syncTabs, db.syncDeletions, db.syncMeta],
    async () => {
      const meta = await getOrCreateMetaInTransaction(parsed.deviceId);
      await db.sessions.put(parsed);
      await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());
    },
  );
  return parsed;
}

export async function clearSessions(): Promise<void> {
  await db.transaction(
    'rw',
    [db.sessions, db.syncSessions, db.syncTabs, db.syncDeletions, db.syncMeta],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
      await db.sessions.clear();
      await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());
    },
  );
}

export async function exportSessions(): Promise<TabSession[]> {
  return listSessions();
}

export async function reorderSessions(orderedIds: string[]): Promise<TabSession[]> {
  await db.transaction(
    'rw',
    [db.sessions, db.syncSessions, db.syncTabs, db.syncDeletions, db.syncMeta],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
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
      await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());
    },
  );

  return listSessions();
}

export async function importSessions(sessions: TabSession[]): Promise<TabSession[]> {
  const parsed = sessions.map((session) => tabSessionSchema.parse(session));

  return db.transaction(
    'rw',
    [db.sessions, db.syncSessions, db.syncTabs, db.syncDeletions, db.syncMeta],
    async () => {
      const meta = await getOrCreateMetaInTransaction(parsed[0]?.deviceId);
      const deduplicated = prepareSessionsForStorage(parsed);

      await db.sessions.clear();
      await db.sessions.bulkPut(deduplicated);

      await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());

      return deduplicated;
    },
  );
}

export async function mergeRemoteSessions(
  remoteSessions: TabSession[],
): Promise<TabSession[]> {
  const parsedRemote = remoteSessions.map((session) => tabSessionSchema.parse(session));

  return db.transaction(
    'rw',
    [db.sessions, db.syncSessions, db.syncTabs, db.syncDeletions, db.syncMeta],
    async () => {
      const meta = await getOrCreateMetaInTransaction(parsedRemote[0]?.deviceId);
      const currentSessions = await db.sessions.toArray();
      const merged = prepareSessionsForStorage(
        mergeSessionsById(currentSessions, parsedRemote),
      );

      await db.sessions.clear();
      await db.sessions.bulkPut(merged);

      await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());

      return merged;
    },
  );
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
  return db.transaction(
    'rw',
    [
      db.sessions,
      db.history,
      db.syncSessions,
      db.syncTabs,
      db.syncDeletions,
      db.syncMeta,
    ],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
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

      await reconcileSessionReadModelInTransaction(meta, movedAt);

      return entry;
    },
  );
}

export async function moveSessionToHistory(
  sourceSessionId: string,
  reason: HistoryReason,
): Promise<HistoryEntry> {
  return db.transaction(
    'rw',
    [
      db.sessions,
      db.history,
      db.syncSessions,
      db.syncTabs,
      db.syncDeletions,
      db.syncMeta,
    ],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
      const source = await db.sessions.get(sourceSessionId);
      if (!source) throw new Error(`Session not found: ${sourceSessionId}`);

      const entry = createHistoryEntry(
        source,
        source.tabs,
        reason,
        new Date().toISOString(),
      );
      await db.sessions.delete(source.id);
      await db.history.add(entry);
      await reconcileSessionReadModelInTransaction(meta, entry.movedAt);

      return entry;
    },
  );
}

export async function restoreHistoryEntry(id: string): Promise<TabSession> {
  return db.transaction(
    'rw',
    [
      db.sessions,
      db.history,
      db.syncSessions,
      db.syncTabs,
      db.syncDeletions,
      db.syncMeta,
    ],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
      const entry = await db.history.get(id);
      if (!entry) throw new Error(`History entry not found: ${id}`);

      const restoredAt = new Date().toISOString();
      const restored = await insertNewestSessionInCurrentTransaction(
        {
          id: crypto.randomUUID(),
          title: entry.sourceTitle,
          tabs: deduplicateIncomingTabs(prepareHistoryTabs(entry.tabs)).map((tab) => ({
            ...tab,
            id: crypto.randomUUID(),
            createdAt: restoredAt,
          })),
          createdAt: restoredAt,
          updatedAt: restoredAt,
          sortOrder: 0,
          deviceId: entry.deviceId,
        },
        restoredAt,
      );
      await db.history.delete(id);
      await reconcileSessionReadModelInTransaction(meta, restoredAt);

      return restored;
    },
  );
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await db.transaction('rw', db.sessions, db.history, async () => {
    if (!(await db.history.get(id))) throw new Error(`History entry not found: ${id}`);
    await db.history.delete(id);
  });
}

export async function moveSavedTab(request: MoveSavedTabRequest): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.sessions,
      db.history,
      db.syncSessions,
      db.syncTabs,
      db.syncDeletions,
      db.syncMeta,
    ],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
      const source = await db.sessions.get(request.sourceSessionId);
      if (!source) throw new Error(`Session not found: ${request.sourceSessionId}`);

      const tabIndex = source.tabs.findIndex(({ id }) => id === request.tabId);
      if (tabIndex < 0) throw new Error(`Saved tab not found: ${request.tabId}`);

      const destination =
        request.destinationSessionId === source.id
          ? source
          : await db.sessions.get(request.destinationSessionId);
      if (!destination) {
        throw new Error(`Session not found: ${request.destinationSessionId}`);
      }

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
        await reconcileSessionReadModelInTransaction(meta, updatedAt);
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
      await reconcileSessionReadModelInTransaction(meta, updatedAt);
    },
  );
}

export type SyncSnapshot = {
  document: SyncDocumentV2;
  replicaId: string;
  pendingGeneration: number;
  syncedGeneration: number;
  dueAt?: number;
};

export async function getSyncSnapshot(
  preferredReplicaId?: string,
): Promise<SyncSnapshot> {
  return db.transaction(
    'rw',
    [
      db.sessions,
      db.syncSessions,
      db.syncTabs,
      db.syncQuickLinks,
      db.syncDeletions,
      db.syncMeta,
    ],
    async () => {
      const meta = await getOrCreateMetaInTransaction(preferredReplicaId);
      if ((await db.syncSessions.count()) === 0 && (await db.sessions.count()) > 0) {
        await reconcileSessionReadModelInTransaction(meta, new Date().toISOString());
      }
      return {
        document: await buildSyncDocumentInTransaction(meta),
        replicaId: meta.replicaId,
        pendingGeneration: meta.pendingGeneration,
        syncedGeneration: meta.syncedGeneration,
        ...(meta.dueAt === undefined ? {} : { dueAt: meta.dueAt }),
      };
    },
  );
}

function toReadModelSessions(
  document: SyncDocumentV2,
  currentSessions: TabSession[],
): TabSession[] {
  const currentById = new Map(currentSessions.map((session) => [session.id, session]));
  const tabsBySession = new Map<string, SyncTabEntity[]>();
  for (const tab of document.tabs) {
    const tabs = tabsBySession.get(tab.sessionId) ?? [];
    tabs.push(tab);
    tabsBySession.set(tab.sessionId, tabs);
  }

  return [...document.sessions]
    .sort(
      (left, right) =>
        left.position.localeCompare(right.position) || left.id.localeCompare(right.id),
    )
    .map((session, sortOrder) => {
      const current = currentById.get(session.id);
      const tabs = (tabsBySession.get(session.id) ?? [])
        .sort(
          (left, right) =>
            left.position.localeCompare(right.position) || left.id.localeCompare(right.id),
        )
        .map((tab) => ({
          id: tab.id,
          url: tab.url,
          title: tab.title,
          ...(tab.favIconUrl ? { favIconUrl: tab.favIconUrl } : {}),
          ...(typeof tab.pinned === 'boolean' ? { pinned: tab.pinned } : {}),
          createdAt: tab.createdAt,
        }));

      return tabSessionSchema.parse({
        id: session.id,
        title: session.title || `${tabs.length} tabs stowed`,
        tabs,
        ...(current?.sourceWindowId === undefined
          ? {}
          : { sourceWindowId: current.sourceWindowId }),
        sortOrder,
        createdAt: session.createdAt,
        updatedAt: current?.updatedAt ?? session.createdAt,
        deviceId: session.revision.replicaId,
      });
    });
}

export type RemoteApplyResult = {
  document: SyncDocumentV2;
  removedImageTokens: string[];
  pendingGeneration: number;
};

export async function applyRemoteSyncDocument(
  remote: SyncDocumentV2,
): Promise<RemoteApplyResult> {
  return db.transaction(
    'rw',
    [
      db.sessions,
      db.syncSessions,
      db.syncTabs,
      db.syncQuickLinks,
      db.syncDeletions,
      db.syncMeta,
    ],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
      const local = await buildSyncDocumentInTransaction(meta);
      const merged = mergeSyncDocuments(local, remote);
      const currentSessions = await db.sessions.toArray();
      const currentQuickLinks = await db.syncQuickLinks.toArray();
      const currentQuickLinksById = new Map(
        currentQuickLinks.map((quickLink) => [quickLink.id, quickLink]),
      );
      const nextQuickLinkIds = new Set(merged.quickLinks.map(({ id }) => id));
      const removedImageTokens = currentQuickLinks
        .filter(({ id, localImageToken }) => localImageToken && !nextQuickLinkIds.has(id))
        .map(({ localImageToken }) => localImageToken!);

      await db.syncSessions.clear();
      await db.syncSessions.bulkPut(merged.sessions);
      await db.syncTabs.clear();
      await db.syncTabs.bulkPut(merged.tabs);
      await db.syncQuickLinks.clear();
      await db.syncQuickLinks.bulkPut(
        merged.quickLinks.map((quickLink) => {
          const localImageToken = currentQuickLinksById.get(quickLink.id)?.localImageToken;
          return localImageToken ? { ...quickLink, localImageToken } : quickLink;
        }),
      );
      await db.syncDeletions.clear();
      await db.syncDeletions.bulkPut(
        merged.deletions.map((deletion) => ({
          ...deletion,
          key: deletionKey(deletion),
        })),
      );
      await db.sessions.clear();
      await db.sessions.bulkPut(toReadModelSessions(merged, currentSessions));

      meta.preferences = merged.preferences;
      meta.preferencesInitialized = true;
      meta.lamportCounter = Math.max(
        meta.lamportCounter,
        maximumRevisionCounter(merged),
      );
      if (
        canonicalSyncFingerprint(merged) !== canonicalSyncFingerprint(remote) &&
        meta.pendingGeneration <= meta.syncedGeneration
      ) {
        markPending(meta);
      }
      await db.syncMeta.put(meta);

      return {
        document: merged,
        removedImageTokens,
        pendingGeneration: meta.pendingGeneration,
      };
    },
  );
}

export async function getReplicaId(preferredReplicaId?: string): Promise<string> {
  const snapshot = await getSyncSnapshot(preferredReplicaId);
  return snapshot.replicaId;
}

export async function initializeSyncPreferences(
  initial: { includePinnedTabs: boolean; closePinnedTabs: boolean },
  preferredReplicaId?: string,
): Promise<{ includePinnedTabs: boolean; closePinnedTabs: boolean }> {
  return db.transaction('rw', db.syncMeta, async () => {
    const meta = await getOrCreateMetaInTransaction(preferredReplicaId);
    if (!meta.preferencesInitialized) {
      for (const key of ['includePinnedTabs', 'closePinnedTabs'] as const) {
        if (initial[key] !== meta.preferences[key].value) {
          meta.preferences[key] = {
            value: initial[key],
            revision: nextRevision(meta),
          };
        }
      }
      meta.preferencesInitialized = true;
      await db.syncMeta.put(meta);
    }
    return {
      includePinnedTabs: meta.preferences.includePinnedTabs.value,
      closePinnedTabs: meta.preferences.closePinnedTabs.value,
    };
  });
}

export async function getSyncPreferences(): Promise<{
  includePinnedTabs: boolean;
  closePinnedTabs: boolean;
}> {
  const meta = await db.transaction('rw', db.syncMeta, () =>
    getOrCreateMetaInTransaction(),
  );
  return {
    includePinnedTabs: meta.preferences.includePinnedTabs.value,
    closePinnedTabs: meta.preferences.closePinnedTabs.value,
  };
}

export async function updateSyncPreferences(
  partial: Partial<{ includePinnedTabs: boolean; closePinnedTabs: boolean }>,
): Promise<{ includePinnedTabs: boolean; closePinnedTabs: boolean }> {
  return db.transaction('rw', db.syncMeta, async () => {
    const meta = await getOrCreateMetaInTransaction();
    let changed = false;
    for (const key of ['includePinnedTabs', 'closePinnedTabs'] as const) {
      const value = partial[key];
      if (typeof value !== 'boolean' || value === meta.preferences[key].value) continue;
      meta.preferences[key] = { value, revision: nextRevision(meta) };
      changed = true;
    }
    if (changed) markPending(meta);
    meta.preferencesInitialized = true;
    await db.syncMeta.put(meta);
    return {
      includePinnedTabs: meta.preferences.includePinnedTabs.value,
      closePinnedTabs: meta.preferences.closePinnedTabs.value,
    };
  });
}

export async function markSyncGenerationComplete(
  generation: number,
  exportedAt: string,
): Promise<boolean> {
  return db.transaction('rw', db.syncMeta, async () => {
    const meta = await getOrCreateMetaInTransaction();
    if (meta.pendingGeneration !== generation) return false;
    meta.syncedGeneration = Math.max(meta.syncedGeneration, generation);
    meta.dueAt = undefined;
    meta.lastExportedAt = exportedAt;
    await db.syncMeta.put(meta);
    return true;
  });
}

export async function reschedulePendingSync(dueAt: number): Promise<void> {
  await db.transaction('rw', db.syncMeta, async () => {
    const meta = await getOrCreateMetaInTransaction();
    if (meta.pendingGeneration <= meta.syncedGeneration) return;
    meta.dueAt = dueAt;
    await db.syncMeta.put(meta);
  });
}

function publicQuickLink(entity: StoredSyncQuickLink): QuickLink {
  return {
    id: entity.id,
    url: entity.url,
    label: entity.label,
    icon: entity.localImageToken
      ? { kind: 'image', value: entity.localImageToken }
      : entity.icon,
    createdAt: entity.createdAt,
  };
}

function synchronizedQuickLinkIcon(icon: QuickLinkIcon | null): SyncQuickLinkEntity['icon'] {
  if (icon?.kind === 'emoji') return icon;
  return { kind: 'site', value: null };
}

export async function listStoredQuickLinks(): Promise<QuickLink[]> {
  const links = await db.syncQuickLinks.toArray();
  return links
    .sort(
      (left, right) =>
        left.position.localeCompare(right.position) || left.id.localeCompare(right.id),
    )
    .map(publicQuickLink);
}

export async function replaceStoredQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  return db.transaction(
    'rw',
    [db.syncQuickLinks, db.syncDeletions, db.syncMeta],
    async () => {
      const meta = await getOrCreateMetaInTransaction();
      const current = await db.syncQuickLinks.toArray();
      const currentById = new Map(current.map((entity) => [entity.id, entity]));
      const positions = assignPositions(
        links.map(({ id }) => id),
        current,
      );
      let syncChanged = false;

      for (const link of links) {
        const stored = currentById.get(link.id);
        const localImageToken =
          link.icon?.kind === 'image' ? link.icon.value : undefined;
        const candidate: StoredSyncQuickLink = {
          id: link.id,
          url: link.url,
          label: link.label,
          icon:
            link.icon?.kind === 'image'
              ? stored?.icon ?? { kind: 'site', value: null }
              : synchronizedQuickLinkIcon(link.icon),
          createdAt: link.createdAt,
          position: positions.get(link.id)!,
          revision: { counter: 0, replicaId: meta.replicaId },
          ...(localImageToken ? { localImageToken } : {}),
        };

        if (!stored || !entitiesHaveSameContent(
          { ...stored, localImageToken: undefined },
          { ...candidate, localImageToken: undefined },
        )) {
          await db.syncQuickLinks.put({
            ...candidate,
            revision: nextRevision(meta),
          });
          await db.syncDeletions.delete(`quickLink:${link.id}`);
          syncChanged = true;
        } else if (stored.localImageToken !== candidate.localImageToken) {
          await db.syncQuickLinks.put({
            ...stored,
            ...(candidate.localImageToken
              ? { localImageToken: candidate.localImageToken }
              : { localImageToken: undefined }),
          });
        }
      }

      const desiredIds = new Set(links.map(({ id }) => id));
      for (const entity of current) {
        if (desiredIds.has(entity.id)) continue;
        await db.syncQuickLinks.delete(entity.id);
        await putDeletion({
          entityType: 'quickLink',
          entityId: entity.id,
          deletedAt: new Date().toISOString(),
          revision: nextRevision(meta),
        });
        syncChanged = true;
      }

      if (syncChanged) markPending(meta);
      await db.syncMeta.put(meta);
      return listStoredQuickLinks();
    },
  );
}

export async function importLegacyQuickLinks(links: QuickLink[]): Promise<QuickLink[]> {
  if ((await db.syncQuickLinks.count()) > 0 || links.length === 0) {
    return listStoredQuickLinks();
  }
  return replaceStoredQuickLinks(links);
}

export async function getLocalSyncCounts(): Promise<{
  sessionCount: number;
  tabCount: number;
  quickLinkCount: number;
}> {
  return {
    sessionCount: await db.syncSessions.count(),
    tabCount: await db.syncTabs.count(),
    quickLinkCount: await db.syncQuickLinks.count(),
  };
}

export async function isSyncRepositoryPristine(): Promise<boolean> {
  return db.transaction(
    'r',
    [
      db.syncSessions,
      db.syncTabs,
      db.syncQuickLinks,
      db.syncDeletions,
      db.syncMeta,
    ],
    async () => {
      const [sessionCount, tabCount, quickLinkCount, deletionCount, meta] =
        await Promise.all([
          db.syncSessions.count(),
          db.syncTabs.count(),
          db.syncQuickLinks.count(),
          db.syncDeletions.count(),
          db.syncMeta.get(SYNC_META_ID),
        ]);

      return (
        sessionCount === 0 &&
        tabCount === 0 &&
        quickLinkCount === 0 &&
        deletionCount === 0 &&
        (meta === undefined ||
          (meta.pendingGeneration === 0 &&
            meta.syncedGeneration === 0 &&
            meta.lastExportedAt === undefined &&
            meta.preferences.includePinnedTabs.revision.counter === 0 &&
            meta.preferences.closePinnedTabs.revision.counter === 0))
      );
    },
  );
}

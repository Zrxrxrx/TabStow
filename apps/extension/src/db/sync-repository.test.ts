import 'fake-indexeddb/auto';

import Dexie from 'dexie';
import {
  positionsForCount,
  type SyncDocumentV2,
  type TabSession,
} from '@tabstow/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const DATABASE_NAME = 'tabstow';
let openDatabase: { close(): void } | undefined;

async function repository() {
  const module = await import('./db');
  openDatabase = module.db;
  return module;
}

function session(id = 'session-1'): TabSession {
  const createdAt = '2026-07-12T00:00:00.000Z';
  return {
    id,
    title: 'Reading',
    tabs: [
      {
        id: `${id}-tab`,
        url: `https://example.com/${id}`,
        title: 'Example',
        createdAt,
      },
    ],
    createdAt,
    updatedAt: createdAt,
    deviceId: 'replica-local',
  };
}

beforeEach(async () => {
  openDatabase?.close();
  openDatabase = undefined;
  vi.resetModules();
  await Dexie.delete(DATABASE_NAME);
});

afterEach(() => {
  openDatabase?.close();
  openDatabase = undefined;
});

describe('sync repository', () => {
  it('creates a device-local replica ID when upgrading version 3 sessions', async () => {
    const legacyDatabase = new Dexie(DATABASE_NAME);
    legacyDatabase.version(3).stores({
      sessions: 'id, createdAt, updatedAt, deviceId, sortOrder',
      history: 'id, movedAt, sourceSessionId, reason',
    });
    await legacyDatabase.open();
    await legacyDatabase.table<TabSession, string>('sessions').put(
      session('legacy-session'),
    );
    legacyDatabase.close();

    const { getSyncSnapshot } = await repository();
    const snapshot = await getSyncSnapshot();

    expect(snapshot.replicaId).not.toBe('replica-local');
    expect(snapshot.replicaId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(snapshot.document.sessions[0]?.revision.replicaId).toBe(
      snapshot.replicaId,
    );
  });

  it('reports a never-used sync repository as pristine', async () => {
    const { isSyncRepositoryPristine } = await repository();

    await expect(isSyncRepositoryPristine()).resolves.toBe(true);
  });

  it('does not report a repository with only deletion markers as pristine', async () => {
    const {
      createSession,
      db,
      deleteSession,
      isSyncRepositoryPristine,
    } = await repository();
    await createSession(session());
    await deleteSession('session-1');
    await db.syncMeta.update('state', {
      pendingGeneration: 0,
      syncedGeneration: 0,
    });

    await expect(isSyncRepositoryPristine()).resolves.toBe(false);
  });

  it('does not report pending, completed, or previously exported state as pristine', async () => {
    const {
      isSyncRepositoryPristine,
      markSyncGenerationComplete,
      updateSyncPreferences,
    } = await repository();

    await updateSyncPreferences({ includePinnedTabs: true });
    await expect(isSyncRepositoryPristine()).resolves.toBe(false);

    await markSyncGenerationComplete(1, '2026-07-12T01:00:00.000Z');
    await expect(isSyncRepositoryPristine()).resolves.toBe(false);
  });

  it('does not report an otherwise empty previously synchronized repository as pristine', async () => {
    const { isSyncRepositoryPristine, markSyncGenerationComplete } =
      await repository();
    await markSyncGenerationComplete(0, '2026-07-12T01:00:00.000Z');

    await expect(isSyncRepositoryPristine()).resolves.toBe(false);
  });

  it('atomically records a created session and one pending generation', async () => {
    const { createSession, getSyncSnapshot } = await repository();

    await createSession(session());
    const snapshot = await getSyncSnapshot();

    expect(snapshot.document.sessions).toEqual([
      expect.objectContaining({ id: 'session-1', revision: expect.any(Object) }),
    ]);
    expect(snapshot.document.tabs).toEqual([
      expect.objectContaining({ id: 'session-1-tab', sessionId: 'session-1' }),
    ]);
    expect(snapshot.pendingGeneration).toBe(1);
    expect(snapshot.syncedGeneration).toBe(0);
    expect(snapshot.dueAt).toBeTypeOf('number');
  });

  it('creates tab and empty-session deletion markers in the same mutation', async () => {
    const { createSession, getSyncSnapshot, moveSavedTabToHistory } = await repository();
    await createSession(session());

    await moveSavedTabToHistory('session-1', 'session-1-tab', 'opened');
    const snapshot = await getSyncSnapshot();

    expect(snapshot.document.sessions).toEqual([]);
    expect(snapshot.document.tabs).toEqual([]);
    expect(snapshot.document.deletions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityType: 'tab', entityId: 'session-1-tab' }),
        expect.objectContaining({ entityType: 'session', entityId: 'session-1' }),
      ]),
    );
    expect(snapshot.pendingGeneration).toBe(2);
  });

  it('restores History with fresh session and tab identities', async () => {
    const {
      createSession,
      moveSessionToHistory,
      restoreHistoryEntry,
    } = await repository();
    await createSession(session());
    const history = await moveSessionToHistory('session-1', 'deleted');

    const restored = await restoreHistoryEntry(history.id);

    expect(restored.id).not.toBe('session-1');
    expect(restored.tabs[0]?.id).not.toBe('session-1-tab');
  });

  it('applies a winning remote deletion without adding History', async () => {
    const {
      applyRemoteSyncDocument,
      createSession,
      getSyncSnapshot,
      listHistory,
      listSessions,
    } = await repository();
    await createSession(session());
    const local = await getSyncSnapshot();
    const sessionRevision = local.document.sessions[0]!.revision;
    const tabRevision = local.document.tabs[0]!.revision;
    const remote: SyncDocumentV2 = {
      ...local.document,
      exportedAt: '2026-07-12T01:00:00.000Z',
      sessions: [],
      tabs: [],
      deletions: [
        {
          entityType: 'session',
          entityId: 'session-1',
          deletedAt: '2026-07-12T01:00:00.000Z',
          revision: { counter: sessionRevision.counter + 10, replicaId: 'replica-remote' },
        },
        {
          entityType: 'tab',
          entityId: 'session-1-tab',
          deletedAt: '2026-07-12T01:00:00.000Z',
          revision: { counter: tabRevision.counter + 10, replicaId: 'replica-remote' },
        },
      ],
    };

    await applyRemoteSyncDocument(remote);

    expect(await listSessions()).toEqual([]);
    expect(await listHistory()).toEqual([]);
  });

  it('applies independent remote preference revisions', async () => {
    const { applyRemoteSyncDocument, getSyncPreferences, getSyncSnapshot } =
      await repository();
    const local = await getSyncSnapshot('replica-local');
    const [position] = positionsForCount(1);
    expect(position).toBeTruthy();

    await applyRemoteSyncDocument({
      ...local.document,
      preferences: {
        includePinnedTabs: {
          value: true,
          revision: { counter: 10, replicaId: 'replica-remote' },
        },
        closePinnedTabs: local.document.preferences.closePinnedTabs,
      },
    });

    expect(await getSyncPreferences()).toEqual({
      includePinnedTabs: true,
      closePinnedTabs: false,
    });
  });

  it('lets synchronized preferences beat untouched defaults on a new device', async () => {
    const {
      applyRemoteSyncDocument,
      getSyncPreferences,
      getSyncSnapshot,
      initializeSyncPreferences,
    } = await repository();
    await initializeSyncPreferences(
      { includePinnedTabs: false, closePinnedTabs: false },
      'replica-new',
    );
    const local = await getSyncSnapshot();

    expect(local.document.preferences.includePinnedTabs.revision.counter).toBe(0);
    await applyRemoteSyncDocument({
      ...local.document,
      preferences: {
        ...local.document.preferences,
        includePinnedTabs: {
          value: true,
          revision: { counter: 1, replicaId: 'replica-existing' },
        },
      },
    });

    expect(await getSyncPreferences()).toEqual({
      includePinnedTabs: true,
      closePinnedTabs: false,
    });
  });

  it('keeps uploaded Quick Link images local without dirtying synchronized state', async () => {
    const {
      getSyncSnapshot,
      listStoredQuickLinks,
      replaceStoredQuickLinks,
    } = await repository();
    const createdAt = '2026-07-12T00:00:00.000Z';
    await replaceStoredQuickLinks([
      {
        id: 'quick-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'emoji', value: '*' },
        createdAt,
      },
    ]);
    const before = await getSyncSnapshot();

    await replaceStoredQuickLinks([
      {
        id: 'quick-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'image', value: 'quick-link-icon:local' },
        createdAt,
      },
    ]);
    const after = await getSyncSnapshot();

    expect(after.pendingGeneration).toBe(before.pendingGeneration);
    expect(after.document.quickLinks[0]?.icon).toEqual({ kind: 'emoji', value: '*' });
    expect((await listStoredQuickLinks())[0]?.icon).toEqual({
      kind: 'image',
      value: 'quick-link-icon:local',
    });
  });

  it('preserves a local Quick Link image across remote field updates and reports it on deletion', async () => {
    const {
      applyRemoteSyncDocument,
      getSyncSnapshot,
      listStoredQuickLinks,
      replaceStoredQuickLinks,
    } = await repository();
    const createdAt = '2026-07-12T00:00:00.000Z';
    await replaceStoredQuickLinks([
      {
        id: 'quick-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'site', value: null },
        createdAt,
      },
    ]);
    await replaceStoredQuickLinks([
      {
        id: 'quick-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'image', value: 'quick-link-icon:local' },
        createdAt,
      },
    ]);
    const snapshot = await getSyncSnapshot();
    const current = snapshot.document.quickLinks[0]!;
    await applyRemoteSyncDocument({
      ...snapshot.document,
      quickLinks: [
        {
          ...current,
          label: 'Remote label',
          revision: { counter: current.revision.counter + 10, replicaId: 'remote' },
        },
      ],
    });

    expect((await listStoredQuickLinks())[0]).toMatchObject({
      label: 'Remote label',
      icon: { kind: 'image', value: 'quick-link-icon:local' },
    });

    const afterUpdate = await getSyncSnapshot();
    const updated = afterUpdate.document.quickLinks[0]!;
    const deletion = await applyRemoteSyncDocument({
      ...afterUpdate.document,
      quickLinks: [],
      deletions: [
        {
          entityType: 'quickLink',
          entityId: 'quick-1',
          deletedAt: '2026-07-12T01:00:00.000Z',
          revision: { counter: updated.revision.counter + 10, replicaId: 'remote' },
        },
      ],
    });

    expect(deletion.removedImageTokens).toEqual(['quick-link-icon:local']);
    expect(await listStoredQuickLinks()).toEqual([]);
  });
});

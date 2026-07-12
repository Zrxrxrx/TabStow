import { beforeEach, describe, expect, it, vi } from 'vitest';
import { positionsForCount, type SyncDocumentV2 } from '@tabstow/core';
import { reconcileGist, SyncTargetError } from './sync-service';

const dbMocks = vi.hoisted(() => ({
  applyRemoteSyncDocument: vi.fn(),
  getSyncSnapshot: vi.fn(),
  listSessions: vi.fn(),
  markSyncGenerationComplete: vi.fn(),
}));

const connectionMocks = vi.hoisted(() => ({
  getConnectionRecord: vi.fn(),
}));

const gistMocks = vi.hoisted(() => ({
  getGist: vi.fn(),
  getFileContentFromGist: vi.fn(),
  updateFile: vi.fn(),
}));

vi.mock('@/db/db', () => dbMocks);
vi.mock('./connection-store', () => connectionMocks);
vi.mock('./gist-client', async (importOriginal) => {
  const original = await importOriginal<typeof import('./gist-client')>();
  return {
    ...original,
    GistClient: class {
      getGist = gistMocks.getGist;
      getFileContentFromGist = gistMocks.getFileContentFromGist;
      updateFile = gistMocks.updateFile;
    },
  };
});

const timestamp = '2026-07-12T00:00:00.000Z';

function document(title = 'Reading'): SyncDocumentV2 {
  const [position] = positionsForCount(1);
  return {
    format: 'tabstow',
    schemaVersion: 2,
    exportedAt: timestamp,
    sessions: [
      {
        id: 'session-1',
        title,
        createdAt: timestamp,
        position: position!,
        revision: { counter: 3, replicaId: 'replica-local' },
      },
    ],
    tabs: [],
    quickLinks: [],
    preferences: {
      includePinnedTabs: {
        value: false,
        revision: { counter: 1, replicaId: 'replica-local' },
      },
      closePinnedTabs: {
        value: false,
        revision: { counter: 2, replicaId: 'replica-local' },
      },
    },
    deletions: [],
  };
}

const gist = {
  id: 'gist-1',
  description: 'Tabstow',
  public: false,
  htmlUrl: 'https://gist.github.com/octocat/gist-1',
  owner: { id: 1, login: 'octocat' },
  files: { 'tabstow.sync.json': { content: '{}' } },
};

describe('Gist reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionMocks.getConnectionRecord.mockResolvedValue({
      generation: 1,
      phase: 'connected',
      token: 'oauth-token',
      account: { id: 1, login: 'octocat' },
      binding: {
        gistId: 'gist-1',
        fileName: 'tabstow.sync.json',
        public: false,
        htmlUrl: gist.htmlUrl,
        ownerId: 1,
      },
      sync: { state: 'pending' },
    });
    dbMocks.getSyncSnapshot.mockResolvedValue({
      document: document(),
      replicaId: 'replica-local',
      pendingGeneration: 4,
      syncedGeneration: 3,
      dueAt: Date.now(),
    });
    dbMocks.listSessions.mockResolvedValue([]);
    dbMocks.applyRemoteSyncDocument.mockImplementation(async (remote) => ({
      document: remote,
      removedImageTokens: [],
      pendingGeneration: 4,
    }));
    dbMocks.markSyncGenerationComplete.mockResolvedValue(true);
    gistMocks.getGist.mockResolvedValue(gist);
    gistMocks.getFileContentFromGist.mockResolvedValue(JSON.stringify(document()));
    gistMocks.updateFile.mockResolvedValue(undefined);
  });

  it('manual pull reads and merges without writing', async () => {
    const result = await reconcileGist({ write: false });

    expect(result).toMatchObject({ wrote: false, sessionCount: 1 });
    expect(dbMocks.applyRemoteSyncDocument).toHaveBeenCalledTimes(1);
    expect(gistMocks.updateFile).not.toHaveBeenCalled();
  });

  it('classifies an owner change as a rebinding problem', async () => {
    gistMocks.getGist.mockResolvedValue({
      ...gist,
      owner: { id: 2, login: 'someone-else' },
    });

    await expect(reconcileGist({ write: false })).rejects.toMatchObject({
      action: 'rebind',
    } satisfies Partial<SyncTargetError>);
  });

  it('aborts when the bound Gist changes even if an epoch were reused', async () => {
    const initialConnection = {
      generation: 1,
      phase: 'connected',
      token: 'oauth-token',
      account: { id: 1, login: 'octocat' },
      binding: {
        gistId: 'gist-1',
        fileName: 'tabstow.sync.json',
        public: false,
        htmlUrl: gist.htmlUrl,
        ownerId: 1,
      },
      sync: { state: 'pending' },
    } as const;
    connectionMocks.getConnectionRecord
      .mockResolvedValueOnce(initialConnection)
      .mockResolvedValue({
        ...initialConnection,
        binding: { ...initialConnection.binding, gistId: 'gist-2' },
      });

    await expect(reconcileGist({ write: false })).rejects.toThrow(
      'connection changed',
    );
    expect(dbMocks.applyRemoteSyncDocument).not.toHaveBeenCalled();
  });

  it('imports the complete tab set from a newer version-one session', async () => {
    const localDocument = document('Local');
    const tabPositions = positionsForCount(2);
    localDocument.tabs = [
      {
        id: 'tab-shared',
        sessionId: 'session-1',
        url: 'https://shared.example/',
        title: 'Local shared tab',
        createdAt: timestamp,
        position: tabPositions[0]!,
        revision: { counter: 5, replicaId: 'replica-local' },
      },
      {
        id: 'tab-local-only',
        sessionId: 'session-1',
        url: 'https://local.example/',
        title: 'Local-only tab',
        createdAt: timestamp,
        position: tabPositions[1]!,
        revision: { counter: 6, replicaId: 'replica-local' },
      },
    ];
    dbMocks.getSyncSnapshot.mockResolvedValue({
      document: localDocument,
      replicaId: 'replica-local',
      pendingGeneration: 4,
      syncedGeneration: 3,
    });
    dbMocks.listSessions.mockResolvedValue([
      {
        id: 'session-1',
        title: 'Local',
        tabs: [
          {
            id: 'tab-shared',
            url: 'https://shared.example/',
            title: 'Local shared tab',
            createdAt: timestamp,
          },
          {
            id: 'tab-local-only',
            url: 'https://local.example/',
            title: 'Local-only tab',
            createdAt: timestamp,
          },
        ],
        createdAt: timestamp,
        updatedAt: '2026-07-11T00:00:00.000Z',
        deviceId: 'replica-local',
      },
    ]);
    gistMocks.getFileContentFromGist.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'legacy-remote',
        exportedAt: timestamp,
        sessions: [
          {
            id: 'session-1',
            title: 'Remote v1 winner',
            tabs: [
              {
                id: 'tab-shared',
                url: 'https://shared.example/',
                title: 'Remote shared tab',
                createdAt: timestamp,
              },
              {
                id: 'tab-remote-only',
                url: 'https://remote.example/',
                title: 'Remote-only tab',
                createdAt: timestamp,
              },
            ],
            createdAt: timestamp,
            updatedAt: '2026-07-12T01:00:00.000Z',
            deviceId: 'legacy-remote',
          },
        ],
        quickLinks: [],
        settings: {
          deviceId: 'legacy-remote',
          includePinnedTabs: false,
          closePinnedTabs: false,
        },
      }),
    );
    dbMocks.applyRemoteSyncDocument.mockImplementation(async (remote) => ({
      document: remote,
      removedImageTokens: [],
      pendingGeneration: 4,
    }));

    await reconcileGist({ write: false });

    expect(dbMocks.applyRemoteSyncDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            title: 'Remote v1 winner',
            revision: { counter: 4, replicaId: 'replica-local' },
          }),
        ],
        tabs: [
          expect.objectContaining({
            id: 'tab-shared',
            title: 'Remote shared tab',
            revision: { counter: 6, replicaId: 'replica-local' },
          }),
          expect.objectContaining({ id: 'tab-remote-only' }),
        ],
        deletions: [
          expect.objectContaining({
            entityType: 'tab',
            entityId: 'tab-local-only',
            revision: { counter: 7, replicaId: 'replica-local' },
          }),
        ],
      }),
    );
  });

  it('keeps the complete tab set from a newer local session during version-one import', async () => {
    const localDocument = document('Local winner');
    const tabPositions = positionsForCount(2);
    localDocument.tabs = [
      {
        id: 'tab-shared',
        sessionId: 'session-1',
        url: 'https://shared.example/',
        title: 'Local shared tab',
        createdAt: timestamp,
        position: tabPositions[0]!,
        revision: { counter: 5, replicaId: 'replica-local' },
      },
      {
        id: 'tab-local-only',
        sessionId: 'session-1',
        url: 'https://local.example/',
        title: 'Local-only tab',
        createdAt: timestamp,
        position: tabPositions[1]!,
        revision: { counter: 6, replicaId: 'replica-local' },
      },
    ];
    dbMocks.getSyncSnapshot.mockResolvedValue({
      document: localDocument,
      replicaId: 'replica-local',
      pendingGeneration: 4,
      syncedGeneration: 3,
    });
    dbMocks.listSessions.mockResolvedValue([
      {
        id: 'session-1',
        title: 'Local winner',
        tabs: [
          {
            id: 'tab-shared',
            url: 'https://shared.example/',
            title: 'Local shared tab',
            createdAt: timestamp,
          },
          {
            id: 'tab-local-only',
            url: 'https://local.example/',
            title: 'Local-only tab',
            createdAt: timestamp,
          },
        ],
        createdAt: timestamp,
        updatedAt: '2026-07-12T02:00:00.000Z',
        deviceId: 'replica-local',
      },
    ]);
    gistMocks.getFileContentFromGist.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'legacy-remote',
        exportedAt: timestamp,
        sessions: [
          {
            id: 'session-1',
            title: 'Older remote v1',
            tabs: [
              {
                id: 'tab-shared',
                url: 'https://shared.example/',
                title: 'Older remote shared tab',
                createdAt: timestamp,
              },
              {
                id: 'tab-remote-only',
                url: 'https://remote.example/',
                title: 'Older remote-only tab',
                createdAt: timestamp,
              },
            ],
            createdAt: timestamp,
            updatedAt: '2026-07-11T00:00:00.000Z',
            deviceId: 'legacy-remote',
          },
        ],
        quickLinks: [],
        settings: {
          deviceId: 'legacy-remote',
          includePinnedTabs: false,
          closePinnedTabs: false,
        },
      }),
    );

    await reconcileGist({ write: false });

    expect(dbMocks.applyRemoteSyncDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: [
          expect.objectContaining({
            id: 'session-1',
            revision: { counter: 0, replicaId: 'replica-local' },
          }),
        ],
        tabs: [],
        deletions: [],
      }),
    );
  });

  it('skips PATCH when only exportedAt differs', async () => {
    gistMocks.getFileContentFromGist.mockResolvedValue(
      JSON.stringify({ ...document(), exportedAt: '2030-01-01T00:00:00.000Z' }),
    );

    const result = await reconcileGist({ write: true });

    expect(result.wrote).toBe(false);
    expect(gistMocks.updateFile).not.toHaveBeenCalled();
  });

  it('never initializes a missing file during ordinary push', async () => {
    gistMocks.getGist.mockResolvedValue({ ...gist, files: {} });

    await expect(reconcileGist({ write: true })).rejects.toThrow('not found');
    expect(gistMocks.updateFile).not.toHaveBeenCalled();
  });

  it('initializes a missing file only through the confirmed path', async () => {
    gistMocks.getGist
      .mockResolvedValueOnce({ ...gist, files: {} })
      .mockResolvedValueOnce(gist);
    gistMocks.getFileContentFromGist.mockResolvedValue(JSON.stringify(document()));

    const result = await reconcileGist({ write: true, allowInitialize: true });

    expect(result.wrote).toBe(true);
    expect(gistMocks.updateFile).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite invalid non-empty content', async () => {
    gistMocks.getFileContentFromGist.mockResolvedValue('{');

    await expect(reconcileGist({ write: true })).rejects.toThrow();
    expect(gistMocks.updateFile).not.toHaveBeenCalled();
  });

  it('detects a competing writer during read-back verification', async () => {
    const local = document('Local winner');
    dbMocks.getSyncSnapshot.mockResolvedValue({
      document: local,
      replicaId: 'replica-local',
      pendingGeneration: 4,
      syncedGeneration: 3,
    });
    gistMocks.getFileContentFromGist
      .mockResolvedValueOnce(
        JSON.stringify({
          ...document('Old remote'),
          sessions: [
            {
              ...document().sessions[0]!,
              title: 'Old remote',
              revision: { counter: 1, replicaId: 'replica-remote' },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          ...document('Racing remote'),
          sessions: [
            {
              ...document().sessions[0]!,
              title: 'Racing remote',
              revision: { counter: 1, replicaId: 'replica-remote' },
            },
          ],
        }),
      );
    dbMocks.applyRemoteSyncDocument.mockImplementation(async () => ({
      document: local,
      removedImageTokens: [],
      pendingGeneration: 4,
    }));

    await expect(reconcileGist({ write: true })).rejects.toThrow('verification');
    expect(dbMocks.markSyncGenerationComplete).not.toHaveBeenCalled();
  });
});

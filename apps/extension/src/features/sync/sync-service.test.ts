import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSettings, TabSession } from '@tabstow/core';
import { pullFromGist, pushToGist } from './sync-service';

const dbMocks = vi.hoisted(() => ({
  exportSessions: vi.fn(),
  importSessions: vi.fn(),
  listSessions: vi.fn(),
  mergeRemoteSessions: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

const quickLinkMocks = vi.hoisted(() => ({
  getQuickLinks: vi.fn(),
  saveQuickLinks: vi.fn(),
  updateQuickLinks: vi.fn(),
}));

const gistMocks = vi.hoisted(() => {
  class GistFileNotFoundError extends Error {}

  return {
    getFileContent: vi.fn(),
    updateFile: vi.fn(),
    GistFileNotFoundError,
  };
});

vi.mock('@/db/db', () => dbMocks);
vi.mock('@/features/quick-links/quick-links-storage', () => quickLinkMocks);
vi.mock('@/features/settings/settings-storage', () => settingsMocks);
vi.mock('./gist-client', () => ({
  GistClient: class {
    getFileContent = gistMocks.getFileContent;
    updateFile = gistMocks.updateFile;
  },
  GistFileNotFoundError: gistMocks.GistFileNotFoundError,
}));

const SETTINGS: ExtensionSettings = {
  deviceId: 'device-1',
  githubToken: 'token-1',
  gistId: 'gist-1',
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: false,
  closePinnedTabs: false,
  theme: 'system',
};

function createSession(id: string, title: string, updatedAt: string): TabSession {
  return {
    id,
    title,
    tabs: [
      {
        id: `${id}-tab-1`,
        url: `https://example.com/${id}`,
        title: `${title} tab`,
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ],
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt,
    deviceId: 'device-1',
  };
}

describe('sync service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quickLinkMocks.getQuickLinks.mockResolvedValue([]);
    quickLinkMocks.saveQuickLinks.mockImplementation(async (links: unknown) => links);
    quickLinkMocks.updateQuickLinks.mockImplementation(async (update: (currentLinks: unknown[]) => unknown[] | Promise<unknown[]>) => {
      const currentLinks = await quickLinkMocks.getQuickLinks();
      const nextLinks = await update(currentLinks);
      await quickLinkMocks.saveQuickLinks(nextLinks);
      return nextLinks;
    });
    settingsMocks.getSettings.mockResolvedValue(SETTINGS);
    settingsMocks.updateSettings.mockResolvedValue(SETTINGS);
    dbMocks.mergeRemoteSessions.mockResolvedValue([]);
  });

  it('merges remote sessions into a push while keeping local versions for matching ids', async () => {
    const localOnly = createSession('local-only', 'Local only', '2026-07-06T00:00:00.000Z');
    const sharedLocal = createSession('shared', 'Local shared', '2026-07-08T00:00:00.000Z');
    const sharedRemote = createSession('shared', 'Remote shared', '2026-07-07T00:00:00.000Z');
    const remoteOnly = createSession('remote-only', 'Remote only', '2026-07-09T00:00:00.000Z');

    dbMocks.exportSessions.mockResolvedValue([localOnly, sharedLocal]);
    gistMocks.getFileContent.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'remote-device',
        exportedAt: '2026-07-09T00:00:00.000Z',
        sessions: [sharedRemote, remoteOnly],
        settings: {
          deviceId: 'remote-device',
          gistId: 'gist-1',
          gistFileName: 'tabstow.sync.json',
          includePinnedTabs: false,
          closePinnedTabs: false,
          theme: 'system',
        },
      }),
    );
    gistMocks.updateFile.mockResolvedValue(undefined);

    const result = await pushToGist();

    expect(result).toEqual({
      ok: true,
      data: {
        sessionCount: 3,
        quickLinkCount: 0,
        exportedAt: expect.any(String),
      },
    });

    const pushedDocument = JSON.parse(gistMocks.updateFile.mock.calls[0]?.[2] as string);
    expect(pushedDocument.sessions).toHaveLength(3);
    expect(pushedDocument.settings).not.toHaveProperty('theme');
    expect(
      pushedDocument.sessions.find((session: TabSession) => session.id === 'shared')?.title,
    ).toBe('Local shared');
    expect(
      pushedDocument.sessions.map((session: TabSession) => session.id).sort(),
    ).toEqual(['local-only', 'remote-only', 'shared']);
  });

  it('pushes only the newer saved copy when different sessions contain the same URL', async () => {
    const olderRemote = {
      ...createSession('old-session', 'Old session', '2026-07-10T00:00:00.000Z'),
      tabs: [
        {
          id: 'old-copy',
          url: 'https://example.com/read#old',
          title: 'Old copy',
          createdAt: '2026-07-10T00:00:00.000Z',
        },
      ],
    };
    const newerLocal = {
      ...createSession('new-session', 'New session', '2026-07-11T00:00:00.000Z'),
      tabs: [
        {
          id: 'new-copy',
          url: 'https://example.com/read#new',
          title: 'New copy',
          createdAt: '2026-07-11T00:00:00.000Z',
        },
      ],
    };

    dbMocks.exportSessions.mockResolvedValue([newerLocal]);
    gistMocks.getFileContent.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'remote-device',
        exportedAt: '2026-07-10T00:00:00.000Z',
        sessions: [olderRemote],
        settings: {
          deviceId: 'remote-device',
          gistId: 'gist-1',
          gistFileName: 'tabstow.sync.json',
          includePinnedTabs: false,
          closePinnedTabs: false,
        },
      }),
    );
    gistMocks.updateFile.mockResolvedValue(undefined);

    await pushToGist();

    const pushedDocument = JSON.parse(gistMocks.updateFile.mock.calls[0]?.[2] as string);
    expect(pushedDocument.sessions.flatMap((session: TabSession) => session.tabs)).toEqual([
      expect.objectContaining({ id: 'new-copy' }),
    ]);
  });

  it('pushes the local document when the configured gist file is missing', async () => {
    const localOnly = createSession('local-only', 'Local only', '2026-07-06T00:00:00.000Z');

    dbMocks.exportSessions.mockResolvedValue([localOnly]);
    gistMocks.getFileContent.mockRejectedValue(
      new gistMocks.GistFileNotFoundError('Gist file was not found.'),
    );
    gistMocks.updateFile.mockResolvedValue(undefined);

    const result = await pushToGist();

    expect(result).toEqual({
      ok: true,
      data: {
        sessionCount: 1,
        quickLinkCount: 0,
        exportedAt: expect.any(String),
      },
    });

    const pushedDocument = JSON.parse(gistMocks.updateFile.mock.calls[0]?.[2] as string);
    expect(pushedDocument.sessions).toEqual([localOnly]);
    expect(pushedDocument.settings).not.toHaveProperty('theme');
  });

  it.each([
    ['missing', null],
    ['empty', '{}'],
  ])('deduplicates local sessions when the gist file is %s', async (_case, remoteContent) => {
    const older = {
      ...createSession('older', 'Older', '2026-07-10T00:00:00.000Z'),
      tabs: [{
        id: 'older-tab',
        url: 'https://example.com/read#old',
        title: 'Older',
        createdAt: '2026-07-10T00:00:00.000Z',
      }],
    };
    const newer = {
      ...createSession('newer', 'Newer', '2026-07-11T00:00:00.000Z'),
      tabs: [{
        id: 'newer-tab',
        url: 'https://example.com/read#new',
        title: 'Newer',
        createdAt: '2026-07-11T00:00:00.000Z',
      }],
    };
    dbMocks.exportSessions.mockResolvedValue([older, newer]);
    if (remoteContent === null) {
      gistMocks.getFileContent.mockRejectedValue(
        new gistMocks.GistFileNotFoundError('Gist file was not found.'),
      );
    } else {
      gistMocks.getFileContent.mockResolvedValue(remoteContent);
    }
    gistMocks.updateFile.mockResolvedValue(undefined);

    await pushToGist();

    const pushedDocument = JSON.parse(gistMocks.updateFile.mock.calls[0]?.[2] as string);
    expect(pushedDocument.sessions).toEqual([
      expect.objectContaining({ id: 'newer' }),
    ]);
  });

  it('initializes an empty-object gist file on push', async () => {
    const localOnly = createSession('local-only', 'Local only', '2026-07-06T00:00:00.000Z');

    dbMocks.exportSessions.mockResolvedValue([localOnly]);
    gistMocks.getFileContent.mockResolvedValue('{}');
    gistMocks.updateFile.mockResolvedValue(undefined);

    const result = await pushToGist();

    expect(result).toEqual({
      ok: true,
      data: {
        sessionCount: 1,
        quickLinkCount: 0,
        exportedAt: expect.any(String),
      },
    });

    const pushedDocument = JSON.parse(gistMocks.updateFile.mock.calls[0]?.[2] as string);
    expect(pushedDocument.sessions).toEqual([localOnly]);
  });

  it('returns invalid-sync-document instead of overwriting invalid remote sync data on push', async () => {
    dbMocks.exportSessions.mockResolvedValue([
      createSession('local-only', 'Local only', '2026-07-06T00:00:00.000Z'),
    ]);
    gistMocks.getFileContent.mockResolvedValue('{');

    const result = await pushToGist();

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid-sync-document',
        message: 'The configured Gist file did not contain valid JSON.',
      },
    });
    expect(gistMocks.updateFile).not.toHaveBeenCalled();
  });

  it('pushes quick links while excluding uploaded image icon tokens', async () => {
    const localOnly = createSession('local-only', 'Local only', '2026-07-06T00:00:00.000Z');

    dbMocks.exportSessions.mockResolvedValue([localOnly]);
    quickLinkMocks.getQuickLinks.mockResolvedValue([
      {
        id: 'quick-image',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'image', value: 'quick-link-icon:local-only' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
    gistMocks.getFileContent.mockRejectedValue(
      new gistMocks.GistFileNotFoundError('Gist file was not found.'),
    );
    gistMocks.updateFile.mockResolvedValue(undefined);

    const result = await pushToGist();

    expect(result).toEqual({
      ok: true,
      data: {
        sessionCount: 1,
        quickLinkCount: 1,
        exportedAt: expect.any(String),
      },
    });

    const pushedDocument = JSON.parse(gistMocks.updateFile.mock.calls[0]?.[2] as string);
    expect(pushedDocument.quickLinks).toEqual([
      {
        id: 'quick-image',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('pulls and saves merged quick links from the configured gist', async () => {
    dbMocks.listSessions.mockResolvedValue([]);
    dbMocks.importSessions.mockResolvedValue([]);
    quickLinkMocks.getQuickLinks.mockResolvedValue([
      {
        id: 'local-only',
        url: 'https://local.example/',
        label: 'Local',
        icon: null,
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
    gistMocks.getFileContent.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'remote-device',
        exportedAt: '2026-07-09T00:00:00.000Z',
        sessions: [],
        quickLinks: [
          {
            id: 'remote-only',
            url: 'https://remote.example/',
            label: 'Remote',
            icon: { kind: 'site', value: null },
            createdAt: '2026-07-09T00:00:00.000Z',
          },
        ],
        settings: {
          deviceId: 'remote-device',
          gistId: 'gist-1',
          gistFileName: 'tabstow.sync.json',
          includePinnedTabs: false,
          closePinnedTabs: false,
        },
      }),
    );

    const result = await pullFromGist();

    expect(quickLinkMocks.saveQuickLinks).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'remote-only', label: 'Remote' }),
      expect.objectContaining({ id: 'local-only', label: 'Local' }),
    ]);
    expect(result).toEqual({
      ok: true,
      data: {
        sessionCount: 0,
        quickLinkCount: 2,
        importedAt: expect.any(String),
      },
    });
  });

  it('atomically merges pulled sessions with remote precedence', async () => {
    const newerRemote = {
      ...createSession('new-session', 'New session', '2026-07-11T00:00:00.000Z'),
      tabs: [
        {
          id: 'new-copy',
          url: 'https://example.com/read#new',
          title: 'New copy',
          createdAt: '2026-07-11T00:00:00.000Z',
        },
      ],
    };

    dbMocks.mergeRemoteSessions.mockResolvedValue([newerRemote]);
    gistMocks.getFileContent.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'remote-device',
        exportedAt: '2026-07-11T00:00:00.000Z',
        sessions: [newerRemote],
        settings: {
          deviceId: 'remote-device',
          gistId: 'gist-1',
          gistFileName: 'tabstow.sync.json',
          includePinnedTabs: false,
          closePinnedTabs: false,
        },
      }),
    );

    await pullFromGist();

    expect(dbMocks.mergeRemoteSessions).toHaveBeenCalledWith([newerRemote]);
    expect(dbMocks.listSessions).not.toHaveBeenCalled();
    expect(dbMocks.importSessions).not.toHaveBeenCalled();
  });

  it('rejects a malicious sync session with duplicate tab ids before changing local sessions', async () => {
    const malicious = createSession('malicious', 'Malicious', '2026-07-11T00:00:00.000Z');
    malicious.tabs.push({
      ...malicious.tabs[0]!,
      url: 'https://example.com/distinct',
    });
    gistMocks.getFileContent.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'remote-device',
        exportedAt: '2026-07-11T00:00:00.000Z',
        sessions: [malicious],
        settings: {
          deviceId: 'remote-device',
          gistId: 'gist-1',
          gistFileName: 'tabstow.sync.json',
          includePinnedTabs: false,
          closePinnedTabs: false,
        },
      }),
    );

    await expect(pullFromGist()).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-sync-document',
        message: 'The configured Gist file was not a valid Tabstow sync document.',
      },
    });
    expect(dbMocks.mergeRemoteSessions).not.toHaveBeenCalled();
  });

  it('classifies zod validation failures during pull as invalid sync documents', async () => {
    dbMocks.listSessions.mockResolvedValue([]);
    dbMocks.importSessions.mockResolvedValue([]);
    gistMocks.getFileContent.mockResolvedValue(
      JSON.stringify({
        schemaVersion: 1,
        deviceId: 'device-1',
        exportedAt: '2026-07-06T00:00:00.000Z',
        sessions: [],
        settings: {
          deviceId: 'device-1',
          gistFileName: 'tabstow.sync.json',
          includePinnedTabs: false,
          closePinnedTabs: false,
          githubToken: 'secret',
        },
      }),
    );

    const result = await pullFromGist();

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid-sync-document',
        message: 'The configured Gist file was not a valid Tabstow sync document.',
      },
    });
  });
});

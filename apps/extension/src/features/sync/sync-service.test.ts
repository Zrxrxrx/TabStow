import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionSettings, TabSession } from '@tabstow/core';
import { pullFromGist, pushToGist } from './sync-service';

const dbMocks = vi.hoisted(() => ({
  exportSessions: vi.fn(),
  importSessions: vi.fn(),
  listSessions: vi.fn(),
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

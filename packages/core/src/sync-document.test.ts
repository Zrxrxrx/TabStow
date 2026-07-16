import { describe, expect, it } from 'vitest';
import type { ExtensionSettings, TabSession } from './schemas';
import {
  buildSyncDocument,
  parseSyncDocument,
  toImportableSettings,
  toSafeSyncSettings,
} from './sync-document';

const settings: ExtensionSettings = {
  deviceId: 'device-1',
  includePinnedTabs: true,
  closePinnedTabs: false,
};

const session: TabSession = {
  id: 'session-1',
  title: 'Session',
  tabs: [],
  sortOrder: 0,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  deviceId: 'device-1',
};

describe('sync documents', () => {
  it('exports only synchronized behavior settings and the legacy device id', () => {
    expect(toSafeSyncSettings(settings)).toEqual({
      deviceId: 'device-1',
      includePinnedTabs: true,
      closePinnedTabs: false,
    });
  });

  it('imports remote settings without deviceId', () => {
    expect(toImportableSettings(toSafeSyncSettings(settings))).toEqual({
      includePinnedTabs: true,
      closePinnedTabs: false,
    });
  });

  it('builds and parses a schema version 1 sync document', () => {
    const document = buildSyncDocument({
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [session],
      settings,
    });

    const pushedDocument = JSON.parse(JSON.stringify(document));

    expect(pushedDocument.settings).not.toHaveProperty('githubToken');
    expect(pushedDocument.settings).not.toHaveProperty('theme');
    expect(pushedDocument).not.toHaveProperty('history');
    expect(parseSyncDocument(pushedDocument).sessions).toEqual([
      expect.objectContaining({ id: 'session-1', sortOrder: 0 }),
    ]);
  });

  it('builds and parses sync documents with quick links', () => {
    const document = buildSyncDocument({
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [session],
      settings,
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'site', value: null },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
    });

    expect(document.quickLinks).toEqual([
      {
        id: 'quick-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'site', value: null },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
    expect(parseSyncDocument(document).quickLinks).toHaveLength(1);
  });

  it.each(['dark', 'sepia', null, { mode: 'dark' }])(
    'parses a legacy sync theme value (%j) without importing it',
    (theme) => {
      const document = parseSyncDocument({
        schemaVersion: 1,
        deviceId: 'device-1',
        exportedAt: '2026-07-06T00:00:00.000Z',
        sessions: [session],
        settings: {
          deviceId: 'device-1',
          gistId: 'gist-1',
          gistFileName: 'tabstow.sync.json',
          includePinnedTabs: true,
          closePinnedTabs: false,
          theme,
        },
      });

      expect(document.settings).not.toHaveProperty('theme');
      expect(toImportableSettings(document.settings)).not.toHaveProperty('theme');
    },
  );
});

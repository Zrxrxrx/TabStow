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
  githubToken: 'secret-token',
  gistId: 'gist-1',
  gistFileName: 'tabstow.sync.json',
  includePinnedTabs: true,
  closePinnedTabs: false,
  theme: 'dark',
};

const session: TabSession = {
  id: 'session-1',
  title: 'Session',
  tabs: [],
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
  deviceId: 'device-1',
};

describe('sync documents', () => {
  it('exports safe settings without githubToken', () => {
    expect(toSafeSyncSettings(settings)).toEqual({
      deviceId: 'device-1',
      gistId: 'gist-1',
      gistFileName: 'tabstow.sync.json',
      includePinnedTabs: true,
      closePinnedTabs: false,
      theme: 'dark',
    });
  });

  it('imports remote settings without githubToken or deviceId', () => {
    expect(toImportableSettings(toSafeSyncSettings(settings))).toEqual({
      gistId: 'gist-1',
      gistFileName: 'tabstow.sync.json',
      includePinnedTabs: true,
      closePinnedTabs: false,
      theme: 'dark',
    });
  });

  it('builds and parses a schema version 1 sync document', () => {
    const document = buildSyncDocument({
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [session],
      settings,
    });

    expect(document.settings).not.toHaveProperty('githubToken');
    expect(parseSyncDocument(document).sessions).toHaveLength(1);
  });
});

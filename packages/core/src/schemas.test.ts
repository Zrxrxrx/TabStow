import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  extensionSettingsSchema,
  savedTabSchema,
  syncDocumentSchema,
  tabSessionSchema,
} from './schemas';

describe('core schemas', () => {
  it('validates saved tabs and sessions', () => {
    const tab = savedTabSchema.parse({
      id: 'tab-1',
      url: 'https://example.com/',
      title: 'Example',
      favIconUrl: 'https://example.com/favicon.ico',
      pinned: false,
      createdAt: '2026-07-06T00:00:00.000Z',
    });

    const session = tabSessionSchema.parse({
      id: 'session-1',
      title: 'Example session',
      tabs: [tab],
      sourceWindowId: 12,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      deviceId: 'device-1',
    });

    expect(session.tabs).toHaveLength(1);
  });

  it('keeps default settings aligned with the MVP', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      gistFileName: 'tabstow.sync.json',
      includePinnedTabs: false,
      closePinnedTabs: false,
      theme: 'system',
    });

    expect(
      extensionSettingsSchema.parse({
        ...DEFAULT_SETTINGS,
        deviceId: 'device-1',
      }),
    ).toMatchObject(DEFAULT_SETTINGS);
  });

  it('rejects sync documents that contain githubToken in settings', () => {
    const result = syncDocumentSchema.safeParse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
        theme: 'system',
        githubToken: 'secret',
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects sync documents with duplicate session ids', () => {
    const result = syncDocumentSchema.safeParse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [
        {
          id: 'session-1',
          title: 'Session 1',
          tabs: [],
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:00:00.000Z',
          deviceId: 'device-1',
        },
        {
          id: 'session-1',
          title: 'Session 1 duplicate',
          tabs: [],
          createdAt: '2026-07-06T00:00:00.000Z',
          updatedAt: '2026-07-06T00:00:00.000Z',
          deviceId: 'device-1',
        },
      ],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
        theme: 'system',
      },
    });

    expect(result.success).toBe(false);
  });
});

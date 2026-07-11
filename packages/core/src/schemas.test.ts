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

  it('parses sessions with legacy missing order and current explicit order', () => {
    const legacy = tabSessionSchema.parse({
      id: 'legacy-session',
      title: 'Legacy session',
      tabs: [],
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      deviceId: 'device-1',
    });
    const current = tabSessionSchema.parse({
      ...legacy,
      id: 'current-session',
      sortOrder: 0,
    });

    expect(legacy.sortOrder).toBeUndefined();
    expect(current.sortOrder).toBe(0);
  });

  it('rejects sessions with duplicate saved-tab ids', () => {
    const result = tabSessionSchema.safeParse({
      id: 'session-1',
      title: 'Duplicate tab IDs',
      tabs: [
        {
          id: 'duplicate-tab',
          url: 'https://example.com/one',
          title: 'One',
          createdAt: '2026-07-06T00:00:00.000Z',
        },
        {
          id: 'duplicate-tab',
          url: 'https://example.com/two',
          title: 'Two',
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      deviceId: 'device-1',
    });

    expect(result.success).toBe(false);
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
        githubToken: 'secret',
      },
    });

    expect(result.success).toBe(false);
  });

  it('parses legacy sync documents with theme but strips it from settings', () => {
    const result = syncDocumentSchema.parse({
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
      },
    });

    expect(result.settings).not.toHaveProperty('theme');
  });

  it('parses sync documents with quick links and defaults older documents to an empty list', () => {
    const legacy = syncDocumentSchema.parse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
      },
    });

    expect(legacy.quickLinks).toEqual([]);

    const current = syncDocumentSchema.parse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'emoji', value: '*' },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
      },
    });

    expect(current.quickLinks).toEqual([
      {
        id: 'quick-1',
        url: 'https://example.com/',
        label: 'Example',
        icon: { kind: 'emoji', value: '*' },
        createdAt: '2026-07-06T00:00:00.000Z',
      },
    ]);
  });

  it('normalizes unsupported synced quick-link icons to site icons', () => {
    const document = syncDocumentSchema.parse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://example.com/',
          label: 'Example',
          icon: { kind: 'image', value: 'quick-link-icon:local-only' },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
      },
    });

    expect(document.quickLinks[0]?.icon).toEqual({ kind: 'site', value: null });
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
      },
    });

    expect(result.success).toBe(false);
  });

  it('rejects sync documents with duplicate quick-link ids', () => {
    const result = syncDocumentSchema.safeParse({
      schemaVersion: 1,
      deviceId: 'device-1',
      exportedAt: '2026-07-06T00:00:00.000Z',
      sessions: [],
      quickLinks: [
        {
          id: 'quick-1',
          url: 'https://a.example/',
          label: 'A',
          icon: { kind: 'site', value: null },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
        {
          id: 'quick-1',
          url: 'https://b.example/',
          label: 'B',
          icon: { kind: 'site', value: null },
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
      settings: {
        deviceId: 'device-1',
        gistFileName: 'tabstow.sync.json',
        includePinnedTabs: false,
        closePinnedTabs: false,
      },
    });

    expect(result.success).toBe(false);
  });
});

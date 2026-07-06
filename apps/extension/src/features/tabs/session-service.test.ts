import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type TabSession } from '@tabstow/core';

const browserMocks = vi.hoisted(() => ({
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://tabstow${path}`),
  },
  tabs: {
    create: vi.fn(),
    query: vi.fn(),
    remove: vi.fn(),
    update: vi.fn(),
  },
  windows: {
    create: vi.fn(),
  },
}));

const dbMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getSession: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock('../../lib/browser', () => ({
  browser: browserMocks,
}));

vi.mock('../../db/db', () => dbMocks);

vi.mock('../settings/settings-storage', () => settingsMocks);

import { restoreSession, saveCurrentWindowAsSession } from './session-service';

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getSettings.mockResolvedValue({
    ...DEFAULT_SETTINGS,
    deviceId: 'device-1',
  });
});

describe('session service', () => {
  it('reapplies pinned tabs when restoring a session into a new window', async () => {
    const session: TabSession = {
      id: 'session-1',
      title: 'Example session',
      tabs: [
        {
          id: 'tab-1',
          url: 'https://example.com/one',
          title: 'One',
          createdAt: '2026-07-06T00:00:00.000Z',
          pinned: true,
        },
        {
          id: 'tab-2',
          url: 'https://example.com/two',
          title: 'Two',
          createdAt: '2026-07-06T00:00:00.000Z',
        },
      ],
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      deviceId: 'device-1',
    };

    dbMocks.getSession.mockResolvedValue(session);
    browserMocks.windows.create.mockResolvedValue({ id: 99 });
    browserMocks.tabs.query.mockResolvedValue([
      { id: 10, windowId: 99, pinned: false },
      { id: 11, windowId: 99, pinned: false },
    ]);

    const result = await restoreSession('session-1', 'new-window');

    expect(result).toEqual({ ok: true, data: { restored: true, tabCount: 2 } });
    expect(browserMocks.tabs.update).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.update).toHaveBeenCalledWith(10, { pinned: true });
  });

  it('keeps a saved session when closing tabs fails after persistence', async () => {
    settingsMocks.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      deviceId: 'device-1',
      closePinnedTabs: true,
    });
    browserMocks.tabs.query.mockResolvedValue([
      {
        id: 7,
        windowId: 12,
        url: 'https://example.com/',
        title: 'Example',
        pinned: false,
        active: true,
      },
    ]);
    dbMocks.createSession.mockResolvedValue(undefined);
    browserMocks.tabs.create.mockResolvedValue({ id: 99 });
    browserMocks.tabs.remove.mockRejectedValue(new Error('tab removal failed'));

    const result = await saveCurrentWindowAsSession();

    expect(dbMocks.createSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        savedTabCount: 1,
        closedTabCount: 0,
      }),
    });
  });

  it('keeps a saved session when the replacement tab cannot be created', async () => {
    settingsMocks.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      deviceId: 'device-1',
      closePinnedTabs: true,
    });
    browserMocks.tabs.query.mockResolvedValue([
      {
        id: 7,
        windowId: 12,
        url: 'https://example.com/',
        title: 'Example',
        pinned: false,
        active: true,
      },
    ]);
    dbMocks.createSession.mockResolvedValue(undefined);
    browserMocks.tabs.create.mockRejectedValue(new Error('survivor tab failed'));
    browserMocks.tabs.remove.mockResolvedValue(undefined);

    const result = await saveCurrentWindowAsSession();

    expect(dbMocks.createSession).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([7]);
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        savedTabCount: 1,
        closedTabCount: 1,
      }),
    });
  });

  it('uses the initiating window id for stow queries and survivor tabs', async () => {
    settingsMocks.getSettings.mockResolvedValue({
      ...DEFAULT_SETTINGS,
      deviceId: 'device-1',
      closePinnedTabs: true,
    });
    browserMocks.tabs.query.mockResolvedValue([
      {
        id: 21,
        windowId: 55,
        url: 'https://example.com/',
        title: 'Example',
        pinned: false,
        active: true,
      },
    ]);
    dbMocks.createSession.mockResolvedValue(undefined);
    browserMocks.tabs.create.mockResolvedValue({ id: 88 });
    browserMocks.tabs.remove.mockResolvedValue(undefined);

    const result = await saveCurrentWindowAsSession(55);

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        savedTabCount: 1,
        closedTabCount: 1,
      }),
    });
    expect(browserMocks.tabs.query).toHaveBeenCalledWith({ windowId: 55 });
    expect(browserMocks.tabs.create).toHaveBeenCalledWith({
      windowId: 55,
      url: 'chrome-extension://tabstow/newtab.html',
      active: true,
    });
  });

  it('rejects restoring an empty saved session with a typed error', async () => {
    dbMocks.getSession.mockResolvedValue({
      id: 'session-1',
      title: 'Empty session',
      tabs: [],
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z',
      deviceId: 'device-1',
    } satisfies TabSession);

    const result = await restoreSession('session-1', 'current-window');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'empty-session',
        message: 'Saved session has no tabs to restore.',
      },
    });
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
    expect(browserMocks.windows.create).not.toHaveBeenCalled();
  });
});

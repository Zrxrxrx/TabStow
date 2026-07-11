import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type TabSession } from '@tabstow/core';
import type { HistoryEntry } from '../history/types';

const browserMocks = vi.hoisted(() => ({
  runtime: {
    getURL: vi.fn((path: string) => `chrome-extension://tabstow${path}`),
  },
  tabs: {
    create: vi.fn(),
    get: vi.fn(),
    query: vi.fn(),
    remove: vi.fn(),
  },
}));

const dbMocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  getHistoryEntry: vi.fn(),
  getSession: vi.fn(),
  moveSavedTabToHistory: vi.fn(),
  moveSessionToHistory: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock('../../lib/browser', () => ({
  browser: browserMocks,
}));

vi.mock('../../db/db', () => dbMocks);

vi.mock('../settings/settings-storage', () => settingsMocks);

import {
  openHistoryTab,
  openSavedTab,
  restoreSession,
  saveCurrentWindowAsSession,
  saveTabsAsSession,
} from './session-service';

const sessionWithTwoTabs: TabSession = {
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

const historyEntry: HistoryEntry = {
  id: 'history-1',
  sourceSessionId: 'session-1',
  sourceTitle: 'Example session',
  tabs: sessionWithTwoTabs.tabs,
  originalCreatedAt: sessionWithTwoTabs.createdAt,
  movedAt: '2026-07-07T00:00:00.000Z',
  reason: 'opened',
  deviceId: 'device-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  settingsMocks.getSettings.mockResolvedValue({
    ...DEFAULT_SETTINGS,
    deviceId: 'device-1',
  });
});

describe('session service', () => {
  it('opens a saved tab in the background before consuming it', async () => {
    dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);
    browserMocks.tabs.create.mockResolvedValue({ id: 91 });
    dbMocks.moveSavedTabToHistory.mockResolvedValue(historyEntry);

    await expect(openSavedTab('session-1', 'tab-1', true)).resolves.toEqual({
      ok: true,
      data: { opened: true, consumed: true },
    });
    expect(browserMocks.tabs.create).toHaveBeenCalledWith({
      url: 'https://example.com/one',
      active: false,
    });
    expect(browserMocks.tabs.create).toHaveBeenCalledBefore(
      dbMocks.moveSavedTabToHistory,
    );
    expect(dbMocks.moveSavedTabToHistory).toHaveBeenCalledWith(
      'session-1',
      'tab-1',
      'opened',
    );
  });

  it('returns a structured saved-tab error when consuming the open loses a storage race', async () => {
    dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);
    browserMocks.tabs.create.mockResolvedValue({ id: 91 });
    dbMocks.moveSavedTabToHistory.mockRejectedValue(
      new Error('Saved tab not found: tab-1'),
    );

    await expect(openSavedTab('session-1', 'tab-1', true)).resolves.toEqual({
      ok: false,
      error: {
        code: 'saved-tab-not-found',
        message: 'Saved tab was not found.',
      },
    });
  });

  it('does not consume a middle-click open', async () => {
    dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);
    browserMocks.tabs.create.mockResolvedValue({ id: 91 });

    await expect(openSavedTab('session-1', 'tab-1', false)).resolves.toEqual({
      ok: true,
      data: { opened: true, consumed: false },
    });
    expect(dbMocks.moveSavedTabToHistory).not.toHaveBeenCalled();
  });

  it('rejects a missing saved tab without opening or consuming it', async () => {
    dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);

    await expect(openSavedTab('session-1', 'missing', true)).resolves.toEqual({
      ok: false,
      error: {
        code: 'saved-tab-not-found',
        message: 'Saved tab was not found.',
      },
    });
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
    expect(dbMocks.moveSavedTabToHistory).not.toHaveBeenCalled();
  });

  it('rejects a blocked saved tab URL without opening or consuming it', async () => {
    dbMocks.getSession.mockResolvedValue({
      ...sessionWithTwoTabs,
      tabs: [{ ...sessionWithTwoTabs.tabs[0]!, url: 'chrome://settings' }],
    });

    await expect(openSavedTab('session-1', 'tab-1', true)).resolves.toEqual({
      ok: false,
      error: {
        code: 'invalid-tab-url',
        message: 'Saved tab URL cannot be opened.',
      },
    });
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
    expect(dbMocks.moveSavedTabToHistory).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>unsafe</h1>',
    'file:///tmp/private.html',
    'ftp://example.com/archive',
  ])('rejects the imported saved URL %s at the Chrome open boundary', async (url) => {
    dbMocks.getSession.mockResolvedValue({
      ...sessionWithTwoTabs,
      tabs: [{ ...sessionWithTwoTabs.tabs[0]!, url }],
    });

    await expect(openSavedTab('session-1', 'tab-1', true)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-tab-url' },
    });
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
    expect(dbMocks.moveSavedTabToHistory).not.toHaveBeenCalled();
  });

  it('allows only one concurrent consuming open for a saved tab', async () => {
    dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);
    dbMocks.moveSavedTabToHistory.mockResolvedValue(historyEntry);
    let releaseCreate!: () => void;
    browserMocks.tabs.create.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseCreate = () => resolve({ id: 91 });
      }),
    );

    const first = openSavedTab('session-1', 'tab-1', true);
    await vi.waitFor(() => expect(browserMocks.tabs.create).toHaveBeenCalledTimes(1));

    await expect(openSavedTab('session-1', 'tab-1', true)).resolves.toEqual({
      ok: false,
      error: {
        code: 'operation-in-progress',
        message: 'Another saved-session operation is already in progress.',
      },
    });
    expect(browserMocks.tabs.create).toHaveBeenCalledTimes(1);

    releaseCreate();
    await expect(first).resolves.toEqual({
      ok: true,
      data: { opened: true, consumed: true },
    });
  });

  it('opens every saved tab in order before moving the session to History', async () => {
    dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);
    browserMocks.tabs.create.mockResolvedValue({ id: 91 });
    dbMocks.moveSessionToHistory.mockResolvedValue(historyEntry);

    const result = await restoreSession('session-1');

    expect(result).toEqual({ ok: true, data: { restored: true, tabCount: 2 } });
    expect(browserMocks.tabs.create.mock.calls).toEqual([
      [{ url: 'https://example.com/one', active: false, pinned: true }],
      [{ url: 'https://example.com/two', active: false, pinned: undefined }],
    ]);
    expect(browserMocks.tabs.create).toHaveBeenCalledBefore(
      dbMocks.moveSessionToHistory,
    );
    expect(dbMocks.moveSessionToHistory).toHaveBeenCalledWith('session-1', 'restored');
  });

  it('conflicts restore-all with a consuming open for the same session', async () => {
    const oneTabSession = { ...sessionWithTwoTabs, tabs: [sessionWithTwoTabs.tabs[0]!] };
    dbMocks.getSession.mockResolvedValue(oneTabSession);
    dbMocks.moveSessionToHistory.mockResolvedValue(historyEntry);
    let releaseCreate!: () => void;
    browserMocks.tabs.create.mockImplementationOnce(
      () => new Promise((resolve) => {
        releaseCreate = () => resolve({ id: 91 });
      }),
    );

    const restore = restoreSession('session-1');
    await vi.waitFor(() => expect(browserMocks.tabs.create).toHaveBeenCalledTimes(1));

    await expect(openSavedTab('session-1', 'tab-1', true)).resolves.toMatchObject({
      ok: false,
      error: { code: 'operation-in-progress' },
    });
    expect(browserMocks.tabs.create).toHaveBeenCalledTimes(1);

    releaseCreate();
    await expect(restore).resolves.toEqual({
      ok: true,
      data: { restored: true, tabCount: 1 },
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>unsafe</h1>',
    'file:///tmp/private.html',
    'ftp://example.com/archive',
  ])('rejects the imported restore URL %s before opening or consuming any tabs', async (url) => {
    dbMocks.getSession.mockResolvedValue({
      ...sessionWithTwoTabs,
      tabs: [sessionWithTwoTabs.tabs[0]!, { ...sessionWithTwoTabs.tabs[1]!, url }],
    });

    await expect(restoreSession('session-1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-tab-url' },
    });
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
    expect(dbMocks.moveSessionToHistory).not.toHaveBeenCalled();
  });

  it('keeps the session when one restore-all tab create fails', async () => {
    dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);
    browserMocks.tabs.create
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(new Error('create failed'));

    const result = await restoreSession('session-1');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'chrome-tabs-error',
        message: 'create failed Some tabs may already have opened; the saved session was kept.',
      },
    });
    expect(dbMocks.moveSessionToHistory).not.toHaveBeenCalled();
  });

  it('returns an unknown error when restored tabs open but the History move fails unexpectedly', async () => {
    dbMocks.getSession.mockResolvedValue(sessionWithTwoTabs);
    browserMocks.tabs.create.mockResolvedValue({ id: 91 });
    dbMocks.moveSessionToHistory.mockRejectedValue(new Error('storage unavailable'));

    await expect(restoreSession('session-1')).resolves.toEqual({
      ok: false,
      error: {
        code: 'unknown-error',
        message: 'storage unavailable',
      },
    });
  });

  it('opens a History tab without mutating the History entry', async () => {
    dbMocks.getHistoryEntry.mockResolvedValue(historyEntry);
    browserMocks.tabs.create.mockResolvedValue({ id: 91 });

    await expect(openHistoryTab('history-1', 'tab-2')).resolves.toEqual({
      ok: true,
      data: { opened: true },
    });
    expect(browserMocks.tabs.create).toHaveBeenCalledWith({
      url: 'https://example.com/two',
      active: false,
    });
    expect(dbMocks.moveSavedTabToHistory).not.toHaveBeenCalled();
    expect(dbMocks.moveSessionToHistory).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>unsafe</h1>',
    'file:///tmp/private.html',
    'ftp://example.com/archive',
  ])('rejects the imported History URL %s at the Chrome open boundary', async (url) => {
    dbMocks.getHistoryEntry.mockResolvedValue({
      ...historyEntry,
      tabs: [{ ...historyEntry.tabs[0]!, url }],
    });

    await expect(openHistoryTab('history-1', 'tab-1')).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid-tab-url' },
    });
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
    expect(dbMocks.moveSavedTabToHistory).not.toHaveBeenCalled();
    expect(dbMocks.moveSessionToHistory).not.toHaveBeenCalled();
  });

  it('rejects a missing History entry without opening a tab', async () => {
    dbMocks.getHistoryEntry.mockResolvedValue(undefined);

    await expect(openHistoryTab('missing', 'tab-1')).resolves.toEqual({
      ok: false,
      error: {
        code: 'history-entry-not-found',
        message: 'History entry was not found.',
      },
    });
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
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
    dbMocks.createSession.mockImplementation(async (session: TabSession) => session);
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
    dbMocks.createSession.mockImplementation(async (session: TabSession) => session);
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
    dbMocks.createSession.mockImplementation(async (session: TabSession) => session);
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

  it('returns the authoritative deduplicated window session while closing every included live tab', async () => {
    browserMocks.tabs.query.mockResolvedValue([
      {
        id: 22,
        windowId: 55,
        url: 'https://example.com/article#first',
        title: 'First',
        pinned: false,
        active: true,
      },
      {
        id: 23,
        windowId: 55,
        url: 'https://example.com/article',
        title: 'Second',
        pinned: false,
        active: false,
      },
    ]);
    dbMocks.createSession.mockImplementation(async (session: TabSession) => ({
      ...session,
      tabs: [session.tabs[1]!],
    }));
    browserMocks.tabs.create.mockResolvedValue({ id: 88 });
    browserMocks.tabs.remove.mockResolvedValue(undefined);

    const result = await saveCurrentWindowAsSession(55);

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        session: expect.objectContaining({
          tabs: [expect.objectContaining({ title: 'Second' })],
        }),
        savedTabCount: 1,
        closedTabCount: 2,
      }),
    });
    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([22, 23]);
  });

  it('saves a selected tab as a one-tab session and closes it', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 31,
      windowId: 12,
      url: 'https://example.com/article',
      title: 'Example article',
      favIconUrl: 'https://example.com/favicon.ico',
      pinned: true,
      active: false,
    });
    dbMocks.createSession.mockImplementation(async (session: TabSession) => session);
    browserMocks.tabs.remove.mockResolvedValue(undefined);

    const result = await saveTabsAsSession([31]);

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        savedTabCount: 1,
        closedTabCount: 1,
        session: expect.objectContaining({
          title: 'Example article',
          tabs: [
            expect.objectContaining({
              title: 'Example article',
              url: 'https://example.com/article',
              favIconUrl: 'https://example.com/favicon.ico',
              pinned: true,
            }),
          ],
          sourceWindowId: 12,
          deviceId: 'device-1',
        }),
      }),
    });
    expect(browserMocks.tabs.get).toHaveBeenCalledWith(31);
    expect(dbMocks.createSession).toHaveBeenCalledBefore(browserMocks.tabs.remove);
    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([31]);
  });

  it('rejects blocked selected tabs without persisting or closing them', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 32,
      windowId: 12,
      url: 'chrome://settings',
      title: 'Settings',
      pinned: false,
    });

    const result = await saveTabsAsSession([32]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'no-eligible-tabs',
        message: 'No eligible tabs were found in the selected tab.',
      },
    });
    expect(dbMocks.createSession).not.toHaveBeenCalled();
    expect(browserMocks.tabs.remove).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>unsafe</h1>',
    'file:///tmp/private.html',
    'ftp://example.com/archive',
  ])('does not stow or close the non-http current-window tab %s', async (url) => {
    browserMocks.tabs.query.mockResolvedValue([
      {
        id: 35,
        windowId: 12,
        url,
        title: 'Unsafe',
        pinned: false,
        active: true,
      },
    ]);

    await expect(saveCurrentWindowAsSession(12)).resolves.toEqual({
      ok: false,
      error: {
        code: 'no-eligible-tabs',
        message: 'No eligible tabs were found in the current window.',
      },
    });
    expect(dbMocks.createSession).not.toHaveBeenCalled();
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
    expect(browserMocks.tabs.remove).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<h1>unsafe</h1>',
    'file:///tmp/private.html',
    'ftp://example.com/archive',
  ])('does not stow or close the selected non-http tab %s', async (url) => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 36,
      windowId: 12,
      url,
      title: 'Unsafe',
      pinned: false,
    });

    await expect(saveTabsAsSession([36])).resolves.toEqual({
      ok: false,
      error: {
        code: 'no-eligible-tabs',
        message: 'No eligible tabs were found in the selected tab.',
      },
    });
    expect(dbMocks.createSession).not.toHaveBeenCalled();
    expect(browserMocks.tabs.remove).not.toHaveBeenCalled();
  });

  it('keeps a selected tab session when closing the saved tab fails', async () => {
    browserMocks.tabs.get.mockResolvedValue({
      id: 33,
      windowId: 12,
      url: 'https://example.com/later',
      title: 'Read later',
      pinned: false,
    });
    dbMocks.createSession.mockImplementation(async (session: TabSession) => session);
    browserMocks.tabs.remove.mockRejectedValue(new Error('tab removal failed'));

    const result = await saveTabsAsSession([33]);

    expect(dbMocks.createSession).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([33]);
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        savedTabCount: 1,
        closedTabCount: 0,
      }),
    });
  });

  it('returns the authoritative deduplicated session while closing every requested live tab', async () => {
    browserMocks.tabs.get
      .mockResolvedValueOnce({
        id: 40,
        windowId: 12,
        url: 'https://example.com/article#first',
        title: 'First',
        pinned: false,
      })
      .mockResolvedValueOnce({
        id: 41,
        windowId: 12,
        url: 'https://example.com/article',
        title: 'Second',
        pinned: false,
      });
    dbMocks.createSession.mockImplementation(async (session: TabSession) => ({
      ...session,
      tabs: [session.tabs[1]!],
    }));
    browserMocks.tabs.remove.mockResolvedValue(undefined);

    const result = await saveTabsAsSession([40, 41]);

    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        session: expect.objectContaining({
          tabs: [expect.objectContaining({ title: 'Second' })],
        }),
        savedTabCount: 1,
        closedTabCount: 2,
      }),
    });
    expect(browserMocks.tabs.remove).toHaveBeenCalledWith([40, 41]);
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

    const result = await restoreSession('session-1');

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'empty-session',
        message: 'Saved session has no tabs to restore.',
      },
    });
    expect(browserMocks.tabs.create).not.toHaveBeenCalled();
    expect(dbMocks.moveSessionToHistory).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  tabs: {
    get: vi.fn(),
    query: vi.fn(),
    remove: vi.fn(),
  },
  windows: {
    get: vi.fn(),
  },
}));

const dbMocks = vi.hoisted(() => ({
  createSessionsBatch: vi.fn(),
  listSessions: vi.fn(),
}));

const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock('#imports', () => ({ storage: storageMocks }));
vi.mock('@/lib/browser', () => ({ browser: browserMocks }));
vi.mock('@/db/db', () => dbMocks);
vi.mock('@/features/settings/settings-storage', () => settingsMocks);

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 15, 12);
const POLICY_KEY = 'local:tabstow-tab-lifecycle-policy-v1';
const SESSION_KEY = 'session:tabstow-browser-session-id-v1';

function sleepingTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    windowId: 1,
    highlighted: false,
    active: false,
    pinned: false,
    incognito: false,
    discarded: true,
    autoDiscardable: true,
    audible: false,
    url: 'https://example.com/one',
    title: 'Example one',
    favIconUrl: 'https://example.com/favicon.ico',
    lastAccessed: NOW - 30 * DAY_MS,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe('suggested stow', () => {
  let stored: Map<string, unknown>;
  let liveTabs: Map<number, chrome.tabs.Tab>;
  let uuid: number;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    uuid = 0;
    stored = new Map<string, unknown>([
      [POLICY_KEY, {
        schemaVersion: 1,
        automaticSleepEnabled: false,
        automaticSleepAfterDays: 7,
        stowSuggestionsEnabled: true,
        stowSuggestionAfterDays: 14,
      }],
      [SESSION_KEY, 'browser-session-1'],
    ]);
    liveTabs = new Map();
    storageMocks.getItem.mockImplementation(async (key: string) =>
      structuredClone(stored.get(key)),
    );
    storageMocks.setItem.mockImplementation(async (key: string, value: unknown) => {
      stored.set(key, structuredClone(value));
    });
    browserMocks.tabs.query.mockImplementation(async () =>
      Array.from(liveTabs.values()).map((tab) => ({ ...tab })),
    );
    browserMocks.tabs.get.mockImplementation(async (tabId: number) => {
      const tab = liveTabs.get(tabId);
      if (!tab) throw new Error(`No tab with id: ${tabId}`);
      return { ...tab };
    });
    browserMocks.tabs.remove.mockImplementation(async (tabId: number) => {
      liveTabs.delete(tabId);
    });
    browserMocks.windows.get.mockImplementation(async (windowId: number) => ({
      id: windowId,
      incognito: false,
      type: 'normal',
    }));
    dbMocks.listSessions.mockResolvedValue([]);
    dbMocks.createSessionsBatch.mockImplementation(async (sessions: TabSession[]) =>
      structuredClone(sessions),
    );
    settingsMocks.getSettings.mockResolvedValue({ deviceId: 'device-1' });
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `uuid-${++uuid}`),
      subtle: {
        digest: vi.fn(async (_algorithm: string, input: BufferSource) => {
          const text = new TextDecoder().decode(input as ArrayBuffer);
          const bytes = new Uint8Array(32);
          for (let index = 0; index < text.length; index += 1) {
            bytes[index % bytes.length] ^= text.charCodeAt(index);
          }
          return bytes.buffer;
        }),
      },
    });
  });

  async function observe(tabs: chrome.tabs.Tab[]) {
    const observations = await import('./sleep-observations');
    const records = [];
    for (const tab of tabs) {
      liveTabs.set(tab.id!, tab);
      records.push(await observations.observeDiscardedTab(tab, NOW - 20 * DAY_MS));
    }
    return records.map((record) => record!);
  }

  it('persists one ordered session per source window before closing tabs individually', async () => {
    const tabs = [
      sleepingTab({ id: 30, windowId: 2, index: 4, url: 'https://example.com/three' }),
      sleepingTab({ id: 12, windowId: 1, index: 3, url: 'https://example.com/two' }),
      sleepingTab({ id: 11, windowId: 1, index: 1, url: 'https://example.com/one' }),
    ];
    const records = await observe(tabs);
    const batch = deferred<TabSession[]>();
    dbMocks.createSessionsBatch.mockImplementation(async (sessions: TabSession[]) => {
      batch.resolveValue = structuredClone(sessions);
      return batch.promise;
    });
    const { stowSuggestedTabs } = await import('./suggested-stow');

    const stow = stowSuggestedTabs(records.map(({ observationId }) => observationId), {
      now: NOW,
    });
    await vi.waitFor(() => expect(dbMocks.createSessionsBatch).toHaveBeenCalledTimes(1));
    expect(browserMocks.tabs.remove).not.toHaveBeenCalled();
    const sessions = dbMocks.createSessionsBatch.mock.calls[0]![0] as TabSession[];
    expect(sessions.map(({ sourceWindowId }) => sourceWindowId)).toEqual([1, 2]);
    expect(sessions[0]!.tabs.map(({ url }) => url)).toEqual([
      'https://example.com/one',
      'https://example.com/two',
    ]);
    batch.resolve(sessions);

    await expect(stow).resolves.toEqual({
      ok: true,
      data: {
        savedTabCount: 3,
        createdSessionCount: 2,
        closedTabCount: 3,
        skipped: [],
        closeFailures: [],
      },
    });
    expect(browserMocks.tabs.remove.mock.calls).toEqual([[11], [12], [30]]);
  });

  it('closes nothing when atomic persistence fails', async () => {
    const [record] = await observe([sleepingTab()]);
    dbMocks.createSessionsBatch.mockRejectedValue(new Error('IndexedDB write failed'));
    const { stowSuggestedTabs } = await import('./suggested-stow');

    await expect(
      stowSuggestedTabs([record!.observationId], { now: NOW }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'unknown-error', message: 'IndexedDB write failed' },
    });
    expect(browserMocks.tabs.remove).not.toHaveBeenCalled();
  });

  it('drops pre-save state changes and never submits them to persistence', async () => {
    const tabs = [
      sleepingTab({ id: 1, index: 0, url: 'https://example.com/changed' }),
      sleepingTab({ id: 2, index: 1, url: 'https://example.com/protected' }),
      sleepingTab({ id: 3, index: 2, url: 'https://example.com/safe' }),
    ];
    const records = await observe(tabs);
    browserMocks.tabs.get.mockImplementation(async (tabId: number) => {
      const tab = liveTabs.get(tabId)!;
      if (tabId === 1) return { ...tab, url: 'https://example.com/navigated' };
      if (tabId === 2) return { ...tab, pinned: true };
      return { ...tab };
    });
    const { stowSuggestedTabs } = await import('./suggested-stow');

    const result = await stowSuggestedTabs(
      records.map(({ observationId }) => observationId),
      { now: NOW },
    );

    expect(result).toEqual({
      ok: true,
      data: {
        savedTabCount: 1,
        createdSessionCount: 1,
        closedTabCount: 1,
        skipped: [
          { observationId: records[0]!.observationId, reason: 'state-changed' },
          { observationId: records[1]!.observationId, reason: 'state-changed' },
        ],
        closeFailures: [],
      },
    });
    const sessions = dbMocks.createSessionsBatch.mock.calls[0]![0] as TabSession[];
    expect(sessions.flatMap(({ tabs: savedTabs }) => savedTabs).map(({ url }) => url))
      .toEqual(['https://example.com/safe']);
    expect(browserMocks.tabs.remove).toHaveBeenCalledWith(3);
  });

  it('drops a stale observation identity immediately before persistence', async () => {
    const [record] = await observe([sleepingTab()]);
    settingsMocks.getSettings.mockImplementationOnce(async () => {
      liveTabs.set(1, {
        ...liveTabs.get(1)!,
        lastAccessed: NOW - DAY_MS,
      });
      return { deviceId: 'device-1' };
    });
    const { stowSuggestedTabs } = await import('./suggested-stow');

    await expect(
      stowSuggestedTabs([record!.observationId], { now: NOW }),
    ).resolves.toEqual({
      ok: true,
      data: {
        savedTabCount: 0,
        createdSessionCount: 0,
        closedTabCount: 0,
        skipped: [{
          observationId: record!.observationId,
          reason: 'state-changed',
        }],
        closeFailures: [],
      },
    });
    expect(dbMocks.createSessionsBatch).not.toHaveBeenCalled();
    expect(browserMocks.tabs.remove).not.toHaveBeenCalled();
  });

  it('never closes a candidate filtered by a concurrent Saved URL write', async () => {
    const records = await observe([
      sleepingTab({ id: 1, index: 0, url: 'https://example.com/raced' }),
      sleepingTab({ id: 2, index: 1, url: 'https://example.com/saved' }),
    ]);
    dbMocks.createSessionsBatch.mockImplementation(async (sessions: TabSession[]) =>
      sessions.map((session) => ({ ...session, tabs: session.tabs.slice(1) }))
        .filter(({ tabs }) => tabs.length > 0),
    );
    const { stowSuggestedTabs } = await import('./suggested-stow');

    await expect(stowSuggestedTabs(
      records.map(({ observationId }) => observationId),
      { now: NOW },
    )).resolves.toEqual({
      ok: true,
      data: {
        savedTabCount: 1,
        createdSessionCount: 1,
        closedTabCount: 1,
        skipped: [{
          observationId: records[0]!.observationId,
          reason: 'saved-url-unavailable',
        }],
        closeFailures: [],
      },
    });
    expect(browserMocks.tabs.remove.mock.calls).toEqual([[2]]);
    expect(liveTabs.has(1)).toBe(true);
  });

  it('retains saved copies and suppresses repeats after post-save changes or close failures', async () => {
    const records = await observe([
      sleepingTab({ id: 1, index: 0, url: 'https://example.com/woke' }),
      sleepingTab({ id: 2, index: 1, url: 'https://example.com/close-fails' }),
      sleepingTab({ id: 3, index: 2, url: 'https://example.com/closes' }),
      sleepingTab({ id: 4, index: 3, url: 'https://example.com/moved' }),
    ]);
    const getCounts = new Map<number, number>();
    browserMocks.tabs.get.mockImplementation(async (tabId: number) => {
      const count = (getCounts.get(tabId) ?? 0) + 1;
      getCounts.set(tabId, count);
      const tab = liveTabs.get(tabId)!;
      if (tabId === 1 && count > 1) return { ...tab, active: true, discarded: false };
      if (tabId === 4 && count > 1) return { ...tab, windowId: 2 };
      return { ...tab };
    });
    browserMocks.tabs.remove.mockImplementation(async (tabId: number) => {
      if (tabId === 2) throw new Error('Chrome refused to close the tab');
      liveTabs.delete(tabId);
    });
    const { stowSuggestedTabs } = await import('./suggested-stow');

    await expect(stowSuggestedTabs(
      records.map(({ observationId }) => observationId),
      { now: NOW },
    )).resolves.toEqual({
      ok: true,
      data: {
        savedTabCount: 4,
        createdSessionCount: 1,
        closedTabCount: 1,
        skipped: [
          {
            observationId: records[0]!.observationId,
            reason: 'state-changed',
          },
          {
            observationId: records[3]!.observationId,
            reason: 'state-changed',
          },
        ],
        closeFailures: [{
          observationId: records[1]!.observationId,
          tabId: 2,
          message: 'Chrome refused to close the tab',
        }],
      },
    });

    const observations = await import('./sleep-observations');
    await expect(observations.listSleepObservations(NOW)).resolves.toEqual([
      expect.objectContaining({
        observationId: records[0]!.observationId,
        suppressedUntilWake: true,
      }),
      expect.objectContaining({
        observationId: records[1]!.observationId,
        suppressedUntilWake: true,
      }),
      expect.objectContaining({
        observationId: records[3]!.observationId,
        suppressedUntilWake: true,
      }),
    ]);
  });

  it('rejects malformed and concurrent confirmations without creating duplicates', async () => {
    const [record] = await observe([sleepingTab()]);
    const batch = deferred<TabSession[]>();
    dbMocks.createSessionsBatch.mockImplementation(async (sessions: TabSession[]) => {
      batch.resolveValue = sessions;
      return batch.promise;
    });
    const { stowSuggestedTabs } = await import('./suggested-stow');

    await expect(stowSuggestedTabs([], { now: NOW })).resolves.toEqual({
      ok: false,
      error: { code: 'invalid-stow-suggestions', message: 'Suggested tab identities are invalid.' },
    });
    await expect(
      stowSuggestedTabs([record!.observationId, record!.observationId], { now: NOW }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid-stow-suggestions', message: 'Suggested tab identities are invalid.' },
    });

    const first = stowSuggestedTabs([record!.observationId], { now: NOW });
    await vi.waitFor(() => expect(dbMocks.createSessionsBatch).toHaveBeenCalledTimes(1));
    await expect(
      stowSuggestedTabs([record!.observationId], { now: NOW }),
    ).resolves.toEqual({
      ok: false,
      error: { code: 'operation-in-progress', message: 'Another suggested stow is in progress.' },
    });
    batch.resolve(batch.resolveValue!);
    await expect(first).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(dbMocks.createSessionsBatch).toHaveBeenCalledTimes(1);
  });

  it('turns a completed retry into a no-op instead of saving or closing again', async () => {
    const [record] = await observe([sleepingTab()]);
    const { stowSuggestedTabs } = await import('./suggested-stow');

    await expect(
      stowSuggestedTabs([record!.observationId], { now: NOW }),
    ).resolves.toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({ savedTabCount: 1, closedTabCount: 1 }),
    }));
    await expect(
      stowSuggestedTabs([record!.observationId], { now: NOW }),
    ).resolves.toEqual({
      ok: true,
      data: {
        savedTabCount: 0,
        createdSessionCount: 0,
        closedTabCount: 0,
        skipped: [{
          observationId: record!.observationId,
          reason: 'not-suggested',
        }],
        closeFailures: [],
      },
    });
    expect(dbMocks.createSessionsBatch).toHaveBeenCalledTimes(1);
    expect(browserMocks.tabs.remove).toHaveBeenCalledTimes(1);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let resolveValue: T | undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve, resolveValue };
}

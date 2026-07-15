import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TabSession } from '@tabstow/core';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const browserMocks = vi.hoisted(() => ({
  tabs: {
    query: vi.fn(),
  },
}));

const dbMocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
}));

vi.mock('#imports', () => ({ storage: storageMocks }));
vi.mock('@/lib/browser', () => ({ browser: browserMocks }));
vi.mock('@/db/db', () => ({ listSessions: dbMocks.listSessions }));

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 6, 15, 12);
const POLICY_KEY = 'local:tabstow-tab-lifecycle-policy-v1';
const SESSION_KEY = 'session:tabstow-browser-session-id-v1';

function lifecyclePolicy(stowSuggestionsEnabled = true) {
  return {
    schemaVersion: 1,
    automaticSleepEnabled: false,
    automaticSleepAfterDays: 7,
    stowSuggestionsEnabled,
    stowSuggestionAfterDays: 14,
  };
}

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

function savedSession(url: string): TabSession {
  return {
    id: 'saved-session',
    title: 'Saved',
    tabs: [{ id: 'saved-tab', url, title: 'Saved', createdAt: new Date(NOW).toISOString() }],
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    deviceId: 'device-1',
  };
}

describe('stow suggestions', () => {
  let stored: Map<string, unknown>;
  let uuid = 0;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    uuid = 0;
    stored = new Map<string, unknown>([
      [POLICY_KEY, lifecyclePolicy()],
      [SESSION_KEY, 'browser-session-1'],
    ]);
    storageMocks.getItem.mockImplementation(async (key: string) =>
      structuredClone(stored.get(key)),
    );
    storageMocks.setItem.mockImplementation(async (key: string, value: unknown) => {
      stored.set(key, structuredClone(value));
    });
    browserMocks.tabs.query.mockResolvedValue([]);
    dbMocks.listSessions.mockResolvedValue([]);
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => `observation-${++uuid}`),
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

  it('lists threshold-equal candidates from normal windows in stable order', async () => {
    const oldest = sleepingTab({
      id: 30,
      windowId: 2,
      index: 0,
      url: 'https://example.com/oldest',
      title: 'Oldest',
    });
    const laterIndex = sleepingTab({
      id: 12,
      windowId: 1,
      index: 2,
      url: 'https://example.com/later',
      title: 'Later index',
    });
    const earlierIndex = sleepingTab({
      id: 11,
      windowId: 1,
      index: 1,
      url: 'https://example.com/earlier',
      title: 'Earlier index',
    });
    const observations = await import('./sleep-observations');
    await observations.observeDiscardedTab(oldest, NOW - 20 * DAY_MS);
    await observations.observeDiscardedTab(laterIndex, NOW - 14 * DAY_MS);
    await observations.observeDiscardedTab(earlierIndex, NOW - 14 * DAY_MS);
    browserMocks.tabs.query.mockResolvedValue([laterIndex, oldest, earlierIndex]);

    const { listStowSuggestions } = await import('./stow-suggestions');
    await expect(listStowSuggestions({ now: NOW })).resolves.toEqual({
      ok: true,
      data: {
        afterDays: 14,
        candidates: [
          expect.objectContaining({
            observationId: 'observation-1',
            tabId: 30,
            windowId: 2,
            index: 0,
            title: 'Oldest',
            observedSleepingDays: 20,
          }),
          expect.objectContaining({
            observationId: 'observation-3',
            tabId: 11,
            windowId: 1,
            index: 1,
            observedSleepingDays: 14,
          }),
          expect.objectContaining({
            observationId: 'observation-2',
            tabId: 12,
            windowId: 1,
            index: 2,
            observedSleepingDays: 14,
          }),
        ],
      },
    });
    expect(browserMocks.tabs.query).toHaveBeenCalledWith({ windowType: 'normal' });
  });

  it('uses a fresh reconciliation time after an asynchronous tab query', async () => {
    const tab = sleepingTab();
    const advancedNow = NOW + 2 * DAY_MS;
    const observations = await import('./sleep-observations');
    const observation = await observations.observeDiscardedTab(
      tab,
      NOW - 20 * DAY_MS,
    );
    browserMocks.tabs.query.mockImplementation(async () => {
      await observations.observeDiscardedTab(tab, advancedNow);
      return [tab];
    });

    const { listStowSuggestions } = await import('./stow-suggestions');
    await expect(
      listStowSuggestions({ now: NOW, clock: () => advancedNow }),
    ).resolves.toEqual({
      ok: true,
      data: {
        afterDays: 14,
        candidates: [
          expect.objectContaining({
            observationId: observation!.observationId,
            observedSleepingDays: 22,
          }),
        ],
      },
    });
  });

  it('excludes saved URLs, live duplicates, snoozes, suppressions, and protected tabs', async () => {
    const duplicateWinner = sleepingTab({
      id: 1,
      index: 0,
      url: 'https://example.com/article#first',
    });
    const duplicateLoser = sleepingTab({
      id: 2,
      index: 1,
      url: 'https://example.com/article#second',
    });
    const alreadySaved = sleepingTab({
      id: 3,
      index: 2,
      url: 'https://example.com/saved#live',
    });
    const snoozed = sleepingTab({ id: 4, index: 3, url: 'https://example.com/snoozed' });
    const suppressed = sleepingTab({ id: 5, index: 4, url: 'https://example.com/suppressed' });
    const protectedTab = sleepingTab({ id: 6, index: 5, url: 'https://example.com/protected' });
    const observations = await import('./sleep-observations');
    const records = [];
    for (const tab of [
      duplicateWinner,
      duplicateLoser,
      alreadySaved,
      snoozed,
      suppressed,
      protectedTab,
    ]) {
      records.push(await observations.observeDiscardedTab(tab, NOW - 14 * DAY_MS));
    }
    await observations.snoozeSleepObservations(
      [records[3]!.observationId],
      NOW + 7 * DAY_MS,
      NOW - DAY_MS,
    );
    await observations.suppressSleepObservations(
      [records[4]!.observationId],
      NOW - DAY_MS,
    );
    browserMocks.tabs.query.mockResolvedValue([
      duplicateWinner,
      duplicateLoser,
      alreadySaved,
      snoozed,
      suppressed,
      { ...protectedTab, autoDiscardable: false },
    ]);
    dbMocks.listSessions.mockResolvedValue([
      savedSession('https://example.com/saved#stored'),
    ]);

    const { listStowSuggestions } = await import('./stow-suggestions');
    const result = await listStowSuggestions({ now: NOW });

    expect(result).toEqual({
      ok: true,
      data: {
        afterDays: 14,
        candidates: [
          expect.objectContaining({
            observationId: records[0]!.observationId,
            tabId: 1,
          }),
        ],
      },
    });
  });

  it('clears observations and avoids tab or database reads when suggestions are off', async () => {
    stored.set(POLICY_KEY, lifecyclePolicy(false));
    const observations = await import('./sleep-observations');
    await observations.observeDiscardedTab(sleepingTab(), NOW - 20 * DAY_MS);

    const { listStowSuggestions } = await import('./stow-suggestions');
    await expect(listStowSuggestions({ now: NOW })).resolves.toEqual({
      ok: true,
      data: { afterDays: 14, candidates: [] },
    });
    await expect(observations.listSleepObservations(NOW)).resolves.toEqual([]);
    expect(browserMocks.tabs.query).not.toHaveBeenCalled();
    expect(dbMocks.listSessions).not.toHaveBeenCalled();
  });

  it('snoozes and suppresses only current observation identities', async () => {
    const first = sleepingTab({ id: 1, url: 'https://example.com/first' });
    const second = sleepingTab({ id: 2, url: 'https://example.com/second' });
    const observations = await import('./sleep-observations');
    const firstRecord = await observations.observeDiscardedTab(first, NOW - 20 * DAY_MS);
    const secondRecord = await observations.observeDiscardedTab(second, NOW - 20 * DAY_MS);
    browserMocks.tabs.query.mockResolvedValue([first, second]);
    const {
      snoozeStowSuggestions,
      suppressStowSuggestions,
    } = await import('./stow-suggestions');

    await expect(
      snoozeStowSuggestions([firstRecord!.observationId, 'missing'], { now: NOW }),
    ).resolves.toEqual({ ok: true, data: { updatedObservationCount: 1 } });
    await expect(
      suppressStowSuggestions([secondRecord!.observationId, 'missing'], { now: NOW }),
    ).resolves.toEqual({ ok: true, data: { updatedObservationCount: 1 } });

    await expect(observations.listSleepObservations(NOW)).resolves.toEqual([
      expect.objectContaining({
        observationId: firstRecord!.observationId,
        snoozedUntil: NOW + 7 * DAY_MS,
      }),
      expect.objectContaining({
        observationId: secondRecord!.observationId,
        suppressedUntilWake: true,
      }),
    ]);
  });

  it('starts a snooze from the fresh mutation time', async () => {
    const tab = sleepingTab();
    const advancedNow = NOW + 2 * DAY_MS;
    const observations = await import('./sleep-observations');
    const observation = await observations.observeDiscardedTab(
      tab,
      NOW - 20 * DAY_MS,
    );
    browserMocks.tabs.query.mockResolvedValue([tab]);

    const { snoozeStowSuggestions } = await import('./stow-suggestions');
    await expect(
      snoozeStowSuggestions(
        [observation!.observationId],
        { now: NOW, clock: () => advancedNow },
      ),
    ).resolves.toEqual({ ok: true, data: { updatedObservationCount: 1 } });

    await expect(observations.listSleepObservations(advancedNow)).resolves.toEqual([
      expect.objectContaining({
        observationId: observation!.observationId,
        snoozedUntil: advancedNow + 7 * DAY_MS,
      }),
    ]);
  });

  it('returns a Chrome error when current tabs cannot be reconciled', async () => {
    browserMocks.tabs.query.mockRejectedValue(new Error('Tabs unavailable'));
    const { listStowSuggestions } = await import('./stow-suggestions');

    await expect(listStowSuggestions({ now: NOW })).resolves.toEqual({
      ok: false,
      error: { code: 'chrome-tabs-error', message: 'Tabs unavailable' },
    });
  });

  it('drops a suggestion read invalidated while its tab query is pending', async () => {
    let resolveTabs!: (tabs: chrome.tabs.Tab[]) => void;
    browserMocks.tabs.query.mockReturnValue(new Promise((resolve) => {
      resolveTabs = resolve;
    }));
    const { listStowSuggestions } = await import('./stow-suggestions');
    const { invalidateTabLifecycleGeneration } = await import(
      './tab-lifecycle-generation'
    );

    const pending = listStowSuggestions({ now: NOW });
    await vi.waitFor(() => expect(browserMocks.tabs.query).toHaveBeenCalledTimes(1));
    invalidateTabLifecycleGeneration();
    resolveTabs([sleepingTab()]);

    await expect(pending).resolves.toEqual({
      ok: false,
      error: {
        code: 'operation-in-progress',
        message: 'Tab lifecycle settings changed. Retry the action.',
      },
    });
    expect(dbMocks.listSessions).not.toHaveBeenCalled();
  });
});

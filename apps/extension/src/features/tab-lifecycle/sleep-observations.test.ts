import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

const cryptoMocks = vi.hoisted(() => ({
  digest: vi.fn(),
  randomUUID: vi.fn(),
}));

vi.mock('#imports', () => ({ storage: storageMocks }));

const LOCAL_KEY = 'local:tabstow-sleep-observations-v1';
const SESSION_KEY = 'session:tabstow-browser-session-id-v1';
const FINGERPRINT = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const DAY_MS = 24 * 60 * 60 * 1_000;
const INELIGIBLE_TAB_CASES = [
  ['awake', { discarded: false }],
  ['selected', { active: true }],
  ['pinned', { pinned: true }],
  ['audible', { audible: true }],
  ['incognito', { incognito: true }],
  ['protected', { autoDiscardable: false }],
  ['internal', { url: 'chrome://settings/' }],
  ['missing its ID', { id: undefined }],
  ['using an invalid ID', { id: -1 }],
] satisfies Array<[string, Partial<chrome.tabs.Tab>]>;

function storedObservation(overrides: Record<string, unknown> = {}) {
  return {
    observationId: 'stored-observation',
    tabId: 7,
    browserSessionId: 'browser-session-1',
    urlFingerprint: FINGERPRINT,
    lastAccessed: 1_000,
    observedSleepingSince: 1_200,
    lastObservedAt: 1_500,
    ...overrides,
  };
}

function sleepingTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 7,
    index: 0,
    windowId: 1,
    highlighted: false,
    active: false,
    pinned: false,
    incognito: false,
    discarded: true,
    autoDiscardable: true,
    audible: false,
    url: 'https://example.com/path#section',
    title: 'Private page title',
    favIconUrl: 'https://example.com/icon.png',
    lastAccessed: 1_000,
    ...overrides,
  } as chrome.tabs.Tab;
}

describe('sleep observations', () => {
  let stored: Map<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    stored = new Map();
    storageMocks.getItem.mockImplementation(async (key: string) =>
      structuredClone(stored.get(key)),
    );
    storageMocks.setItem.mockImplementation(async (key: string, value: unknown) => {
      stored.set(key, structuredClone(value));
    });
    cryptoMocks.randomUUID
      .mockReturnValueOnce('browser-session-1')
      .mockReturnValueOnce('observation-1')
      .mockReturnValueOnce('observation-2')
      .mockReturnValueOnce('observation-3')
      .mockReturnValueOnce('observation-4');
    cryptoMocks.digest.mockImplementation(async (_algorithm, input: BufferSource) => {
      const value = new TextDecoder().decode(input as ArrayBuffer);
      const digest = Uint8Array.from({ length: 32 }, (_, index) => index);
      if (value.includes('other.example')) digest[31] = 32;
      if (value.includes('#new')) digest[30] = 33;
      return digest.buffer;
    });
    vi.stubGlobal('crypto', {
      randomUUID: cryptoMocks.randomUUID,
      subtle: { digest: cryptoMocks.digest },
    });
  });

  it('starts an observed sleep period now without persisting page metadata', async () => {
    const now = 2_000;
    const tab = sleepingTab();
    const { observeDiscardedTab } = await import('./sleep-observations');

    await expect(observeDiscardedTab(tab, now)).resolves.toEqual({
      observationId: 'observation-1',
      tabId: 7,
      browserSessionId: 'browser-session-1',
      urlFingerprint: FINGERPRINT,
      lastAccessed: 1_000,
      observedSleepingSince: now,
      lastObservedAt: now,
    });

    expect(cryptoMocks.digest).toHaveBeenCalledWith(
      'SHA-256',
      new TextEncoder().encode('https://example.com/path#section'),
    );
    expect(stored.get(SESSION_KEY)).toBe('browser-session-1');
    expect(stored.get(LOCAL_KEY)).toEqual({
      schemaVersion: 1,
      records: [
        {
          observationId: 'observation-1',
          tabId: 7,
          browserSessionId: 'browser-session-1',
          urlFingerprint: FINGERPRINT,
          lastAccessed: 1_000,
          observedSleepingSince: now,
          lastObservedAt: now,
        },
      ],
    });
    const serialized = JSON.stringify(stored.get(LOCAL_KEY));
    expect(serialized).not.toContain('https://example.com');
    expect(serialized).not.toContain('Private page title');
    expect(serialized).not.toContain('icon.png');
  });

  it('preserves the period and observation identity when the same sleeping tab repeats', async () => {
    const { observeDiscardedTab } = await import('./sleep-observations');

    await observeDiscardedTab(sleepingTab(), 2_000);

    await expect(
      observeDiscardedTab(sleepingTab(), 3_000),
    ).resolves.toEqual({
      observationId: 'observation-1',
      tabId: 7,
      browserSessionId: 'browser-session-1',
      urlFingerprint: FINGERPRINT,
      lastAccessed: 1_000,
      observedSleepingSince: 2_000,
      lastObservedAt: 3_000,
    });
    expect(cryptoMocks.randomUUID).toHaveBeenCalledTimes(2);
    expect((stored.get(LOCAL_KEY) as { records: unknown[] }).records).toHaveLength(1);
  });

  it('starts a new direct observation when lastAccessed proves the tab became active', async () => {
    const {
      observeDiscardedTab,
      snoozeSleepObservations,
      suppressSleepObservations,
    } = await import('./sleep-observations');
    await observeDiscardedTab(sleepingTab(), 2_000);
    await snoozeSleepObservations(['observation-1'], 10_000, 2_500);
    await suppressSleepObservations(['observation-1'], 2_500);

    await expect(
      observeDiscardedTab(sleepingTab({ lastAccessed: 1_500 }), 3_000),
    ).resolves.toEqual({
      observationId: 'observation-2',
      tabId: 7,
      browserSessionId: 'browser-session-1',
      urlFingerprint: FINGERPRINT,
      lastAccessed: 1_500,
      observedSleepingSince: 3_000,
      lastObservedAt: 3_000,
    });
  });

  it.each([
    ['missing', undefined],
    ['in the future', 3_001],
  ])(
    'starts a new period when current lastAccessed is %s after valid evidence',
    async (_label, lastAccessed) => {
      const { observeDiscardedTab } = await import('./sleep-observations');
      await observeDiscardedTab(sleepingTab(), 2_000);

      await expect(
        observeDiscardedTab(sleepingTab({ lastAccessed }), 3_000),
      ).resolves.toEqual({
        observationId: 'observation-2',
        tabId: 7,
        browserSessionId: 'browser-session-1',
        urlFingerprint: FINGERPRINT,
        observedSleepingSince: 3_000,
        lastObservedAt: 3_000,
      });
    },
  );

  it('preserves a same-session period when lastAccessed is unavailable throughout', async () => {
    const { observeDiscardedTab } = await import('./sleep-observations');
    await observeDiscardedTab(sleepingTab({ lastAccessed: undefined }), 2_000);

    await expect(
      observeDiscardedTab(sleepingTab({ lastAccessed: undefined }), 3_000),
    ).resolves.toEqual(expect.objectContaining({
      observationId: 'observation-1',
      observedSleepingSince: 2_000,
      lastObservedAt: 3_000,
    }));
  });

  it('starts a new reconciled observation when lastAccessed proves a missed wake', async () => {
    const { reconcileSleepObservations } = await import('./sleep-observations');
    await reconcileSleepObservations([sleepingTab()], 2_000);

    await expect(
      reconcileSleepObservations(
        [sleepingTab({ lastAccessed: 1_500 })],
        3_000,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-2',
        lastAccessed: 1_500,
        observedSleepingSince: 3_000,
      }),
    ]);
  });

  it('reconciles all supplied tabs and returns only eligible live observations', async () => {
    const { reconcileSleepObservations } = await import('./sleep-observations');

    const records = await reconcileSleepObservations(
      [
        sleepingTab(),
        sleepingTab({ id: 8, url: 'https://other.example/' }),
        sleepingTab({ id: 9, active: true }),
      ],
      2_000,
    );

    expect(records).toEqual([
      expect.objectContaining({ observationId: 'observation-1', tabId: 7 }),
      expect.objectContaining({ observationId: 'observation-2', tabId: 8 }),
    ]);
    expect((stored.get(LOCAL_KEY) as { records: unknown[] }).records).toHaveLength(2);
  });

  it('starts a new period after wake, navigation, or a protected transition', async () => {
    const { reconcileSleepObservations } = await import('./sleep-observations');

    await expect(reconcileSleepObservations([sleepingTab()], 2_000)).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-1',
        observedSleepingSince: 2_000,
      }),
    ]);
    await expect(
      reconcileSleepObservations([sleepingTab({ discarded: false })], 2_500),
    ).resolves.toEqual([]);
    await expect(reconcileSleepObservations([sleepingTab()], 3_000)).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-2',
        observedSleepingSince: 3_000,
      }),
    ]);
    await expect(
      reconcileSleepObservations(
        [sleepingTab({ url: 'https://example.com/path#new' })],
        3_500,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-3',
        observedSleepingSince: 3_500,
      }),
    ]);
    await expect(
      reconcileSleepObservations([sleepingTab({ pinned: true })], 4_000),
    ).resolves.toEqual([]);
    await expect(reconcileSleepObservations([sleepingTab()], 4_500)).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-4',
        observedSleepingSince: 4_500,
      }),
    ]);
  });

  it('lists only safe current records and drops malformed or future durable data', async () => {
    stored.set(SESSION_KEY, 'browser-session-1');
    stored.set(LOCAL_KEY, {
      schemaVersion: 1,
      records: [
        storedObservation({
          url: 'https://must-not-survive.example/',
          title: 'must not survive',
          snoozedUntil: 1_900,
        }),
        storedObservation({
          observationId: 'future-period',
          tabId: 8,
          observedSleepingSince: 2_001,
          lastObservedAt: 2_001,
        }),
        storedObservation({
          observationId: 'future-access',
          tabId: 9,
          lastAccessed: 2_001,
        }),
        storedObservation({ observationId: '', tabId: 10 }),
      ],
    });
    const { listSleepObservations } = await import('./sleep-observations');

    await expect(listSleepObservations(2_000)).resolves.toEqual([
      storedObservation(),
    ]);
    expect(stored.get(LOCAL_KEY)).toEqual({
      schemaVersion: 1,
      records: [storedObservation()],
    });
    expect(JSON.stringify(stored.get(LOCAL_KEY))).not.toContain('must not survive');
  });

  it('snoozes, suppresses, removes, and clears observations through stable public identities', async () => {
    const {
      clearSleepObservations,
      listSleepObservations,
      reconcileSleepObservations,
      removeSleepObservation,
      snoozeSleepObservations,
      suppressSleepObservations,
    } = await import('./sleep-observations');
    await reconcileSleepObservations(
      [sleepingTab(), sleepingTab({ id: 8, url: 'https://other.example/' })],
      2_000,
    );

    await snoozeSleepObservations(['observation-1', 'unknown'], 10_000, 2_500);
    await suppressSleepObservations(['observation-1'], 2_500);

    await expect(listSleepObservations(2_500)).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-1',
        snoozedUntil: 10_000,
        suppressedUntilWake: true,
      }),
      expect.objectContaining({ observationId: 'observation-2' }),
    ]);

    await removeSleepObservation(7, 2_500);
    await expect(listSleepObservations(2_500)).resolves.toEqual([
      expect.objectContaining({ observationId: 'observation-2', tabId: 8 }),
    ]);

    await clearSleepObservations();
    await expect(listSleepObservations(2_500)).resolves.toEqual([]);
    expect(stored.get(LOCAL_KEY)).toEqual({ schemaVersion: 1, records: [] });
  });

  it('retains a period across worker and browser restarts only with unique strong identity', async () => {
    let module = await import('./sleep-observations');
    await module.reconcileSleepObservations([sleepingTab()], 2_000);

    vi.resetModules();
    module = await import('./sleep-observations');
    await expect(
      module.reconcileSleepObservations([sleepingTab()], 2_500),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-1',
        browserSessionId: 'browser-session-1',
        observedSleepingSince: 2_000,
      }),
    ]);

    stored.delete(SESSION_KEY);
    cryptoMocks.randomUUID.mockReset().mockReturnValueOnce('browser-session-2');
    vi.resetModules();
    module = await import('./sleep-observations');

    await expect(
      module.reconcileSleepObservations([sleepingTab({ id: 77 })], 3_000),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-1',
        tabId: 77,
        browserSessionId: 'browser-session-2',
        observedSleepingSince: 2_000,
        lastObservedAt: 3_000,
      }),
    ]);
  });

  it('resets ambiguous duplicate URLs after a browser restart', async () => {
    stored.set(SESSION_KEY, 'new-session');
    stored.set(LOCAL_KEY, {
      schemaVersion: 1,
      records: [storedObservation({ browserSessionId: 'old-session' })],
    });
    cryptoMocks.randomUUID
      .mockReset()
      .mockReturnValueOnce('new-observation-1')
      .mockReturnValueOnce('new-observation-2');
    const { reconcileSleepObservations } = await import('./sleep-observations');

    await expect(
      reconcileSleepObservations(
        [sleepingTab({ id: 70 }), sleepingTab({ id: 71 })],
        2_000,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: 'new-observation-1',
        observedSleepingSince: 2_000,
      }),
      expect.objectContaining({
        observationId: 'new-observation-2',
        observedSleepingSince: 2_000,
      }),
    ]);
    expect(JSON.stringify(stored.get(LOCAL_KEY))).not.toContain('stored-observation');
  });

  it('starts now after a browser restart when lastAccessed identity is unavailable', async () => {
    stored.set(SESSION_KEY, 'new-session');
    stored.set(LOCAL_KEY, {
      schemaVersion: 1,
      records: [storedObservation({ browserSessionId: 'old-session' })],
    });
    cryptoMocks.randomUUID.mockReset().mockReturnValueOnce('new-observation');
    const { reconcileSleepObservations } = await import('./sleep-observations');

    await expect(
      reconcileSleepObservations(
        [sleepingTab({ id: 70, lastAccessed: undefined })],
        2_000,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: 'new-observation',
        observedSleepingSince: 2_000,
      }),
    ]);
  });

  it('does not recover an old period after a protected restart transition', async () => {
    stored.set(SESSION_KEY, 'new-session');
    stored.set(LOCAL_KEY, {
      schemaVersion: 1,
      records: [storedObservation({ browserSessionId: 'old-session' })],
    });
    cryptoMocks.randomUUID.mockReset().mockReturnValueOnce('new-observation');
    const { reconcileSleepObservations } = await import('./sleep-observations');

    await expect(
      reconcileSleepObservations([sleepingTab({ pinned: true })], 2_000),
    ).resolves.toEqual([]);
    await expect(
      reconcileSleepObservations([sleepingTab()], 2_500),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: 'new-observation',
        observedSleepingSince: 2_500,
      }),
    ]);
  });

  it('treats a protected duplicate as ambiguous during restart recovery', async () => {
    stored.set(SESSION_KEY, 'new-session');
    stored.set(LOCAL_KEY, {
      schemaVersion: 1,
      records: [storedObservation({ browserSessionId: 'old-session' })],
    });
    cryptoMocks.randomUUID.mockReset().mockReturnValueOnce('new-observation');
    const { reconcileSleepObservations } = await import('./sleep-observations');

    await expect(
      reconcileSleepObservations(
        [sleepingTab({ id: 70 }), sleepingTab({ id: 71, pinned: true })],
        2_000,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        observationId: 'new-observation',
        observedSleepingSince: 2_000,
      }),
    ]);
  });

  it('hides unmatched records and prunes them after thirty days', async () => {
    const now = 40 * DAY_MS;
    const current = storedObservation();
    const freshUnmatched = storedObservation({
      observationId: 'fresh-unmatched',
      tabId: 8,
      browserSessionId: 'old-session',
      observedSleepingSince: now - 29 * DAY_MS - 1_000,
      lastObservedAt: now - 29 * DAY_MS,
    });
    const expiredUnmatched = storedObservation({
      observationId: 'expired-unmatched',
      tabId: 9,
      browserSessionId: 'older-session',
      observedSleepingSince: now - 30 * DAY_MS - 1_000,
      lastObservedAt: now - 30 * DAY_MS,
    });
    stored.set(SESSION_KEY, 'browser-session-1');
    stored.set(LOCAL_KEY, {
      schemaVersion: 1,
      records: [current, freshUnmatched, expiredUnmatched],
    });
    const { listSleepObservations } = await import('./sleep-observations');

    await expect(listSleepObservations(now)).resolves.toEqual([current]);
    expect(stored.get(LOCAL_KEY)).toEqual({
      schemaVersion: 1,
      records: [current, freshUnmatched],
    });
  });

  it('serializes concurrent mutations against the latest durable value', async () => {
    const module = await import('./sleep-observations');
    await module.reconcileSleepObservations([sleepingTab()], 2_000);

    let releaseWrite = () => {};
    let markWriteStarted = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      markWriteStarted = resolve;
    });
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let blockNextLocalWrite = true;
    storageMocks.setItem.mockImplementation(async (key: string, value: unknown) => {
      if (key === LOCAL_KEY && blockNextLocalWrite) {
        blockNextLocalWrite = false;
        markWriteStarted();
        await writeGate;
      }
      stored.set(key, structuredClone(value));
    });

    const snooze = module.snoozeSleepObservations(
      ['observation-1'],
      10_000,
      2_500,
    );
    await writeStarted;
    const suppress = module.suppressSleepObservations(['observation-1'], 2_500);
    releaseWrite();
    await Promise.all([snooze, suppress]);

    await expect(module.listSleepObservations(2_500)).resolves.toEqual([
      expect.objectContaining({
        observationId: 'observation-1',
        snoozedUntil: 10_000,
        suppressedUntilWake: true,
      }),
    ]);
  });

  it.each(INELIGIBLE_TAB_CASES)(
    'does not observe an ineligible tab that is %s',
    async (_label, overrides) => {
      const { observeDiscardedTab } = await import('./sleep-observations');

      await expect(
        observeDiscardedTab(sleepingTab(overrides), 2_000),
      ).resolves.toBeNull();
      expect(stored.has(LOCAL_KEY)).toBe(false);
      expect(cryptoMocks.digest).not.toHaveBeenCalled();
    },
  );
});
